// E2E：用 Playwright 启动一个独立 Chromium，加载扩展，访问目标页，
// 然后从扩展 service worker 读取 IndexedDB 验证去重 + user 内容已采集。
// 不依赖外部 9222 端口。
import { chromium, type BrowserContext } from "playwright-core"
import * as path from "node:path"
import * as fs from "node:fs"

const EXT_DIR = path.resolve(__dirname, "..", "build", "chrome-mv3-prod")
const PROFILE = path.resolve(__dirname, "_e2e-profile")

const TARGETS = [
  // 分享页：无登录 → 一定能触发 DOM 兜底 + share/content API
  "https://chat.deepseek.com/share/pekxlh4u5sph5ihc7h"
]

async function findExtServiceWorker(ctx: BrowserContext, timeoutMs = 8000) {
  // 优先取已存在
  const existing = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
  if (existing) return existing
  // 否则等 event
  return await Promise.race([
    new Promise<import("playwright-core").Worker | null>((resolve) => {
      ctx.on("serviceworker", (w) => {
        if (w.url().startsWith("chrome-extension://")) resolve(w)
      })
    }),
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))
  ])
}

async function main() {
  if (!fs.existsSync(EXT_DIR)) {
    console.error("扩展产物不存在，先运行 `npx plasmo build`")
    process.exit(2)
  }
  // 独立 profile，避免污染你的 .playwright-chrome-profile
  fs.rmSync(PROFILE, { recursive: true, force: true })

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  })

  // 先访问目标域 = 触发 content script，content script 发 message 会激活 background SW
  const warmup = await ctx.newPage()
  await warmup
    .goto("https://chat.deepseek.com/share/pekxlh4u5sph5ihc7h", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    })
    .catch(() => 0)
  await warmup.waitForTimeout(3000)
  console.log("workers count:", ctx.serviceWorkers().length)
  for (const w of ctx.serviceWorkers()) console.log("  sw:", w.url())

  // 等待扩展 service worker 注册
  const sw = await findExtServiceWorker(ctx, 15000)
  if (!sw) {
    console.error("未发现扩展 service worker")
    await warmup.close().catch(() => 0)
    await ctx.close()
    process.exit(3)
  }
  const extId = new URL(sw.url()).host
  console.log("extension id =", extId)

  // 给 content script + DOM observer 额外时间收敛
  await warmup.waitForTimeout(4000)
  await warmup.close()

  // 在 service worker 里读取 IndexedDB
  const result = await sw.evaluate(async () => {
    function openDb() {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("cfire-chat-keeper")
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }
    const db = await openDb()
    function all<T>(store: string) {
      return new Promise<T[]>((resolve, reject) => {
        const t = db.transaction(store, "readonly")
        const r = t.objectStore(store).getAll() as IDBRequest<T[]>
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    }
    const convs = await all<any>("conversations")
    const msgs = await all<any>("messages")
    return { convs, msgs }
  })

  fs.writeFileSync(
    path.join(__dirname, "_e2e-result.json"),
    JSON.stringify(result, null, 2)
  )

  console.log("\n[Conversations]:", result.convs.length)
  for (const c of result.convs) {
    console.log(`  - ${c.id} | ${c.messageCount} msgs | isShare=${c.isShare} | ${c.url}`)
  }
  console.log("\n[Messages]:", result.msgs.length)
  for (const m of result.msgs.slice(0, 12)) {
    console.log(
      `  - [${m.convId}] ${m.turnId} ${m.role}: ${(m.content as string).slice(0, 50).replace(/\n/g, " ")}…`
    )
  }

  // ---- 断言 ----
  let pass = 0,
    fail = 0
  const A = (name: string, cond: boolean, extra?: unknown) => {
    if (cond) (pass++, console.log("  PASS", name))
    else (fail++, console.log("  FAIL", name, extra ?? ""))
  }
  console.log("\n=== Asserts ===")
  const conv = result.convs.find((c) => c.id === "deepseek:pekxlh4u5sph5ihc7h")
  A("收录了 deepseek share 会话", !!conv)
  const convMsgs = result.msgs.filter((m) => m.convId === conv?.id)
  A("有 user 角色", convMsgs.some((m) => m.role === "user"))
  A("有 assistant 角色", convMsgs.some((m) => m.role === "assistant"))
  A(
    "user + assistant 至少各 3 条（与真实分享对话一致）",
    convMsgs.filter((m) => m.role === "user").length >= 3 &&
      convMsgs.filter((m) => m.role === "assistant").length >= 3
  )
  // 去重检查：内容字符串集合应等于 messages 长度
  const contents = new Set(convMsgs.map((m) => m.content))
  A("没有重复 content（去重成功）", contents.size === convMsgs.length, {
    total: convMsgs.length,
    unique: contents.size
  })
  // 没有"超长拼接"残留：单条 assistant 长度合理（不应有几条都一样的全文）
  const dupLong = convMsgs.filter(
    (m) => m.role === "assistant" && m.content.length > 800
  )
  A(
    "无 assistant 长文重复（应 ≤3 条 assistant，每条独立）",
    dupLong.length <= 3,
    { dupLongCount: dupLong.length }
  )

  await ctx.close()

  console.log(`\n=== E2E Result: ${pass} passed, ${fail} failed ===`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
