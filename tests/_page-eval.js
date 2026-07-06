// 直接在页面上下文中执行脚本
// 用法: node tests/_page-eval.js <page-ws-url> <script-file>
const wsUrl = process.argv[2]
const scriptFile = process.argv[3]
const fs = require('fs')

const ws = new WebSocket(wsUrl)
let msgId = 0
function nextId() { return ++msgId }

const expr = fs.readFileSync(scriptFile, 'utf-8')

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
    const val = msg.result.result
    if (val && val.value) {
      try {
        const data = JSON.parse(val.value)
        console.log(JSON.stringify(data, indent=2, ensure_ascii=False))
      } catch (e) {
        console.log(val.value)
      }
    } else {
      console.log(JSON.stringify(msg.result, indent=2))
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
  console.error('TIMEOUT after 90s')
  process.exit(1)
}, 90000)
