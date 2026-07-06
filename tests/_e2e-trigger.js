// 在 SW 中查询 doubao tab id，然后发送 SCROLL_UP
const wsUrl = process.argv[2]
const ws = new WebSocket(wsUrl)
let msgId = 0
let phase = 'find-tab' // find-tab -> scroll-up -> done

function nextId() { return ++msgId }

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: nextId(), method: 'Runtime.enable' }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)

  // 第一步：查询 doubao tab id
  if (phase === 'find-tab' && msg.id === 1) {
    phase = 'querying'
    console.log('[1/2] Querying doubao tab id...')
    ws.send(JSON.stringify({
      id: nextId(),
      method: 'Runtime.evaluate',
      params: {
        expression: `
        (async function() {
          return new Promise(function(resolve) {
            chrome.tabs.query({}, function(tabs) {
              var doubao = tabs.find(function(t) { return t.url && t.url.indexOf('doubao.com/chat/') >= 0; });
              if (!doubao) {
                resolve(JSON.stringify({ error: 'no doubao tab', tabCount: tabs.length }));
              } else {
                resolve(JSON.stringify({ tabId: doubao.id, url: doubao.url }));
              }
            });
          });
        })()
        `,
        returnByValue: true,
        awaitPromise: true
      }
    }))
  }

  // 第二步：收到 tab id，发送 SCROLL_UP
  if (phase === 'querying' && msg.id === 2 && msg.result) {
    const val = msg.result.result.value
    console.log('  Tab info:', val)
    const info = JSON.parse(val)
    if (info.error) {
      console.error('Error:', info.error)
      ws.close()
      process.exit(1)
    }
    phase = 'scroll-up'
    console.log('[2/2] Sending SCROLL_UP to tab', info.tabId, '...')
    const expr = `
    (async function() {
      return new Promise(function(resolve) {
        chrome.tabs.sendMessage(${info.tabId}, { type: 'ack:scroll-up' }, function(response) {
          if (chrome.runtime.lastError) {
            resolve(JSON.stringify({ error: chrome.runtime.lastError.message }));
          } else {
            resolve(JSON.stringify({ response: response, completedAt: Date.now() }));
          }
        });
      });
    })()
    `
    ws.send(JSON.stringify({
      id: nextId(),
      method: 'Runtime.evaluate',
      params: {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      }
    }))
  }

  // 第三步：收到 SCROLL_UP 响应
  if (phase === 'scroll-up' && msg.id === 3 && msg.result) {
    console.log('SCROLL_UP response:', JSON.stringify(msg.result, null, 2))
    ws.close()
    process.exit(0)
  }
})

ws.addEventListener('error', (e) => {
  console.error('WS ERROR:', e.message || String(e))
  process.exit(1)
})

setTimeout(() => {
  console.error('TIMEOUT after 180s')
  process.exit(1)
}, 180000)
