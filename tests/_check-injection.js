// 检查 content script 是否被注入
const pageWsUrl = process.argv[2]

const ws = new WebSocket(pageWsUrl)
let msgId = 0

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === 1) {
    ws.send(JSON.stringify({
      id: ++msgId,
      method: 'Runtime.evaluate',
      params: {
        expression: `JSON.stringify({
          hookInstalled: !!window.__ACK_HOOK__,
          url: location.href,
          hasScroller: !!document.querySelector('[class*="v_list_scroller"]'),
          readyState: document.readyState
        })`,
        returnByValue: true
      }
    }))
  }
  if (msg.id === 2) {
    console.log('Page state:', msg.result.result.value)
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
