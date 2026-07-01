const WebSocket = require('ws');
const PAGE_WS = 'ws://127.0.0.1:9222/devtools/page/FB3F3CC387ED63547B0A07A890595214';
const BG_WS = 'ws://127.0.0.1:9222/devtools/page/D632D604286E59499CE16900D5C3148B';
function makeClient(wsUrl) {
  let mid = 0; const pend = new Map();
  const ws = new WebSocket(wsUrl);
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  function send(method, params = {}) { return new Promise(r => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }); }
  return { ws, send, waitOpen: () => new Promise(r => ws.once('open', r)) };
}
(async () => {
  const page = makeClient(PAGE_WS);
  await page.waitOpen();
  await page.send('Runtime.enable');

  // 1. Check scripts
  let r = await page.send('Runtime.evaluate', {
    expression: 'JSON.stringify(Array.from(document.querySelectorAll("script")).map(s => s.src).filter(Boolean))',
    returnByValue: true
  });
  console.log('=== SCRIPTS ON PAGE ===');
  console.log(r.result?.value || 'empty');

  // 2. Fetch conversation API and inspect image parts
  r = await page.send('Runtime.evaluate', {
    expression: '(async () => { const resp = await fetch("/backend-api/conversation/6a4496a9-1de4-83e8-9832-7d42127caf4d"); const json = await resp.json(); const msgs = Object.values(json.mapping || {}).map(n => { const m = n?.message; if (!m) return null; const parts = m.content?.parts || []; const imgParts = parts.filter(p => p && typeof p === "object" && (p.content_type === "image_asset_pointer" || p.content_type?.includes("image"))); return { id: m.id, role: m.author?.role, totalParts: parts.length, imagePartCount: imgParts.length, imageParts: imgParts.map(ip => ({ contentType: ip.content_type, keys: Object.keys(ip), hasAssetPointer: !!ip.asset_pointer, hasImageUrl: !!ip.image_url, hasImageAsset: !!ip.image_asset, sample: JSON.stringify(ip).slice(0, 300) })) }; }).filter(Boolean); return JSON.stringify(msgs, null, 2) })()',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('\n=== API RESPONSE - MESSAGE IMAGE PARTS ===');
  console.log(r.result?.value || 'empty');

  // 3. Check DOM for generated images
  r = await page.send('Runtime.evaluate', {
    expression: 'JSON.stringify(Array.from(document.querySelectorAll("[data-message-author-role=\\"assistant\\"]")).map((el,i) => ({ idx: i, hasImg: el.querySelectorAll("img").length, htmlSlice: el.innerHTML.slice(0, 500) })))',
    returnByValue: true
  });
  console.log('\n=== ASSISTANT DOM SAMPLES ===');
  console.log(r.result?.value || 'empty');

  // 4. Storage state
  const bg = makeClient(BG_WS);
  await bg.waitOpen();
  await bg.send('Runtime.enable');
  r = await bg.send('Runtime.evaluate', {
    expression: 'chrome.storage.local.get(null).then(all => { const keys = Object.keys(all); return JSON.stringify({ totalKeys: keys.length, keys: keys }) })',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('\n=== EXTENSION STORAGE ===');
  console.log(r.result?.value || 'empty');

  page.ws.close(); bg.ws.close();
  console.log('\nDone');
})().catch(console.error);
