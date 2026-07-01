// 用 Playwright 连接已开 9222 的 Chrome（你启动的 profile），
// 打开 DeepSeek 私有页（如已登录），抓取：
//   1) DOM 结构样本（用户/助手节点选择器）
//   2) 网络接口的 URL + 响应片段（前 4KB）
// 不写任何持久数据，仅打印到 stdout。
import { chromium } from "playwright-core"
import * as fs from "node:fs"

const TARGETS = [
  // 优先用分享页：无需登录，肯定有 user+assistant
  "https://chat.deepseek.com/share/pekxlh4u5sph5ihc7h",
  // 私有页：若 9222 chrome 已登录则可用
  "https://chat.deepseek.com/a/chat/s/e77b0b04-d91b-418d-82ea-b377560e67bd"
]

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222")
  const ctx = browser.contexts()[0] ?? (await browser.newContext())

  for (const url of TARGETS) {
    console.log("\n========== " + url + " ==========")
    const page = await ctx.newPage()

    const captured: { url: string; status: number; len: number; head: string }[] = []
    page.on("response", async (resp) => {
      const u = resp.url()
      if (!/deepseek\.com\/api\/|completion|fetch|chat/i.test(u)) return
      try {
        const buf = await resp.body()
        const text = buf.toString("utf8")
        captured.push({
          url: u,
          status: resp.status(),
          len: text.length,
          head: text.slice(0, 600)
        })
      } catch {
        /* SSE 流可能读不到 body */
      }
    })

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => 0)
      await page.waitForTimeout(2500)

      // ---- 探测 DOM ----（纯字符串规避 tsx 注入 __name 的问题）
      const probeSource = `(function () {
        function take(sel, limit) {
          var list = Array.prototype.slice.call(document.querySelectorAll(sel), 0, limit);
          return list.map(function (el) {
            return {
              tag: el.tagName,
              cls: (el.className || "").toString().slice(0, 160),
              text: (el.textContent || "").trim().slice(0, 120)
            };
          });
        }
        var candidates = [
          ".ds-markdown",
          "[class*='markdown']",
          "[class*='_user_message']",
          "[class*='user_message']",
          "[class*='message_user']",
          "[class*='fbb737a4']",
          "[data-message-author-role]",
          "[class*='conversation']",
          "[class*='chat-list']",
          "[class*='message']"
        ];
        var out = {};
        for (var i = 0; i < candidates.length; i++) {
          var sel = candidates[i];
          var n = document.querySelectorAll(sel).length;
          if (n > 0) out[sel] = { count: n, samples: take(sel, 2) };
        }
        var md = document.querySelectorAll(".ds-markdown");
        var wrappers = [];
        for (var j = 0; j < Math.min(md.length, 4); j++) {
          var cur = md[j];
          var path = [];
          for (var k = 0; k < 6 && cur; k++) {
            path.push(
              cur.tagName.toLowerCase() + "." +
              ((cur.className || "").toString().split(/\\s+/).slice(0, 2).join("."))
            );
            cur = cur.parentElement;
          }
          wrappers.push(path);
        }
        return { hits: out, wrappers: wrappers };
      })()`
      const probe = await page.evaluate(probeSource)
      console.log("[DOM probe]")
      console.log(JSON.stringify(probe, null, 2).slice(0, 4000))

      console.log("\n[Network captures]: " + captured.length + " items")
      for (const c of captured.slice(0, 8)) {
        console.log(
          `  - [${c.status}] len=${c.len}  ${c.url}\n    HEAD: ${c.head.replace(
            /\n/g,
            " ⏎ "
          )}`
        )
      }

      fs.writeFileSync(
        `tests/_probe-${url.replace(/[^a-z0-9]/gi, "_")}.json`,
        JSON.stringify({ url, probe, captured: captured.slice(0, 20) }, null, 2)
      )
    } catch (e) {
      console.error("FAIL:", e)
    } finally {
      await page.close()
    }
  }

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
