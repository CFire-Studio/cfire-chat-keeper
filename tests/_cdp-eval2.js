// CDP helper v2: reads expression from a file
// Usage: node tests/_cdp-eval2.js <ws-url> <expr-file>
const fs = require('fs')
const wsUrl = process.argv[2]
const exprFile = process.argv[3]

if (!wsUrl || !exprFile) {
  console.error('Usage: node _cdp-eval2.js <ws-url> <expr-file>')
  process.exit(1)
}

const expr = fs.readFileSync(exprFile, 'utf8')
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
}, 30000)
