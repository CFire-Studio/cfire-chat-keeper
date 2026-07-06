// 通过 CDP 调用 service worker 的 chrome.runtime.reload() 重载扩展
// 用法: node tests/_reload-ext.js <sw-ws-url>
const wsUrl = process.argv[2]
if (!wsUrl) {
  console.error('Usage: node _reload-ext.js <sw-ws-url>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let msgId = 1

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: msgId, method: 'Runtime.enable' }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === 1) {
    msgId++
    ws.send(JSON.stringify({
      id: msgId,
      method: 'Runtime.evaluate',
      params: {
        expression: 'chrome.runtime.reload()',
        returnByValue: true,
        awaitPromise: true
      }
    }))
  }
  if (msg.id === 2) {
    console.log('reload called:', JSON.stringify(msg.result))
    ws.close()
    process.exit(0)
  }
})

ws.addEventListener('error', (e) => {
  console.error('WS ERROR:', e.message || String(e))
  process.exit(1)
})

setTimeout(() => {
  console.error('TIMEOUT')
  process.exit(1)
}, 10000)
