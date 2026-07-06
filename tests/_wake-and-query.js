// 唤醒 SW 并查询 DB
// 用法: node tests/_wake-and-query.js <doubao-page-ws-url> <query-file>

const http = require('http')
const fs = require('fs')

const pageWsUrl = process.argv[2]
const queryFile = process.argv[3]

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

async function main() {
  // Step 1: 重载豆包页面唤醒 SW
  console.log('[1/3] Reloading doubao page to wake SW...')
  const pageWs = new WebSocket(pageWsUrl)
  let pageMsgId = 0
  function pageNextId() { return ++pageMsgId }

  await new Promise((resolve, reject) => {
    pageWs.addEventListener('open', () => {
      pageWs.send(JSON.stringify({ id: pageNextId(), method: 'Page.enable' }))
      pageWs.send(JSON.stringify({ id: pageNextId(), method: 'Page.reload' }))
      resolve()
    })
    pageWs.addEventListener('error', reject)
  })

  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Page.loadEventFired') {
        pageWs.removeEventListener('message', handler)
        resolve()
      }
    }
    pageWs.addEventListener('message', handler)
  })
  console.log('  Page reloaded.')

  console.log('[2/3] Waiting 8s for SW to wake...')
  await new Promise(r => setTimeout(r, 8000))

  // Step 2: 获取 SW 的 WS URL
  const targets = await fetchJson('http://127.0.0.1:9222/json')
  const sw = targets.find(t =>
    t.type === 'service_worker' &&
    t.url && t.url.indexOf('chrome-extension://') === 0
  )
  if (!sw) {
    console.error('  No extension SW found!')
    process.exit(1)
  }
  console.log('  SW:', sw.url)
  const swWsUrl = sw.webSocketDebuggerUrl

  // Step 3: 查询 DB
  console.log('[3/3] Querying DB...')
  const expr = fs.readFileSync(queryFile, 'utf-8')
  const swWs = new WebSocket(swWsUrl)
  let swMsgId = 0
  function swNextId() { return ++swMsgId }

  await new Promise((resolve) => {
    swWs.addEventListener('open', () => {
      swWs.send(JSON.stringify({ id: swNextId(), method: 'Runtime.enable' }))
      resolve()
    })
  })

  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === 1) {
        swWs.removeEventListener('message', handler)
        resolve()
      }
    }
    swWs.addEventListener('message', handler)
  })

  const result = await new Promise((resolve) => {
    const id = swNextId()
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id && msg.result) {
        swWs.removeEventListener('message', handler)
        resolve(msg.result)
      }
    }
    swWs.addEventListener('message', handler)
    swWs.send(JSON.stringify({
      id: id,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    }))
  })

  const val = result.result && result.result.value
  if (val) {
    try {
      const data = JSON.parse(val)
      console.log(JSON.stringify(data, null, 2))
    } catch (e) {
      console.log('Raw:', val.substring(0, 10000))
    }
  } else {
    console.log('Result:', JSON.stringify(result, null, 2))
  }

  pageWs.close()
  swWs.close()
  process.exit(0)
}

main().catch(e => {
  console.error('FATAL:', e.message || String(e))
  process.exit(1)
})
