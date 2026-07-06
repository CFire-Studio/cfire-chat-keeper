// 唤醒 SW，获取 SW WS URL 和 doubao tab id
// 用法: node tests/_wake-and-get-params.js <doubao-page-ws-url>

const http = require('http')
const pageWsUrl = process.argv[2]

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
  // 重载页面唤醒 SW
  console.log('Reloading page to wake SW...')
  const pageWs = new WebSocket(pageWsUrl)
  let pageId = 0

  await new Promise((resolve, reject) => {
    pageWs.addEventListener('open', () => {
      pageWs.send(JSON.stringify({ id: ++pageId, method: 'Page.enable' }))
      pageWs.send(JSON.stringify({ id: ++pageId, method: 'Page.reload' }))
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
  pageWs.close()

  console.log('Waiting 8s for SW...')
  await new Promise(r => setTimeout(r, 8000))

  // 获取 SW WS URL
  const targets = await fetchJson('http://127.0.0.1:9222/json')
  const sw = targets.find(t =>
    t.type === 'service_worker' && t.url && t.url.indexOf('chrome-extension://') === 0
  )
  if (!sw) {
    console.error('No SW found')
    process.exit(1)
  }

  // 通过 SW 查询 doubao tab id
  const swWs = new WebSocket(sw.webSocketDebuggerUrl)
  let swId = 0

  await new Promise((resolve) => {
    swWs.addEventListener('open', () => {
      swWs.send(JSON.stringify({ id: ++swId, method: 'Runtime.enable' }))
      resolve()
    })
  })

  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === 1) { swWs.removeEventListener('message', handler); resolve() }
    }
    swWs.addEventListener('message', handler)
  })

  const tabResult = await new Promise((resolve, reject) => {
    const id = ++swId
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id && msg.result) {
        swWs.removeEventListener('message', handler)
        resolve(msg.result.result.value)
      }
    }
    swWs.addEventListener('message', handler)
    swWs.send(JSON.stringify({
      id: id,
      method: 'Runtime.evaluate',
      params: {
        expression: `(async function(){
          return new Promise(function(resolve){
            chrome.tabs.query({}, function(tabs){
              var d = tabs.find(function(t){ return t.url && t.url.indexOf('doubao.com/chat/')>=0 });
              resolve(JSON.stringify({ tabId: d ? d.id : null, url: d ? d.url : null }));
            });
          });
        })()`,
        returnByValue: true,
        awaitPromise: true
      }
    }))
    setTimeout(() => reject(new Error('timeout')), 10000)
  })

  const tabInfo = JSON.parse(tabResult)
  swWs.close()

  // 输出参数
  console.log('SW_WS=' + sw.webSocketDebuggerUrl)
  console.log('TAB_ID=' + tabInfo.tabId)
  console.log('TAB_URL=' + tabInfo.url)
}

main().catch(e => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
