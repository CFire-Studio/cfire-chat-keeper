// 探测豆包 /im/chain/single 真实翻页参数
// 通过 CDP 连续捕获两次滚动触发的请求，对比 anchor_index 和 direction。
const http = require("http")
const WebSocket = require("ws")

const CDP_HTTP = "http://127.0.0.1:9222"
const TARGET_URL_PREFIX = "https://www.doubao.com/chat/bot/chat/"

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
  const page = list.find((t) => t.type === "page" && t.url.startsWith(TARGET_URL_PREFIX))
  if (!page) throw new Error(`未找到豆包 bot 页面`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
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

  const captured = []
  ws.on("message", (buf) => {
    const msg = JSON.parse(buf.toString())
    if (msg.method === "Network.requestWillBeSent") {
      const req = msg.params.request
      if (req.url && req.url.includes("/im/chain/single") && req.method === "POST") {
        captured.push({
          requestId: msg.params.requestId,
          url: req.url,
          headers: req.headers,
          postData: req.postData,
          timestamp: msg.params.timestamp
        })
      }
    }
  })

  const scrollBottomExpr = `
    (function() {
      const scroller = document.querySelector('[class*="v_list_scroller"]')
      if (!scroller) return 'no scroller'
      scroller.scrollTop = scroller.scrollHeight
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      return 'scrolled to bottom'
    })()
  `
  const scrollUpExpr = `
    (function() {
      const scroller = document.querySelector('[class*="v_list_scroller"]')
      if (!scroller) return 'no scroller'
      scroller.scrollTop = 0
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -scroller.clientHeight * 3, bubbles: true }))
      return 'scrolled up'
    })()
  `

  console.log("先滚到底部...")
  await send("Runtime.evaluate", { expression: scrollBottomExpr, returnByValue: true })
  await sleep(2000)

  console.log("第一次向上滚动...")
  await send("Runtime.evaluate", { expression: scrollUpExpr, returnByValue: true })
  await sleep(4000)

  console.log("第二次向上滚动...")
  await send("Runtime.evaluate", { expression: scrollUpExpr, returnByValue: true })
  await sleep(4000)

  console.log("第三次向上滚动...")
  await send("Runtime.evaluate", { expression: scrollUpExpr, returnByValue: true })
  await sleep(4000)

  console.log(`\n捕获到 ${captured.length} 次 /im/chain/single 请求:`)
  for (let i = 0; i < captured.length; i++) {
    const c = captured[i]
    const body = JSON.parse(c.postData)
    const uplink = body?.uplink_body?.pull_singe_chain_uplink_body
    console.log(`\n[${i + 1}]`)
    console.log("  url:", c.url.split("?")[0])
    console.log("  headers:", JSON.stringify(c.headers))
    console.log("  body:", JSON.stringify({
      anchor_index: uplink?.anchor_index,
      direction: uplink?.direction,
      limit: uplink?.limit,
      conversation_id: uplink?.conversation_id
    }))
  }

  ws.close()
  process.exit(0)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
