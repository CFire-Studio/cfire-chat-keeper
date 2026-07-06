// 在 service worker 中触发 SCROLL_UP 给豆包 tab，并等待响应
// 用法: node tests/_trigger-scroll.js <sw-ws-url> <doubao-tab-id>
const wsUrl = process.argv[2]
const tabId = process.argv[3]
if (!wsUrl || !tabId) {
  console.error('Usage: node _trigger-scroll.js <sw-ws-url> <doubao-tab-id>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let msgId = 1
let started = false

const expr = `
(async function() {
  return new Promise(function(resolve) {
    chrome.tabs.sendMessage(${tabId}, { type: 'ack:scroll-up' }, function(response) {
      if (chrome.runtime.lastError) {
        resolve(JSON.stringify({ error: chrome.runtime.lastError.message }));
      } else {
        resolve(JSON.stringify({ response: response, completedAt: Date.now() }));
      }
    });
  });
})()
`

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: msgId, method: 'Runtime.enable' }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === 1) {
    msgId++
    console.log('Triggering SCROLL_UP at', new Date().toISOString())
    started = true
    ws.send(JSON.stringify({
      id: msgId,
      method: 'Runtime.evaluate',
      params: {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      }
    }))
  }
  if (msg.id === 2) {
    console.log('SCROLL_UP response:', JSON.stringify(msg.result, null, 2))
    ws.close()
    process.exit(0)
  }
})

ws.addEventListener('error', (e) => {
  console.error('WS ERROR:', e.message || String(e))
  process.exit(1)
})

// 总超时 180s（scrollUpLoop 最大 120s + 余量）
setTimeout(() => {
  console.error('TIMEOUT after 180s')
  process.exit(1)
}, 180000)
