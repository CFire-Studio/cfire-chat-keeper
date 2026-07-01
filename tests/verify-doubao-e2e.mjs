// 端到端验证：重载豆包 → 实时监听 /im/chain/single → 抓响应体 → 跑 parser
import { parseEvent } from "../src/lib/parsers.ts"

const DEBUG_HOST = "http://localhost:9222"

async function main() {
  const targets = await (await fetch(`${DEBUG_HOST}/json`)).json()
  const tab = targets.find((t) => t.type === "page" && t.url.includes("doubao.com"))
  if (!tab) { console.error("[!] 未找到豆包"); process.exit(1) }

  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const reqUrlMap = new Map() // requestId -> url
  let chainBody = null

  function send(method, params = {}) {
    const msgId = ++id
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  }
  ws.addEventListener("message", async (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    } else if (msg.method === "Network.requestWillBeSent") {
      reqUrlMap.set(msg.params.requestId, msg.params.request.url)
    } else if (msg.method === "Network.loadingFinished") {
      const rid = msg.params.requestId
      const url = reqUrlMap.get(rid)
      if (url && url.includes("/im/chain/single") && !chainBody) {
        try {
          const res = await send("Network.getResponseBody", { requestId: rid })
          chainBody = res.body
          console.log("[*] 已捕获 /im/chain/single 响应，长度:", chainBody.length)
        } catch (err) {
          console.log("[!] 获取响应体失败:", err.message)
        }
      }
    }
  })
  await new Promise((r, s) => { ws.addEventListener("open", r); ws.addEventListener("error", s) })
  await send("Network.enable")
  await send("Page.enable")

  console.log("[*] 重载豆包页面...")
  await send("Page.reload", { ignoreCache: true })

  // 等待响应（最多 15 秒）
  for (let i = 0; i < 30; i++) {
    if (chainBody) break
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!chainBody) { console.error("[!] 超时未捕获 /im/chain/single"); process.exit(1) }

  const parsed = parseEvent({
    source: "fetch-hook",
    site: "doubao",
    url: "https://www.doubao.com/im/chain/single",
    status: 200,
    body: chainBody,
    capturedAt: Date.now()
  })

  if (!parsed) { console.error("[!] parser 返回 null"); process.exit(1) }

  console.log("\n========== 端到端解析结果 ==========")
  console.log("会话 ID:", parsed.conversation.conversationId)
  console.log("消息数:", parsed.messages.length)
  console.log("replace:", parsed.replace)
  console.log("\n---------- 消息列表 ----------")
  for (const m of parsed.messages) {
    const preview = m.content.replace(/\n/g, " ").slice(0, 80)
    console.log(`  [${m.role}] turnId=${m.turnId} | ${preview}`)
  }

  console.log("\n---------- 校验 ----------")
  const checks = [
    ["消息数 > 0", parsed.messages.length > 0],
    ["含 user 消息", parsed.messages.some(m => m.role === "user")],
    ["含 assistant 消息", parsed.messages.some(m => m.role === "assistant")],
    ["turnId 全为数字ID", parsed.messages.every(m => /^\d+$/.test(m.turnId))],
    ["convId 非 unknown", parsed.conversation.conversationId !== "unknown"],
  ]
  let ok = true
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
    if (!pass) ok = false
  }
  console.log(ok ? "\n✓ 端到端验证通过" : "\n✗ 端到端验证失败")

  ws.close()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
