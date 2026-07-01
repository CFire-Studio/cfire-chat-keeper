const WebSocket = require("ws");

const BG_WS = "ws://127.0.0.1:9222/devtools/page/D632D604286E59499CE16900D5C3148B";
const PAGE_WS = "ws://127.0.0.1:9222/devtools/page/6244ECD91C78AE6C0144D973236A978B";

function makeClient(wsUrl) {
  let mid = 0;
  const pend = new Map();
  const ws = new WebSocket(wsUrl);
  ws.on("message", d => {
    const m = JSON.parse(d.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  function send(method, params = {}) {
    return new Promise(r => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  }
  return { ws, send, waitOpen: () => new Promise(r => ws.once("open", r)) };
}

(async () => {
  // 1. Check extension storage for conversations and messages
  const bg = makeClient(BG_WS);
  await bg.waitOpen();
  await bg.send("Runtime.enable");

  let r = await bg.send("Runtime.evaluate", {
    expression: "chrome.storage.local.get(null).then(all => { const keys = Object.keys(all); const convs = keys.filter(k => k.startsWith('conv:')); return JSON.stringify(convs.map(k => ({ key: k, id: all[k].id, title: all[k].title, site: all[k].site, imageCount: all[k].imageCount, messageCount: all[k].messageCount }))) })",
    returnByValue: true,
    awaitPromise: true
  });
  console.log("=== STORED CONVERSATIONS ===");
  console.log(r.result?.value || "empty");

  // Check messages for a chatgpt conversation with images
  r = await bg.send("Runtime.evaluate", {
    expression: "chrome.storage.local.get(null).then(all => { const keys = Object.keys(all); const msgKeys = keys.filter(k => k.startsWith('msg:')); return JSON.stringify({ totalMsgKeys: msgKeys.length, sample: msgKeys.slice(0, 5) }) })",
    returnByValue: true,
    awaitPromise: true
  });
  console.log("\n=== MESSAGE KEYS ===");
  console.log(r.result?.value || "empty");

  bg.ws.close();

  // 2. On the ChatGPT page, intercept the conversation API response
  const page = makeClient(PAGE_WS);
  await page.waitOpen();
  await page.send("Runtime.enable");
  
  // Check if there are generated images in DOM that might not be in API
  r = await page.send("Runtime.evaluate", {
    expression: "JSON.stringify(Array.from(document.querySelectorAll('[data-message-author-role=\"assistant\"] img')).map(img => ({ src: img.src.slice(0, 300), w: img.naturalWidth || img.width, alt: img.alt, parentClass: (img.closest('[class*=\"gen\"]') || img.parentElement)?.className?.toString()?.slice(0, 100) })))",
    returnByValue: true
  });
  console.log("\n=== ASSISTANT IMAGES IN DOM ===");
  console.log(r.result?.value || "empty");

  page.ws.close();
  console.log("\nDone");
})().catch(console.error);
