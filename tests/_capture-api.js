// 通过 CDP 在豆包页面注入 fetch 拦截器，记录所有 /im/chain/single 响应
// 然后触发 scrollUpLoop，分析每次响应的 message_id
// 用法: node tests/_capture-api.js <doubao-page-ws-url> <sw-ws-url> <doubao-tab-id>

const pageWsUrl = process.argv[2]
const swWsUrl = process.argv[3]
const doubaoTabId = process.argv[4]

if (!pageWsUrl || !swWsUrl || !doubaoTabId) {
  console.error('Usage: node _capture-api.js <page-ws> <sw-ws> <tab-id>')
  process.exit(1)
}

// Step 1: 在页面注入 fetch 拦截器
const injectScript = `
(function() {
  if (window.__CAPTURE_CHAIN__) return 'already-injected'
  window.__CAPTURE_CHAIN__ = []
  window.__CAPTURE_CHAIN_RAW__ = []
  const origFetch = window.fetch
  window.fetch = function() {
    const url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || ''
    const promise = origFetch.apply(this, arguments)
    if (url.indexOf('/im/chain/single') >= 0) {
      promise.then(function(res) {
        const clone = res.clone()
        clone.text().then(function(body) {
          try {
            const json = JSON.parse(body)
            const msgs = json && json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body && json.downlink_body.pull_singe_chain_downlink_body.messages
            if (msgs) {
              const ids = msgs.map(function(m) { return { id: m.message_id, time: m.create_time, role: m.user_type } })
              window.__CAPTURE_CHAIN__.push({ url: url, count: msgs.length, ids: ids })
              window.__CAPTURE_CHAIN_RAW__.push({ url: url, bodyLength: body.length, firstMsgId: msgs[0] && msgs[0].message_id, lastMsgId: msgs[msgs.length-1] && msgs[msgs.length-1].message_id })
            }
          } catch(e) {}
        }).catch(function(){})
      }).catch(function(){})
    }
    return promise
  }
  return 'injected'
})()
`

// 查询捕获结果
const queryScript = `
(function() {
  return JSON.stringify({
    captured: window.__CAPTURE_CHAIN__ || [],
    capturedRaw: window.__CAPTURE_CHAIN_RAW__ || []
  })
})()
`

function wsEval(ws, expr, id) {
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id && msg.result) {
        ws.removeEventListener('message', handler)
        resolve(msg.result)
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({
      id: id,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    }))
    setTimeout(() => reject(new Error('timeout')), 30000)
  })
}

async function main() {
  // 连接页面 WS
  console.log('[1/4] Injecting fetch interceptor into doubao page...')
  const pageWs = new WebSocket(pageWsUrl)
  let pageId = 0
  function pageNextId() { return ++pageId }

  await new Promise((resolve, reject) => {
    pageWs.addEventListener('open', () => {
      pageWs.send(JSON.stringify({ id: pageNextId(), method: 'Runtime.enable' }))
      resolve()
    })
    pageWs.addEventListener('error', reject)
  })

  // 等待 enable 响应
  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === 1) { pageWs.removeEventListener('message', handler); resolve() }
    }
    pageWs.addEventListener('message', handler)
  })

  // 注入拦截器
  const injectResult = await wsEval(pageWs, injectScript, pageNextId())
  console.log('  Inject result:', injectResult.result.value)

  // Step 2: 通过 SW 触发 scrollUpLoop
  console.log('[2/4] Triggering scrollUpLoop via SW...')
  const swWs = new WebSocket(swWsUrl)
  let swId = 0
  function swNextId() { return ++swId }

  await new Promise((resolve, reject) => {
    swWs.addEventListener('open', () => {
      swWs.send(JSON.stringify({ id: swNextId(), method: 'Runtime.enable' }))
      resolve()
    })
    swWs.addEventListener('error', reject)
  })

  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === 1) { swWs.removeEventListener('message', handler); resolve() }
    }
    swWs.addEventListener('message', handler)
  })

  // 发送 SCROLL_UP
  const scrollExpr = `
  (async function() {
    return new Promise(function(resolve) {
      chrome.tabs.sendMessage(${doubaoTabId}, { type: 'ack:scroll-up' }, function(response) {
        if (chrome.runtime.lastError) {
          resolve(JSON.stringify({ error: chrome.runtime.lastError.message }));
        } else {
          resolve(JSON.stringify({ response: response }));
        }
      });
    });
  })()
  `
  console.log('  Sending SCROLL_UP, waiting for scrollUpLoop to complete (max 150s)...')
  const scrollResult = await wsEval(swWs, scrollExpr, swNextId())
  console.log('  SCROLL_UP response:', scrollResult.result.value)

  // Step 3: 查询捕获的 API 响应
  console.log('[3/4] Querying captured API responses...')
  await new Promise(r => setTimeout(r, 2000)) // 等待最后的 API 响应被捕获
  const queryResult = await wsEval(pageWs, queryScript, pageNextId())
  const captured = JSON.parse(queryResult.result.value)

  console.log('[4/4] Analysis:')
  console.log('  Total API calls captured:', captured.captured.length)
  console.log()

  // 分析每次 API 响应
  const allIds = new Set()
  const idToCall = {} // message_id -> [call index]
  captured.captured.forEach((call, i) => {
    console.log('  Call ' + i + ': url=' + call.url.substring(0, 80) + '... count=' + call.count)
    console.log('    First id: ' + (call.ids[0] ? call.ids[0].id : 'none'))
    console.log('    Last id: ' + (call.ids[call.ids.length-1] ? call.ids[call.ids.length-1].id : 'none'))
    call.ids.forEach(idInfo => {
      const id = idInfo.id
      allIds.add(id)
      if (!idToCall[id]) idToCall[id] = []
      idToCall[id].push(i)
    })
  })

  console.log()
  console.log('  Total unique message_ids:', allIds.size)

  // 检查是否有重复的 message_id（出现在多个 API 响应中）
  const duplicates = Object.entries(idToCall).filter(([id, calls]) => calls.length > 1)
  if (duplicates.length > 0) {
    console.log('  *** DUPLICATE message_ids (appear in multiple API responses): ' + duplicates.length + ' ***')
    duplicates.slice(0, 5).forEach(([id, calls]) => {
      console.log('    id=' + id + ' appears in calls: ' + calls.join(', '))
    })
  } else {
    console.log('  No duplicate message_ids across API responses')
  }

  pageWs.close()
  swWs.close()
  process.exit(0)
}

main().catch(e => {
  console.error('FATAL:', e.message || String(e))
  process.exit(1)
})
