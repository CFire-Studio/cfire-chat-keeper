// 端到端测试：重载扩展 + 重载页面 + 触发 scrollUpLoop + 验证 DB
// 用法: node tests/_e2e-reparse.js <doubao-page-ws-url>

const http = require('http')

const pageWsUrl = process.argv[2]
if (!pageWsUrl) {
  console.error('Usage: node _e2e-reparse.js <doubao-page-ws-url>')
  process.exit(1)
}

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

function findSw() {
  return fetchJson('http://127.0.0.1:9222/json').then((targets) => {
    const sw = targets.find(
      (t) =>
        t.type === 'service_worker' &&
        t.url &&
        t.url.indexOf('chrome-extension://') === 0
    )
    return sw
  })
}

function wsSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9)
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        ws.removeEventListener('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

function evalIn(ws, expression) {
  return wsSend(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
}

function waitForLoadEvent(ws, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('load timeout')), timeoutMs)
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Page.loadEventFired') {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve()
      }
    }
    ws.addEventListener('message', handler)
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  // ============== Step 1: 唤醒旧 SW (通过重载页面) ==============
  console.log('[1/7] Waking SW by reloading doubao page...')
  let pageWs = new WebSocket(pageWsUrl)
  await new Promise((resolve, reject) => {
    pageWs.addEventListener('open', resolve, { once: true })
    pageWs.addEventListener('error', reject, { once: true })
  })
  await wsSend(pageWs, 'Page.enable')
  const loadPromise1 = waitForLoadEvent(pageWs)
  await wsSend(pageWs, 'Page.reload')
  await loadPromise1
  console.log('  Page reloaded, waiting 6s for SW to wake...')
  await sleep(6000)

  // ============== Step 2: 找到旧 SW，重载扩展 ==============
  console.log('[2/7] Finding SW and reloading extension...')
  let sw = await findSw()
  if (!sw) {
    console.error('  No SW found after page reload!')
    process.exit(1)
  }
  console.log('  SW URL:', sw.url)
  let swWs = new WebSocket(sw.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    swWs.addEventListener('open', resolve, { once: true })
    swWs.addEventListener('error', reject, { once: true })
  })
  await wsSend(swWs, 'Runtime.enable')
  // 调用 chrome.runtime.reload() — 会销毁当前 SW，WS 会断开
  swWs.send(
    JSON.stringify({
      id: 999,
      method: 'Runtime.evaluate',
      params: { expression: 'chrome.runtime.reload()' }
    })
  )
  // 不等响应，因为 SW 会立即销毁，WS 会断开
  await sleep(500)
  try {
    swWs.close()
  } catch {}
  console.log('  Extension reload triggered. Waiting 8s...')
  await sleep(8000)

  // ============== Step 3: 重载豆包页面 (注入新 collector) ==============
  console.log('[3/7] Reloading doubao page to inject new collector...')
  // pageWs 可能已断开，重新连接
  try {
    pageWs.close()
  } catch {}
  await sleep(1000)

  // 重新获取页面 WS URL (页面 ID 不变，但 WS 可能需要重连)
  const targets = await fetchJson('http://127.0.0.1:9222/json')
  const page = targets.find(
    (t) =>
      t.type === 'page' &&
      t.url &&
      t.url.indexOf('doubao.com/chat/11111111111111111') >= 0
  )
  if (!page) {
    console.error('  No doubao page found!')
    process.exit(1)
  }
  pageWs = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    pageWs.addEventListener('open', resolve, { once: true })
    pageWs.addEventListener('error', reject, { once: true })
  })
  await wsSend(pageWs, 'Page.enable')
  const loadPromise2 = waitForLoadEvent(pageWs)
  await wsSend(pageWs, 'Page.reload')
  await loadPromise2
  console.log('  Page reloaded. Waiting 12s for content script + initial API...')
  await sleep(12000)

  // ============== Step 4: 找到新 SW ==============
  console.log('[4/7] Finding new SW...')
  sw = await findSw()
  if (!sw) {
    console.error('  No SW found!')
    process.exit(1)
  }
  console.log('  New SW URL:', sw.url)
  swWs = new WebSocket(sw.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    swWs.addEventListener('open', resolve, { once: true })
    swWs.addEventListener('error', reject, { once: true })
  })
  await wsSend(swWs, 'Runtime.enable')

  // ============== Step 5: 查询重载前的 DB 基准状态 ==============
  console.log('[5/7] Querying DB baseline...')
  const baselineExpr = `
    (async function() {
      var dbs = await indexedDB.databases();
      var dbName = 'cfire-chat-keeper';
      var exists = dbs.some(function(d) { return d.name === dbName; });
      if (!exists) return JSON.stringify({ error: 'DB not found' });
      return new Promise(function(resolve) {
        var req = indexedDB.open(dbName);
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction(['conversations', 'messages', 'raw'], 'readonly');
          var convStore = tx.objectStore('conversations');
          var msgStore = tx.objectStore('messages');
          var rawStore = tx.objectStore('raw');
          var convs = [], msgCount = 0, rawCount = 0;
          convStore.getAll().onsuccess = function(e) { convs = e.target.result || []; };
          msgStore.count().onsuccess = function(e) { msgCount = e.target.result; };
          rawStore.count().onsuccess = function(e) { rawCount = e.target.result; };
          tx.oncomplete = function() {
            var doubaoConv = convs.find(function(c) {
              return c.id && c.id.indexOf('doubao:11111111111111111') >= 0;
            });
            resolve(JSON.stringify({
              totalConvs: convs.length,
              totalMsgs: msgCount,
              totalRaws: rawCount,
              doubaoConv: doubaoConv ? {
                id: doubaoConv.id,
                messageCount: doubaoConv.messageCount,
                title: doubaoConv.title
              } : null
            }));
          };
        };
      });
    })()
  `
  const baselineRes = await evalIn(swWs, baselineExpr)
  console.log('  Baseline:', baselineRes.result.value)

  // ============== Step 6: 触发 SCROLL_UP ==============
  console.log('[6/7] Triggering SCROLL_UP (includes scrollUpLoop + REPARSE_RAW)...')
  // 注意：CDP target ID ≠ Chrome tab ID，必须通过 chrome.tabs.query 获取真实 tab ID
  const tabIdExpr = `
    (async function() {
      return new Promise(function(resolve) {
        chrome.tabs.query({}, function(tabs) {
          var d = tabs.find(function(t) {
            return t.url && t.url.indexOf('doubao.com/chat/11111111111111111') >= 0;
          });
          resolve(JSON.stringify({ tabId: d ? d.id : null, url: d ? d.url : null }));
        });
      });
    })()
  `
  const tabIdRes = await evalIn(swWs, tabIdExpr)
  const tabInfo = JSON.parse(tabIdRes.result.value)
  console.log('  Tab:', tabInfo)
  if (!tabInfo.tabId) {
    console.error('  No doubao tab found!')
    process.exit(1)
  }
  const tabId = tabInfo.tabId
  const scrollExpr = `
    (async function() {
      return new Promise(function(resolve) {
        chrome.tabs.sendMessage(${tabId}, { type: 'ack:scroll-up' }, function(response) {
          if (chrome.runtime.lastError) {
            resolve(JSON.stringify({ error: chrome.runtime.lastError.message }));
          } else {
            resolve(JSON.stringify(response));
          }
        });
      });
    })()
  `
  const scrollRes = await evalIn(swWs, scrollExpr)
  console.log('  SCROLL_UP response:', scrollRes.result.value)

  // ============== Step 7: 再次查询 DB ==============
  console.log('[7/7] Querying DB after scrollUpLoop + REPARSE_RAW...')
  await sleep(2000) // 给 DB 写入一点时间
  const afterExpr = `
    (async function() {
      return new Promise(function(resolve) {
        var req = indexedDB.open('cfire-chat-keeper');
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction(['conversations', 'messages', 'raw'], 'readonly');
          var convStore = tx.objectStore('conversations');
          var msgStore = tx.objectStore('messages');
          var rawStore = tx.objectStore('raw');
          var convs = [], msgCount = 0, rawCount = 0;
          convStore.getAll().onsuccess = function(e) { convs = e.target.result || []; };
          msgStore.count().onsuccess = function(e) { msgCount = e.target.result; };
          rawStore.count().onsuccess = function(e) { rawCount = e.target.result; };
          tx.oncomplete = function() {
            var doubaoConv = convs.find(function(c) {
              return c.id && c.id.indexOf('doubao:11111111111111111') >= 0;
            });
            // 统计该对话的消息数
            var msgIdx = db.transaction('messages', 'readonly').objectStore('messages').index('convId');
            var convMsgCount = 0;
            if (doubaoConv) {
              msgIdx.count(IDBKeyRange.only(doubaoConv.id)).onsuccess = function(e) {
                convMsgCount = e.target.result;
                resolve(JSON.stringify({
                  totalConvs: convs.length,
                  totalMsgs: msgCount,
                  totalRaws: rawCount,
                  doubaoConv: doubaoConv ? {
                    id: doubaoConv.id,
                    messageCount: doubaoConv.messageCount,
                    title: doubaoConv.title
                  } : null,
                  doubaoMsgCount: convMsgCount
                }));
              };
            } else {
              resolve(JSON.stringify({
                totalConvs: convs.length,
                totalMsgs: msgCount,
                totalRaws: rawCount,
                doubaoConv: null,
                doubaoMsgCount: 0
              }));
            }
          };
        };
      });
    })()
  `
  const afterRes = await evalIn(swWs, afterExpr)
  console.log('  After:', afterRes.result.value)

  // 直接统计 doubao 对话的消息数（用 convId index）
  const exactExpr = `
    (async function() {
      return new Promise(function(resolve) {
        var req = indexedDB.open('cfire-chat-keeper');
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction('messages', 'readonly');
          var idx = tx.objectStore('messages').index('convId');
          var convId = 'doubao:11111111111111111';
          idx.getAll(IDBKeyRange.only(convId)).onsuccess = function(e) {
            var msgs = e.target.result || [];
            // 取 turnId 列表
            var turnIds = msgs.map(function(m) { return m.turnId; }).sort();
            resolve(JSON.stringify({
              count: msgs.length,
              firstTurnId: turnIds[0],
              lastTurnId: turnIds[turnIds.length - 1],
              firstCreatedAt: msgs.length > 0 ? msgs[0].createdAt : 0,
              lastCreatedAt: msgs.length > 0 ? msgs[msgs.length - 1].createdAt : 0
            }));
          };
        };
      });
    })()
  `
  const exactRes = await evalIn(swWs, exactExpr)
  console.log('  Exact doubao messages:', exactRes.result.value)

  console.log('\nDone.')
  try {
    pageWs.close()
    swWs.close()
  } catch {}
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL:', e.message || String(e))
  process.exit(1)
})

setTimeout(() => {
  console.error('TIMEOUT after 300s')
  process.exit(1)
}, 300000)

