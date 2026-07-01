const WebSocket = require('ws');
const PAGE_WS = 'ws://127.0.0.1:9222/devtools/page/6244ECD91C78AE6C0144D973236A978B';
const BG_WS = 'ws://127.0.0.1:9222/devtools/page/D632D604286E59499CE16900D5C3148B';
function makeClient(wsUrl) {
  let mid = 0;
  const pend = new Map();
  const ws = new WebSocket(wsUrl);
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  function send(method, params = {}) {
    return new Promise(r => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  }
  return { ws, send, waitOpen: () => new Promise(r => ws.once('open', r)) };
}
(async () => {
  const page = makeClient(PAGE_WS);
  await page.waitOpen();
  await page.send('Runtime.enable');

  // Check loaded scripts on page
  let r = await page.send('Runtime.evaluate', {
    expression: 'JSON.stringify(Array.from(document.querySelectorAll("script")).map(s => s.src).filter(Boolean))',
    returnByValue: true
  });
  console.log('=== SCRIPTS ON PAGE ===');
  console.log(r.result?.value || 'empty');

  // Check if collector is loaded
  r = await page.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ hasCollector: document.querySelectorAll("script[src*=\\"collector\\"]").length > 0, hasMainWorld: document.querySelectorAll("script[src*=\\"main-world\\"]").length > 0 })',
    returnByValue: true
  });
  console.log('\n=== SCRIPT PRESENCE ===');
  console.log(r.result?.value || 'empty');

  page.ws.close();

  // Now check extension storage 
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

  bg.ws.close();
  console.log('\nDone');
})().catch(console.error);
