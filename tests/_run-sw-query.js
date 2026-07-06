// 通过 SW 查询 DB
// 用法: node tests/_run-sw-query.js <sw-ws-url> <query-file>
const wsUrl = process.argv[2]
const queryFile = process.argv[3]
const ws = new WebSocket(wsUrl)
let msgId = 0
function nextId() { return ++msgId }

const fs = require('fs')
const expr = fs.readFileSync(queryFile, 'utf-8')

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: nextId(), method: 'Runtime.enable' }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === 1) {
    ws.send(JSON.stringify({
      id: nextId(),
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    }))
  }
  if (msg.id === 2 && msg.result) {
    const val = msg.result.result.value
    if (val) {
      try {
        const data = JSON.parse(val)
        console.log(JSON.stringify(data, null, 2))
      } catch (e) {
        console.log('Raw:', val.substring(0, 5000))
      }
    } else {
      console.log('Result:', JSON.stringify(msg.result, null, 2))
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
  console.error('TIMEOUT after 15s')
  process.exit(1)
}, 15000)
