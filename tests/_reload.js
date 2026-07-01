const WebSocket = require('ws');
const BG_WS = 'ws://127.0.0.1:9222/devtools/page/D632D604286E59499CE16900D5C3148B';
let mid = 0, pend = new Map();
const ws = new WebSocket(BG_WS);
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    console.log('[BG:' + m.params.type + ']', m.params.args.map(a => a.value??a.description??'').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('[BG:ERROR]', JSON.stringify(m.params.exceptionDetails));
  }
});
function send(method, params = {}) {
  return new Promise(r => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
}
(async () => {
  await new Promise(r => ws.once('open', r));
  await send('Runtime.enable');

  // Check registerContentScripts result
  let r = await send('Runtime.evaluate', {
    expression: 'chrome.scripting.getRegisteredContentScripts().then(s => JSON.stringify(s.map(x => ({ id: x.id, matches: x.matches, allFrames: x.allFrames, runAt: x.runAt }))))',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('=== REGISTERED SCRIPTS ===');
  console.log(r.result?.value || 'empty');

  // Now navigate the ChatGPT page to reload
  const PAGE_WS = 'ws://127.0.0.1:9222/devtools/page/FB3F3CC387ED63547B0A07A890595214';
  const pageWs = new WebSocket(PAGE_WS);
  let mid2 = 0, pend2 = new Map();
  pageWs.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m.result); pend2.delete(m.id); }
  });
  function pageSend(method, params = {}) {
    return new Promise(r => { const i = ++mid2; pend2.set(i, r); pageWs.send(JSON.stringify({ id: i, method, params })); });
  }
  await new Promise(r => pageWs.once('open', r));
  await pageSend('Runtime.enable');
  
  // Reload the page
  await pageSend('Page.enable');
  await pageSend('Page.reload', { ignoreCache: true });
  
  // Wait for load
  await new Promise(r => setTimeout(r, 3000));

  // Check scripts after reload
  let r2 = await pageSend('Runtime.evaluate', {
    expression: 'JSON.stringify(Array.from(document.querySelectorAll("script")).map(s => s.src).filter(Boolean))',
    returnByValue: true
  });
  console.log('\n=== SCRIPTS AFTER RELOAD ===');
  console.log(r2.result?.value || 'empty');

  // Wait for API interception to happen
  await new Promise(r => setTimeout(r, 5000));

  // Check storage
  r = await send('Runtime.evaluate', {
    expression: 'chrome.storage.local.get(null).then(all => { const keys = Object.keys(all); const convs = keys.filter(k => k.startsWith("conv:")); return JSON.stringify({ totalKeys: keys.length, convs: convs.map(k => ({ id: all[k].id, title: all[k].title, imageCount: all[k].imageCount })) }) })',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('\n=== STORAGE AFTER RELOAD ===');
  console.log(r.result?.value || 'empty');

  ws.close(); pageWs.close();
})().catch(console.error);
