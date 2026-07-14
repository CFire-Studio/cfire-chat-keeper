// 监听豆包页面向上滚动时 /im/chain/single 的分页请求参数
const http = require("http")
const WebSocket = require("ws")

const CDP_HTTP = "http://127.0.0.1:9222"

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get(CDP_HTTP + path, (res) => {
      let data = ""
      res.on("data", (c) => (data += c))
      res.on("end", () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on("error", reject)
  })
}

async function main() {
  const list = await fetchJson("/json/list")
  const tab = list.find((t) => t.type === "page" && t.url.includes("doubao.com/chat/bot/chat/5555555555555555555"))
  if (!tab) throw new Error("doubao bot chat tab not found")

  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.once("open", resolve)
    ws.once("error", reject)
  })

  let msgId = 0
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId
      const handler = (buf) => {
        const msg = JSON.parse(buf.toString())
        if (msg.id === id) {
          ws.off("message", handler)
          resolve(msg)
        }
      }
      ws.on("message", handler)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  await send("Runtime.enable")
  await send("Network.enable")

  const chainUrls = []
  const handler = (buf) => {
    const msg = JSON.parse(buf.toString())
    if (msg.method === "Network.requestWillBeSent") {
      const url = msg.params.request?.url
      if (url && url.includes("/im/chain/single")) {
        chainUrls.push(url)
      }
    }
  }
  ws.on("message", handler)

  // 向上滚动触发分页
  await send("Runtime.evaluate", {
    expression: `
    (function() {
      const scroller = document.querySelector('[class*="v_list_scroller"]');
      if (!scroller) return 'no scroller';
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -scroller.clientHeight * 2, bubbles: true }));
      return 'scrolled';
    })()
    `,
    returnByValue: true
  })

  await new Promise((r) => setTimeout(r, 5000))
  ws.off("message", handler)

  console.log("Captured /im/chain/single URLs:")
  chainUrls.forEach((u, i) => console.log(`  [${i}] ${u}`))

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
