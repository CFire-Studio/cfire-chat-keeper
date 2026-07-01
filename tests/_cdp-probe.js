// CDP probe: inspect ChatGPT page DOM for AI-generated images
const WebSocket = require("ws")

const WS_URL = "ws://127.0.0.1:9222/devtools/page/6244ECD91C78AE6C0144D973236A978B"

let msgId = 0
const pending = new Map()

const ws = new WebSocket(WS_URL)

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
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

async function main() {
  await new Promise(resolve => ws.once("open", resolve))
  await send("Runtime.enable")

  // 1. Check all message DOM with image-related content
  console.log("=== 1. Message DOM image scan ===")
  let r = await send("Runtime.evaluate", {
    expression: `
(() => {
  const out = []
  document.querySelectorAll('[data-message-author-role]').forEach((el, i) => {
    const role = el.dataset.messageAuthorRole
    const imgs = el.querySelectorAll('img')
    imgs.forEach((img, j) => {
      out.push({
        msgIdx: i, imgIdx: j, role,
        src: (img.src || '').slice(0, 200),
        w: img.naturalWidth || img.width,
        h: img.naturalHeight || img.height,
        alt: (img.alt || '').slice(0, 100),
        parentTag: img.parentElement?.tagName,
        parentClass: (img.parentElement?.className || '').toString().slice(0, 100)
      })
    })
  })
  return JSON.stringify(out, null, 2)
})()`,
    returnByValue: true
  })
  console.log(r.result?.value || "empty")

  // 2. Find all elements with image/generated-related CSS classes
  console.log("\n=== 2. Image-related elements ===")
  r = await send("Runtime.evaluate", {
    expression: `
(() => {
  const out = []
  const seen = new Set()
  document.querySelectorAll('[data-message-author-role]').forEach((el, i) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT)
    let node
    while (node = walker.nextNode()) {
      const cls = (node.className || '').toString()
      const tag = node.tagName
      const ds = JSON.stringify(node.dataset || {})
      const key = tag + '|' + cls.slice(0, 50)
      if (
        cls.match(/image|generated|dalle|asset|gen_img|img/i) ||
        ds.match(/image|asset|file_id|gen_img/i) ||
        tag === 'IMG'
      ) {
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          msgIdx: i, tag,
          classSample: cls.slice(0, 200),
          dataset: ds.slice(0, 200),
          textSample: (node.textContent || '').slice(0, 80)
        })
        if (out.length > 60) break
      }
    }
  })
  return JSON.stringify(out, null, 2)
})()`,
    returnByValue: true
  })
  console.log(r.result?.value || "empty")

  ws.close()
  console.log("\nDone")
}

main().catch(console.error)