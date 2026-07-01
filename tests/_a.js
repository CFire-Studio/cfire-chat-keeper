const WebSocket = require("ws")
const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/6244ECD91C78AE6C0144D973236A978B")
let mid = 0
const pend = new Map()
ws.on("message", d => {
  const m = JSON.parse(d.toString())
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) }
})
function send(method, params = {}) {
  return new Promise(r => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
}
(async () => {
  await new Promise(r => ws.once("open", r))
  await send("Runtime.enable")
  const expr1 = "(() => { const out = []; document.querySelectorAll('[data-message-author-role]').forEach((el, i) => { const role = el.dataset.messageAuthorRole; el.querySelectorAll('img').forEach((img, j) => { out.push({ msgIdx: i, imgIdx: j, role, src: (img.src || '').slice(0, 300), w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, alt: (img.alt || '').slice(0, 100), parentTag: img.parentElement && img.parentElement.tagName, parentClass: (img.parentElement && img.parentElement.className || '').toString().slice(0, 150) }) }) }); return JSON.stringify(out, null, 2) })()"
  let r = await send("Runtime.evaluate", { expression: expr1, returnByValue: true })
  console.log("=== IMG SCAN ===")
  console.log(r.result && r.result.value || "empty")
  const expr2 = "(() => { const out = []; const seen = new Set(); document.querySelectorAll('[data-message-author-role]').forEach((el, i) => { const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT); let node; while (node = walker.nextNode()) { const cls = (node.className || '').toString(); const tag = node.tagName; const ds2 = JSON.stringify(node.dataset || {}); if (cls.match(/image|generated|dalle|asset|gen_img|img/i) || ds2.match(/image|asset|file_id|gen_img/i) || tag === 'IMG') { const key = tag + '|' + cls.slice(0, 60); if (seen.has(key)) continue; seen.add(key); out.push({ msgIdx: i, tag, classSample: cls.slice(0, 250), dataset: ds2.slice(0, 200), textSample: (node.textContent || '').slice(0, 80) }); if (out.length > 80) break } } }); return JSON.stringify(out, null, 2) })()"
  r = await send("Runtime.evaluate", { expression: expr2, returnByValue: true })
  console.log("\n=== IMG-RELATED ELEMENTS ===")
  console.log(r.result && r.result.value || "empty")
  ws.close()
  console.log("\nDone")
})().catch(console.error)
