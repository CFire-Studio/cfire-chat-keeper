// 唤醒 SW + 验证去重
const http = require('http')

const pageWsUrl = 'ws://127.0.0.1:9222/devtools/page/631E9200705521F0198EA634C53F39EE'

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  // 1. 重载页面唤醒 SW
  console.log('Waking SW by reloading page...')
  const pageWs = new WebSocket(pageWsUrl)
  await new Promise((resolve, reject) => {
    pageWs.addEventListener('open', () => {
      pageWs.send(JSON.stringify({ id: 1, method: 'Page.enable' }))
      pageWs.send(JSON.stringify({ id: 2, method: 'Page.reload' }))
      resolve()
    }, { once: true })
    pageWs.addEventListener('error', reject, { once: true })
  })
  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Page.loadEventFired') {
        pageWs.removeEventListener('message', handler)
        resolve()
      }
    }
    pageWs.addEventListener('message', handler)
  })
  pageWs.close()
  console.log('Page reloaded, waiting 8s...')
  await sleep(8000)

  // 2. 找到 SW
  const targets = await fetchJson('http://127.0.0.1:9222/json')
  const sw = targets.find(
    (t) =>
      t.type === 'service_worker' &&
      t.url &&
      t.url.indexOf('chrome-extension://') === 0
  )
  if (!sw) {
    console.error('No SW found')
    process.exit(1)
  }

  // 3. 查询 DB
  const ws = new WebSocket(sw.webSocketDebuggerUrl)
  let msgId = 0

  await new Promise((resolve) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }))
      resolve()
    })
  })
  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === 1) {
        ws.removeEventListener('message', handler)
        resolve()
      }
    }
    ws.addEventListener('message', handler)
  })

  const expr = `
    (async function() {
      return new Promise(function(resolve) {
        var req = indexedDB.open('cfire-chat-keeper');
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction(['conversations', 'messages', 'raw'], 'readonly');
          var convStore = tx.objectStore('conversations');
          var msgStore = tx.objectStore('messages');
          var rawStore = tx.objectStore('raw');
          var convs = [], allMsgs = [], allRaws = [];
          convStore.getAll().onsuccess = function(e) { convs = e.target.result || []; };
          msgStore.getAll().onsuccess = function(e) { allMsgs = e.target.result || []; };
          rawStore.getAll().onsuccess = function(e) { allRaws = e.target.result || []; };
          tx.oncomplete = function() {
            var convList = convs.map(function(c) {
              return { id: c.id, messageCount: c.messageCount, title: (c.title||'').substring(0,40) };
            });
            var targetMsgs = allMsgs.filter(function(m) {
              return m.convId === 'doubao:38427006775604738';
            });
            var turnIds = targetMsgs.map(function(m) { return m.turnId; });
            var uniqueTurnIds = new Set(turnIds);
            var chainRaws = allRaws.filter(function(r) {
              return r.url && r.url.indexOf('/im/chain/single') >= 0;
            });
            var urlCounts = {};
            allRaws.forEach(function(r) {
              var key = r.url ? r.url.split('?')[0] : 'unknown';
              urlCounts[key] = (urlCounts[key] || 0) + 1;
            });
            resolve(JSON.stringify({
              convs: convList,
              targetMsgCount: targetMsgs.length,
              uniqueTurnIds: uniqueTurnIds.size,
              hasDuplicates: turnIds.length !== uniqueTurnIds.size,
              chainRawCount: chainRaws.length,
              totalRaws: allRaws.length,
              urlDistribution: urlCounts
            }, null, 2));
          };
        };
      });
    })()
  `

  const result = await new Promise((resolve) => {
    const id = ++msgId
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id && msg.result) {
        ws.removeEventListener('message', handler)
        resolve(msg.result.result.value)
      }
    }
    ws.addEventListener('message', handler)
    ws.send(
      JSON.stringify({
        id: id,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true, awaitPromise: true }
      })
    )
  })

  console.log(result)
  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})

setTimeout(() => {
  console.error('TIMEOUT')
  process.exit(1)
}, 30000)
