// 完整重载流程：重载扩展 → 等待 → 重载页面 → 等待 → 验证
// 用法: node tests/_full-reload.js <sw-ws-url> <doubao-page-ws-url>
const wsUrlSw = process.argv[2]
const wsUrlPage = process.argv[3]
if (!wsUrlSw || !wsUrlPage) {
  console.error('Usage: node _full-reload.js <sw-ws-url> <doubao-page-ws-url>')
  process.exit(1)
}

function wsSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    let id
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        ws.removeEventListener('message', handler)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    }
    ws.addEventListener('message', handler)
    id = Math.floor(Math.random() * 1000000) + 1
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  console.log('[1/4] Connecting to service worker...')
  const wsSw = new WebSocket(wsUrlSw)
  await new Promise(r => wsSw.addEventListener('open', r, { once: true }))
  await wsSend(wsSw, 'Runtime.enable')

  console.log('[2/4] Reloading extension via chrome.runtime.reload()...')
  try {
    await wsSend(wsSw, 'Runtime.evaluate', {
      expression: 'chrome.runtime.reload()',
      returnByValue: true,
      awaitPromise: true
    })
  } catch (e) {
    // 预期会断连，因为 SW 被终止
    console.log('  (SW disconnected as expected:', e.message + ')')
  }
  wsSw.close()

  console.log('[3/4] Waiting 8s for extension to reload...')
  await sleep(8000)

  console.log('[4/4] Reloading Doubao tab with ignoreCache...')
  const wsPage = new WebSocket(wsUrlPage)
  await new Promise(r => wsPage.addEventListener('open', r, { once: true }))
  await wsSend(wsPage, 'Page.enable')
  await wsSend(wsPage, 'Page.reload', { ignoreCache: true })
  console.log('  Page.reload sent')
  wsPage.close()

  console.log('Done. Wait 15s for page to fully load before testing.')
}

main().catch(e => {
  console.error('ERROR:', e)
  process.exit(1)
})
