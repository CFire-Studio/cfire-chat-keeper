// CDP helper: connect to a tab via WebSocket (Node 22+ built-in WebSocket)
// Usage: node tests/_cdp-eval.js <ws-url> <expression>
const wsUrl = process.argv[2]
const expr = process.argv[3]

if (!wsUrl || !expr) {
  console.error('Usage: node _cdp-eval.js <ws-url> <expression>')
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
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      }
    }))
  }
  if (msg.id === 2) {
    const result = msg.result?.result
    if (result?.subtype === 'error') {
      console.error('EVAL ERROR:', result.description)
    } else {
      console.log(JSON.stringify(result?.value ?? result, null, 2))
    }
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
