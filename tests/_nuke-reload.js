// 彻底重载流程：
// 1. 导航 Doubao tab 到 about:blank（卸载 content script）
// 2. 重载扩展
// 3. 等待扩展重载完成
// 4. 导航回 Doubao URL（重新注入新 content script）
// 用法: node tests/_nuke-reload.js <sw-ws-url> <doubao-page-ws-url> <doubao-url>
const wsUrlSw = process.argv[2]
const wsUrlPage = process.argv[3]
const doubaoUrl = process.argv[4] || 'https://www.doubao.com/chat/11111111111111111'
if (!wsUrlSw || !wsUrlPage) {
  console.error('Usage: node _nuke-reload.js <sw-ws-url> <doubao-page-ws-url> [doubao-url]')
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  // Step 1: Navigate Doubao tab to about:blank
  console.log('[1/5] Navigating Doubao tab to about:blank...')
  const wsPage = new WebSocket(wsUrlPage)
  await new Promise(r => wsPage.addEventListener('open', r, { once: true }))
  await wsSend(wsPage, 'Page.enable')
  await wsSend(wsPage, 'Page.navigate', { url: 'about:blank' })
  console.log('  Navigated to about:blank')
  wsPage.close()
  await sleep(2000)

  // Step 2: Reload extension
  console.log('[2/5] Reloading extension...')
  const wsSw = new WebSocket(wsUrlSw)
  await new Promise(r => wsSw.addEventListener('open', r, { once: true }))
  await wsSend(wsSw, 'Runtime.enable')
  try {
    await wsSend(wsSw, 'Runtime.evaluate', {
      expression: 'chrome.runtime.reload()',
      returnByValue: true,
      awaitPromise: true
    })
  } catch (e) {
    console.log('  SW disconnected (expected):', e.message)
  }
  wsSw.close()

  // Step 3: Wait for extension to reload
  console.log('[3/5] Waiting 10s for extension reload...')
  await sleep(10000)

  // Step 4: Navigate back to Doubao
  console.log('[4/5] Navigating back to Doubao URL...')
  // Re-connect to the page (WS URL might have changed after about:blank)
  // Actually, the target ID should be the same for the tab
  const wsPage2 = new WebSocket(wsUrlPage)
  await new Promise(r => wsPage2.addEventListener('open', r, { once: true }))
  await wsSend(wsPage2, 'Page.enable')
  await wsSend(wsPage2, 'Page.navigate', { url: doubaoUrl })
  console.log('  Navigated to', doubaoUrl)
  wsPage2.close()

  console.log('[5/5] Done. Wait 15s for page to fully load.')
}

main().catch(e => {
  console.error('ERROR:', e)
  process.exit(1)
})

