// 验证消息去重和额外对话情况
const http = require('http')

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

async function main() {
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
            // 1. 列出所有对话
            var convList = convs.map(function(c) {
              return { id: c.id, messageCount: c.messageCount, title: c.title };
            });
            // 2. 检查 doubao:11111111111111111 的消息是否有重复 turnId
            var targetMsgs = allMsgs.filter(function(m) {
              return m.convId === 'doubao:11111111111111111';
            });
            var turnIds = targetMsgs.map(function(m) { return m.turnId; });
            var uniqueTurnIds = new Set(turnIds);
            // 3. 检查 raw 表中有多少条 /im/chain/single 的记录
            var chainRaws = allRaws.filter(function(r) {
              return r.url && r.url.indexOf('/im/chain/single') >= 0;
            });
            // 4. 检查 raw 表中各 URL 分布
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
}, 15000)
