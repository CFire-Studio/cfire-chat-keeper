const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/D632D604286E59499CE16900D5C3148B');
let mid = 0, pend = new Map();
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (text.includes('error') || text.includes('Error') || text.includes('fail') || text.includes('script') || text.includes('inject')) {
      console.log('[BG:' + m.params.type + ']', text);
    }
  }
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('[BG:ERROR]', JSON.stringify(m.params.exceptionDetails?.text || m.params.exceptionDetails));
  }
});
function send(method, params = {}) {
  return new Promise(r => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
}
(async () => {
  await new Promise(r => ws.once('open', r));
  await send('Runtime.enable');
  
  // Check extension installation info
  let r = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ manifestVersion: chrome.runtime.getManifest().manifest_version, name: chrome.runtime.getManifest().name })',
    returnByValue: true
  });
  console.log('=== EXT INFO ===');
  console.log(r.result?.value || 'empty');

  // Check if there are any tabs with the content script
  r = await send('Runtime.evaluate', {
    expression: 'chrome.tabs.query({}).then(tabs => { const scripted = []; return Promise.all(tabs.filter(t => t.url && (t.url.includes("chatgpt") || t.url.includes("deepseek") || t.url.includes("doubao"))).map(t => { return chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => ({ scripts: Array.from(document.scripts).map(s => s.src) }) }).then(r => ({ id: t.id, url: t.url, scripts: r[0]?.result })).catch(e => ({ id: t.id, url: t.url, error: e.message })) })).then(results => JSON.stringify(results)) })',
    returnByValue: true,
    awaitPromise: true
  });
  console.log('\n=== EXECUTED SCRIPT RESULT ===');
  console.log(r.result?.value || 'empty');

  // Try to manually inject collector
  const tabId = (await send('Runtime.evaluate', {
    expression: 'chrome.tabs.query({url: "https://chatgpt.com/*"}).then(t => t[0]?.id || -1)',
    returnByValue: true,
    awaitPromise: true
  })).result?.value;
  console.log('\nChatGPT tab ID:', tabId);

  ws.close();
})().catch(console.error);
