// 探测 .ds-message 容器的 user/assistant 区分
import { chromium } from "playwright-core"

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222")
  const ctx = browser.contexts()[0] ?? (await browser.newContext())
  const page = await ctx.newPage()
  await page.goto("https://chat.deepseek.com/share/pekxlh4u5sph5ihc7h", {
    waitUntil: "domcontentloaded"
  })
  await page.waitForLoadState("networkidle").catch(() => 0)
  await page.waitForTimeout(2000)

  const src = `(function () {
    var rows = document.querySelectorAll(".ds-message");
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var hasAssistantMd = !!el.querySelector(".ds-markdown.ds-assistant-message-main-content");
      var hasUserBox = !!el.querySelector(".fbb737a4");
      out.push({
        idx: i,
        cls: (el.className || "").toString(),
        hasAssistantMd: hasAssistantMd,
        hasUserBox: hasUserBox,
        textHead: (el.textContent || "").trim().slice(0, 50)
      });
    }
    return out;
  })()`
  const rows = await page.evaluate(src)
  console.log(JSON.stringify(rows, null, 2))
  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
