// 独立验证：不依赖扩展，直接用 CDP 在豆包页面批量拉取 /im/chain/single 历史。
// 验证目标：
//   1) 确认分页参数是 next_index
//   2) 测量批量拉取速度/完整性
//   3) 确认不会触发限流
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
  if (!page) throw new Error(`未找到豆包 bot 页面，请先打开 ${TARGET_URL_PREFIX}*`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.once("open", resolve)
    ws.once("error", reject)
  })

  let msgId = 0
  const pending = new Map()
  ws.on("message", (buf) => {
    const msg = JSON.parse(buf.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  await send("Runtime.enable")
  await send("Network.enable")

  // 监听 /im/chain/single 的请求与响应
  let capturedRequestId = null
  let capturedPostData = null
  let capturedUrl = null
  let responseReceived = false

  ws.on("message", (buf) => {
    const msg = JSON.parse(buf.toString())
    if (msg.method === "Network.requestWillBeSent") {
      const req = msg.params.request
      if (req.url && req.url.includes("/im/chain/single") && req.method === "POST") {
        capturedRequestId = msg.params.requestId
        capturedPostData = req.postData
        capturedUrl = req.url
      }
    }
    if (msg.method === "Network.responseReceived") {
      if (msg.params.requestId === capturedRequestId) {
        responseReceived = true
      }
    }
  })

  // 向上滚动触发一次 /im/chain/single
  console.log("触发第一次 /im/chain/single 请求...")
  const scrollExpr = `
    (function() {
      const scroller = document.querySelector('[class*="v_list_scroller"]')
      if (!scroller) return 'no scroller'
      scroller.scrollTop = 0
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -scroller.clientHeight * 2, bubbles: true }))
      return 'scrolled'
    })()
  `
  await send("Runtime.evaluate", { expression: scrollExpr, returnByValue: true })

  // 等待响应
  let waited = 0
  while (!responseReceived && waited < 10000) {
    await sleep(200)
    waited += 200
  }
  if (!capturedPostData || !capturedUrl) {
    throw new Error("未能捕获 /im/chain/single 请求体，请确认页面已登录并有历史记录")
  }

  console.log("已捕获请求体，开始批量拉取...")

  // 获取第一次响应体
  const firstBodyRes = await send("Network.getResponseBody", { requestId: capturedRequestId })
  const firstBody = firstBodyRes.result?.body
  const firstJson = JSON.parse(firstBody)
  const chain = firstJson?.downlink_body?.pull_singe_chain_downlink_body
  console.log("第一页:", chain.messages.length, "条, has_more:", chain.has_more, "next_index:", chain.next_index)

  // 用页面 fetch 循环拉取
  const start = Date.now()
  const stats = await send("Runtime.evaluate", {
    expression: `
      (async function() {
        const url = ${JSON.stringify(capturedUrl)}
        const baseReq = ${capturedPostData}
        let nextIndex = ${JSON.stringify(chain.next_index)}
        let total = ${chain.messages.length}
        let pages = 1
        const maxPages = 2000
        const delay = 80

        while (nextIndex && pages < maxPages) {
          if (!baseReq.uplink_body) baseReq.uplink_body = {}
          if (!baseReq.uplink_body.pull_single_chain_uplink_body) baseReq.uplink_body.pull_single_chain_uplink_body = {}
          baseReq.uplink_body.pull_single_chain_uplink_body.next_index = nextIndex

          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(baseReq)
          })
          const data = await res.json()
          const c = data?.downlink_body?.pull_singe_chain_downlink_body
          if (!c) break
          total += (c.messages || []).length
          pages++
          if (c.has_more === false || !c.next_index) break
          nextIndex = c.next_index
          if (pages > 1) await new Promise(r => setTimeout(r, delay))
        }

        return JSON.stringify({ pages, total, reachedTop: !nextIndex, lastNextIndex: nextIndex })
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  })

  const result = JSON.parse(stats.result?.result?.value || "{}")
  console.log("批量拉取完成:", result)
  console.log("耗时:", Date.now() - start, "ms")

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
