// 临时探测脚本：通过 CDP 打开豆包内置智能体页面，捕获网络响应与 DOM 结构
const WebSocket = require("ws")
const http = require("http")

const TARGET_URL = "https://www.doubao.com/chat/bot/chat/5555555555555555555"
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

function cdp(ws) {
  let id = 0
  const pending = new Map()
  const handlers = []
  ws.on("message", (buf) => {
    const msg = JSON.parse(buf.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
    handlers.forEach((h) => h(msg))
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        const mid = ++id
        pending.set(mid, resolve)
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
    },
    onEvent(handler) {
      handlers.push(handler)
    }
  }
}

async function main() {
  const tabs = await fetchJson("/json/list")
  // 找一个普通 page 标签，优先豆包标签
  let tab = tabs.find((t) => t.type === "page" && t.url && t.url.includes("doubao.com"))
  if (!tab) tab = tabs.find((t) => t.type === "page")
  if (!tab) throw new Error("no page tab")
  console.log("Using tab:", tab.id, tab.url)

  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.once("open", resolve)
    ws.once("error", reject)
  })
  const c = cdp(ws)

  await c.send("Runtime.enable")
  await c.send("Network.enable")
  await c.send("Page.enable")

  const bodies = new Map() // requestId -> {url, type, body?}
  const domSnapshots = []

  c.onEvent(async (msg) => {
    if (msg.method === "Network.responseReceived") {
      const r = msg.params.response
      const url = r.url
      if (
        url.includes("/im/chain") ||
        url.includes("/im/message") ||
        url.includes("/im/conversation") ||
        url.includes("/samantha/") ||
        url.includes("/alice/")
      ) {
        bodies.set(msg.params.requestId, { url, type: r.mimeType })
      }
    }
    if (msg.method === "Network.loadingFinished") {
      const reqId = msg.params.requestId
      if (bodies.has(reqId)) {
        try {
          const res = await c.send("Network.getResponseBody", { requestId: reqId })
          bodies.get(reqId).body = res.result.base64Encoded
            ? Buffer.from(res.result.body, "base64").toString()
            : res.result.body
        } catch (e) {
          bodies.get(reqId).error = String(e)
        }
      }
    }
  })

  console.log("Navigating to", TARGET_URL)
  await c.send("Page.navigate", { url: TARGET_URL })

  // 等待页面加载与 API 调用
  await new Promise((r) => setTimeout(r, 8000))

  // 保存完整响应体到文件
  const fs = require("fs")
  const chainBodies = []
  for (const [reqId, info] of bodies) {
    if (info.url.includes("/im/chain/single") && info.body) {
      chainBodies.push({ url: info.url, body: info.body })
    }
  }
  if (chainBodies.length > 0) {
    fs.writeFileSync(
      "tests/_probe-doubao-bot-chain.json",
      JSON.stringify(chainBodies, null, 2)
    )
    console.log("Saved", chainBodies.length, "chain bodies to tests/_probe-doubao-bot-chain.json")
  }

  // 多次采样 DOM 结构
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const domRes = await c.send("Runtime.evaluate", {
      expression: `
(() => {
  const url = location.href
  const pathname = location.pathname
  const msgList = document.querySelector('[class*="message-list"]')
  const scroller = document.querySelector('[class*="v_list_scroller"]')
  const sendBubbles = document.querySelectorAll('[class*="bg-g-send"]').length
  const actionBars = document.querySelectorAll('[class*="message-action-bar"]').length
  const allClasses = new Set()
  document.querySelectorAll('[class]').forEach(el => {
    const cls = el.getAttribute('class') || ''
    if (/message|v_list|bg-g-send|action-bar|bubble/i.test(cls)) {
      cls.split(/\\s+/).forEach(c => allClasses.add(c))
    }
  })
  const hasContent = !!document.body && document.body.innerText.length > 0
  return JSON.stringify({ url, pathname, hasContent, rows: msgList ? msgList.querySelectorAll('*').length : 0, hasScroller: !!scroller, sendBubbles, actionBars, classes: [...allClasses].slice(0, 80) })
})()`,
      returnByValue: true
    })
    domSnapshots.push(JSON.parse(domRes.result.value || "{}"))
  }

  // 输出网络响应
  console.log("\n=== Network responses ===")
  for (const [reqId, info] of bodies) {
    const preview = info.body ? info.body.slice(0, 600) : "(no body)"
    console.log(`\n[${reqId}] ${info.url}\n`, preview.replace(/\n/g, " "), "\n")
  }

  console.log("\n=== DOM snapshots ===")
  domSnapshots.forEach((s, i) => console.log(`Snapshot ${i}:`, s))

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
