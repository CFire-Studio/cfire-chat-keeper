// 查询 IndexedDB raw 表中 /im/chain/single 的 URL，找出分页参数差异
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
  const sw = list.find((t) => t.type === "service_worker" && t.url.includes("background/index.js"))
  if (!sw) throw new Error("extension service worker not found")

  const ws = new WebSocket(sw.webSocketDebuggerUrl)
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

  const expr = `
  (async function() {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("cfire-chat-keeper");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction("raw", "readonly");
      const req = tx.objectStore("raw").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const chains = all.filter(r => r.url.includes("/im/chain/single")).sort((a, b) => b.capturedAt - a.capturedAt);
    return JSON.stringify({
      count: chains.length,
      urls: chains.slice(0, 10).map(r => r.url)
    });
  })()
  `
  const res = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  })
  const data = JSON.parse(res.result?.result?.value || "{}")
  console.log("Chain count:", data.count)
  data.urls?.forEach((u, i) => console.log(`[${i}] ${u}`))

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
