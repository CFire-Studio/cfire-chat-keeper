// 直接抓取 history_messages 接口的完整响应，弄清楚字段结构
import { chromium } from "playwright-core"
import * as fs from "node:fs"

const PAGES = [
  "https://chat.deepseek.com/a/chat/s/e77b0b04-d91b-418d-82ea-b377560e67bd",
  "https://chat.deepseek.com/share/pekxlh4u5sph5ihc7h"
]

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222")
  const ctx = browser.contexts()[0] ?? (await browser.newContext())

  for (const url of PAGES) {
    console.log("\n===== " + url + " =====")
    const page = await ctx.newPage()
    let saved = false
    page.on("response", async (resp) => {
      const u = resp.url()
      if (!/\/api\/v0\/(chat\/history_messages|share\/)/i.test(u)) return
      try {
        const text = (await resp.body()).toString("utf8")
        const fname =
          "tests/_api-" +
          u.replace(/[^a-z0-9]/gi, "_").slice(0, 60) +
          ".json"
        fs.writeFileSync(fname, text)
        console.log("SAVE", u, "->", fname, "len=", text.length)
        // 打印关键结构
        try {
          const j = JSON.parse(text)
          const root = j?.data?.biz_data ?? j?.data ?? j
          const keys = Object.keys(root || {})
          console.log("top keys:", keys)
          for (const k of ["messages", "message_list", "chat_messages"]) {
            if (Array.isArray(root[k])) {
              console.log(`  -> array '${k}' len=${root[k].length}`)
              console.log(
                "     first item keys:",
                Object.keys(root[k][0] ?? {})
              )
              console.log(
                "     first item sample:",
                JSON.stringify(root[k][0], null, 2).slice(0, 1200)
              )
              break
            }
          }
        } catch (e) {
          console.log("parse err", e)
        }
        saved = true
      } catch {}
    })
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => 0)
      await page.waitForTimeout(3000)
      if (!saved) console.log("（未捕获到 history_messages 接口）")
    } catch (e) {
      console.error("err", e)
    }
    await page.close()
  }
  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
