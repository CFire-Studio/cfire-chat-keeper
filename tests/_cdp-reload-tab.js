// 通过 CDP 重新加载指定页面
// 用法: node tests/_cdp-reload-tab.js <page-ws-url>
const wsUrl = process.argv[2]
if (!wsUrl) {
  console.error('Usage: node _cdp-reload-tab.js <page-ws-url>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let msgId = 1

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: msgId, method: 'Page.enable' }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === 1) {
    msgId++
    ws.send(JSON.stringify({
      id: msgId,
      method: 'Page.reload',
      params: { ignoreCache: true }
    }))
  }
  if (msg.id === 2) {
    console.log('reload triggered')
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
}, 15000)
