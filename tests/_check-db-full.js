// 查询 IndexedDB 中豆包对话的完整信息（conversations + messages）
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
    const DB_NAME = "cfire-chat-keeper";
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const convs = await new Promise((resolve, reject) => {
      const tx = db.transaction("conversations", "readonly");
      const req = tx.objectStore("conversations").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const result = { conversations: [] };
    for (const c of convs) {
      const msgs = await new Promise((resolve, reject) => {
        const tx = db.transaction("messages", "readonly");
        const idx = tx.objectStore("messages").index("convId");
        const req = idx.getAll(c.id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      result.conversations.push({
        id: c.id,
        title: c.title,
        url: c.url.slice(0, 120),
        messageCount: c.messageCount,
        actualMessages: msgs.length,
        sample: msgs.slice(-3).map(m => ({ role: m.role, content: m.content.slice(0, 80).replace(/\\n/g, " "), images: m.images?.length ?? 0 }))
      });
    }
    return JSON.stringify(result);
  })()
  `
  const res = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  })
  console.log("=== DB Full State ===")
  console.log(res.result?.result?.value)

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
