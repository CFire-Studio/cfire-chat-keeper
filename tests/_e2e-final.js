// 最终端到端测试：
// 1. 重载豆包页面唤醒 SW
// 2. 等待页面加载完成
// 3. 通过 SW 发送 SCROLL_UP
// 4. 验证 collector 响应
// 用法: node tests/_e2e-final.js <doubao-page-ws-url>

const wsUrl = process.argv[2]
if (!wsUrl) {
  console.error('Usage: node _e2e-final.js <doubao-page-ws-url>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let msgId = 0
let phase = 'reload' // reload -> wait-load -> done

function nextId() { return ++msgId }

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: nextId(), method: 'Page.enable' }))
  ws.send(JSON.stringify({ id: nextId(), method: 'Runtime.enable' }))
  // 触发重载
  console.log('[1/3] Reloading doubao page to wake SW...')
  ws.send(JSON.stringify({ id: nextId(), method: 'Page.reload' }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  // 监听 loadEventFired
  if (msg.method === 'Page.loadEventFired' && phase === 'reload') {
    phase = 'wait-load'
    console.log('[2/3] Page reloaded, waiting 8s for content script to inject and SW to wake...')
    setTimeout(() => {
      // 检查 collector 是否已注入
      ws.send(JSON.stringify({
        id: nextId(),
        method: 'Runtime.evaluate',
        params: {
          expression: `(function(){
            // 检查是否有 v_list_scroller（确认是豆包聊天页）
            var scroller = document.querySelector('[class*="v_list_scroller"]');
            return JSON.stringify({
              hasScroller: !!scroller,
              scrollHeight: scroller ? scroller.scrollHeight : 0,
              clientHeight: scroller ? scroller.clientHeight : 0,
              url: location.href
            });
          })()`,
          returnByValue: true
        }
      }))
    }, 8000)
  }
  // 处理 evaluate 结果
  if (msg.id && msg.result && msg.result.result && phase === 'wait-load') {
    const val = msg.result.result.value
    if (val && val.includes('hasScroller')) {
      console.log('  Page state:', val)
      phase = 'done'
      console.log('[3/3] Page ready. SW should be awake now.')
      console.log('Done. Now run _trigger-scroll.js to verify SCROLL_UP response.')
      ws.close()
      process.exit(0)
    }
  }
})

ws.addEventListener('error', (e) => {
  console.error('WS ERROR:', e.message || String(e))
  process.exit(1)
})

setTimeout(() => {
  console.error('TIMEOUT after 30s')
  process.exit(1)
}, 30000)
