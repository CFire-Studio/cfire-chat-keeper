// 组合端到端测试：
// 1. 通过豆包页面 CDP 重载页面唤醒 SW
// 2. 等待 content script 注入
// 3. 立即获取 SW 的 WS URL
// 4. 连接 SW，查询 tab id
// 5. 发送 SCROLL_UP，等待响应
// 用法: node tests/_e2e-combined.js <doubao-page-ws-url>

const http = require('http')

const pageWsUrl = process.argv[2]
if (!pageWsUrl) {
  console.error('Usage: node _e2e-combined.js <doubao-page-ws-url>')
  process.exit(1)
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

function findExtSW(targets) {
  return targets.find(t =>
    t.type === 'service_worker' &&
    t.url && t.url.indexOf('chrome-extension://') === 0
  )
}

async function main() {
  // Step 1: 重载豆包页面
  console.log('[1/5] Reloading doubao page to wake SW...')
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

  // 等待 loadEventFired
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

  // 等待 content script 注入和 SW 唤醒
  console.log('[2/5] Waiting 8s for content script + SW wake...')
  await new Promise(r => setTimeout(r, 8000))

  // Step 3: 获取 SW 的 WS URL
  console.log('[3/5] Finding extension SW...')
  const targets = await fetchJson('http://127.0.0.1:9222/json')
  const sw = findExtSW(targets)
  if (!sw) {
    console.error('  No extension SW found!')
    process.exit(1)
  }
  console.log('  SW url:', sw.url)
  const swWsUrl = sw.webSocketDebuggerUrl
  console.log('  SW WS:', swWsUrl)

  // Step 4: 连接 SW，查询 tab id 并发送 SCROLL_UP
  console.log('[4/5] Connecting to SW and sending SCROLL_UP...')
  const swWs = new WebSocket(swWsUrl)
  let swMsgId = 0
  let phase = 'init'
  function swNextId() { return ++swMsgId }

  await new Promise((resolve) => {
    swWs.addEventListener('open', () => {
      swWs.send(JSON.stringify({ id: swNextId(), method: 'Runtime.enable' }))
      phase = 'enabled'
      resolve()
    })
  })

  // 等待 enable 响应
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

  // 查询 tab id
  const tabQueryExpr = `
  (async function() {
    return new Promise(function(resolve) {
      chrome.tabs.query({}, function(tabs) {
        var doubao = tabs.find(function(t) { return t.url && t.url.indexOf('doubao.com/chat/') >= 0; });
        if (!doubao) {
          resolve(JSON.stringify({ error: 'no doubao tab', tabCount: tabs.length }));
        } else {
          resolve(JSON.stringify({ tabId: doubao.id, url: doubao.url }));
        }
      });
    });
  })()
  `

  const tabInfo = await new Promise((resolve) => {
    const id = swNextId()
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id && msg.result) {
        swWs.removeEventListener('message', handler)
        resolve(JSON.parse(msg.result.result.value))
      }
    }
    swWs.addEventListener('message', handler)
    swWs.send(JSON.stringify({
      id: id,
      method: 'Runtime.evaluate',
      params: { expression: tabQueryExpr, returnByValue: true, awaitPromise: true }
    }))
  })
  console.log('  Tab:', JSON.stringify(tabInfo))
  if (tabInfo.error) {
    console.error('  Error:', tabInfo.error)
    process.exit(1)
  }

  // 发送 SCROLL_UP
  console.log('[5/5] Sending SCROLL_UP and waiting for response (max 120s)...')
  const scrollExpr = `
  (async function() {
    return new Promise(function(resolve) {
      chrome.tabs.sendMessage(${tabInfo.tabId}, { type: 'ack:scroll-up' }, function(response) {
        if (chrome.runtime.lastError) {
          resolve(JSON.stringify({ error: chrome.runtime.lastError.message }));
        } else {
          resolve(JSON.stringify({ response: response, completedAt: Date.now() }));
        }
      });
    });
  })()
  `

  const scrollResult = await new Promise((resolve, reject) => {
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
      params: { expression: scrollExpr, returnByValue: true, awaitPromise: true }
    }))
    setTimeout(() => reject(new Error('SCROLL_UP timeout after 150s')), 150000)
  })

  console.log('SCROLL_UP result:', JSON.stringify(scrollResult, null, 2))

  // 关闭页面 WS
  pageWs.close()
  swWs.close()
  process.exit(0)
}

main().catch(e => {
  console.error('FATAL:', e.message || String(e))
  process.exit(1)
})
