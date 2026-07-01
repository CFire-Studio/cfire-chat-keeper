const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/FB3F3CC387ED63547B0A07A890595214');
let mid = 0, pend = new Map();
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
function send(method, params = {}) {
  return new Promise(r => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
}
(async () => {
  await new Promise(r => ws.once('open', r));
  await send('Runtime.enable');

  // Try the proper API URL (active conversation)
  let r = await send('Runtime.evaluate', {
    expression: '(async () => { const resp = await fetch("/backend-api/conversations?offset=0&limit=1&order=updated"); const json = await resp.json(); return JSON.stringify({ status: resp.status, itemCount: json.items?.length, firstId: json.items?.[0]?.id, firstTitle: json.items?.[0]?.title }); })()',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('=== CONVERSATIONS LIST ===');
  console.log(r.result?.value || 'empty');

  // Get the first conversation's full data
  r = await send('Runtime.evaluate', {
    expression: '(async () => { const resp = await fetch("/backend-api/conversations?offset=0&limit=1&order=updated"); const json = await resp.json(); if (!json.items?.length) return "no items"; const id = json.items[0].id; const cResp = await fetch("/backend-api/conversation/" + id); const cJson = await cResp.json(); const msgs = Object.values(cJson.mapping || {}); const msgsWithImages = msgs.filter(n => { const m = n?.message?.content?.parts || []; return m.some(p => p && typeof p === "object" && p.content_type === "image_asset_pointer"); }); return JSON.stringify({ convId: id, title: cJson.title, totalMsgs: msgs.length, msgsWithImageParts: msgsWithImages.length, imagePartsDetail: msgsWithImages.slice(0, 3).map(n => ({ parts: n.message.content.parts.filter(p => typeof p === "object").map(p => JSON.stringify(p).slice(0, 300)) })) }); })()',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('\n=== CONVERSATION WITH IMAGES ===');
  console.log(r.result?.value || 'empty');

  // Now test the postMessage pipeline: trigger a fetch and listen in main world
  r = await send('Runtime.evaluate', {
    expression: '(() => { let received = false; const handler = (ev) => { if (ev.data?.__tag === "ACK_NET") { received = true; } }; window.addEventListener("message", handler); fetch("/backend-api/conversations?offset=0&limit=1&order=updated").then(() => { setTimeout(() => { window.removeEventListener("message", handler); console.log("POST_MESSAGE_TEST:", received); }, 500); }); return "started"; })()',
    returnByValue: true
  });
  console.log('\n=== POSTMESSAGE TEST ===');
  console.log(r.result?.value || 'empty');

  ws.close();
})().catch(console.error);
