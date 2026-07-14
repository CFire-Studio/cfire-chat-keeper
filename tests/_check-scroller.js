const http = require("http")
const WebSocket = require("ws")

async function main() {
  const list = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json/list", (res) => {
      let d = ""
      res.on("data", (c) => (d += c))
      res.on("end", () => resolve(JSON.parse(d)))
    }).on("error", reject)
  })
  const page = list.find((t) => t.type === "page" && t.url.includes("doubao.com/chat/bot/chat/5555555555555555555"))
  if (!page) {
    console.log("no page")
    process.exit(1)
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.once("open", resolve)
    ws.once("error", reject)
  })
  let id = 0
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const reqId = ++id
      const handler = (buf) => {
        const msg = JSON.parse(buf.toString())
        if (msg.id === reqId) {
          ws.off("message", handler)
          resolve(msg)
        }
      }
      ws.on("message", handler)
      ws.send(JSON.stringify({ id: reqId, method, params }))
    })
  }
  await send("Runtime.enable")
  const res = await send("Runtime.evaluate", {
    expression: `document.querySelector('[class*="v_list_scroller"]')?.className || 'not found'`,
    returnByValue: true
  })
  console.log("scroller:", res.result?.result?.value)
  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
