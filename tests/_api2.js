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

  // Fetch the active conversations list to get real conversation IDs
  let r = await send('Runtime.evaluate', {
    expression: (async () => {
      // Try multiple API endpoints
      const results = {};
      
      // 1. Try the conversations list
      try {
        const r1 = await fetch('/backend-api/conversations?offset=0&limit=5&order=updated');
        results.conversations = { status: r1.status, ok: r1.ok };
        if (r1.ok) {
          const data = await r1.json();
          results.conversations.items = data.items?.map(i => ({ id: i.id, title: i.title })) || [];
        }
      } catch(e) { results.conversations = { error: e.message }; }

      // 2. Try history API 
      try {
        const r2 = await fetch('/backend-api/conversations?offset=0&limit=5');
        results.history = { status: r2.status };
        if (r2.ok) {
          const data = await r2.json();
          if (data.items?.length) {
            const cid = data.items[0].id;
            const r3 = await fetch('/backend-api/conversation/' + cid);
            if (r3.ok) {
              const cdata = await r3.json();
              const msgs = Object.values(cdata.mapping || {});
              const allParts = [];
              msgs.forEach(n => {
                const parts = n?.message?.content?.parts || [];
                parts.forEach(p => {
                  if (typeof p === 'object' && p !== null) {
                    allParts.push({ msgId: n?.message?.id, partKeys: Object.keys(p), contentType: p.content_type, sample: JSON.stringify(p).slice(0, 500) });
                  }
                });
              });
              results.conversation = { id: cid, title: cdata.title, msgCount: msgs.length, nonTextParts: allParts.slice(0, 20) };
            }
          }
        }
      } catch(e) { results.history = { error: e.message }; }

      return JSON.stringify(results, null, 2);
    })(),
    returnByValue: true,
    awaitPromise: true
  });
  console.log('=== API RESULTS ===');
  console.log(r.result?.value || 'empty');

  ws.close();
})().catch(console.error);
