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

  // Check: is __ACK_HOOK__ set? Are collector scripts loaded?
  let r = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ hasHook: !!window.__ACK_HOOK__, hasCollector: !!document.querySelector("script[src*=\\"collector\\"]"), allScripts: Array.from(document.scripts).map(s => ({ src: s.src, async: s.async, defer: s.defer })), documentStart: document.readyState })',
    returnByValue: true
  });
  console.log('=== PAGE DIAGNOSTICS ===');
  console.log(r.result?.value || 'empty');

  // Check if the extension's content script has been injected
  r = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ extId: chrome?.runtime?.id, isExtensionContext: !!chrome?.runtime })',
    returnByValue: true
  });
  console.log('\n=== EXTENSION CONTEXT ===');
  console.log(r.result?.value || 'empty');

  // Now manually trigger the API to see if hook fires
  r = await send('Runtime.evaluate', {
    expression: '(async () => { try { const resp = await fetch("/backend-api/conversation/6a4496a9-1de4-83e8-9832-7d42127caf4d"); const json = await resp.json(); const msgsWithImages = Object.values(json.mapping || {}).filter(n => { const m = n?.message; return m && (m.content?.parts || []).some(p => p && typeof p === "object" && p.content_type); }).length; return JSON.stringify({ status: resp.status, msgCount: Object.values(json.mapping || {}).length, msgsWithImageParts: msgsWithImages, title: json.title }); } catch(e) { return JSON.stringify({ error: e.message }); } })()',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('\n=== API RESPONSE ===');
  console.log(r.result?.value || 'empty');

  ws.close();
})().catch(console.error);
