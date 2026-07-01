// CDP 远程调试：分析 ChatGPT 页面中 AI 生成图片的 DOM 结构和 API 数据
const WebSocket = require("ws")

const PAGE_URL = "https://chatgpt.com/c/6a44975c-d198-83e8-8cc9-0a6ba9e63f71"
const CDP_BASE = "http://127.0.0.1:9222"

async function main() {
  // 1. 找到 ChatGPT 页面
  const tabs = await fetch(`${CDP_BASE}/json`).then(r => r.json())
  const page = tabs.find(t => t.url && t.url.includes("chatgpt.com/c/"))
  if (!page) { console.log("未找到 ChatGPT 页面"); return }

  console.log("找到页面:", page.title, page.url)

  // 2. 连接 WebSocket
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let msgId = 0
  const pending = new Map()

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    } else if (msg.method === "Runtime.consoleAPICalled") {
      console.log("[console]", msg.params.args.map(a => a.value ?? a.description).join(" "))
    }
  })

  await new Promise(resolve => ws.once("open", resolve))

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  // 3. 启用 Runtime
  await send("Runtime.enable")

  console.log("\n=== 1. 检查消息中 AI 生成图片的 DOM 结构 ===")

  const domResult = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const results = []
        
        // 查找所有消息元素
        const messages = document.querySelectorAll('[data-message-author-role]')
        messages.forEach((msgEl, idx) => {
          const role = msgEl.dataset.messageAuthorRole
          
          // 查找消息中的所有 img 标签
          const imgs = msgEl.querySelectorAll('img')
          imgs.forEach((img, imgIdx) => {
            const src = img.src || img.getAttribute('data-src') || ''
            const w = img.naturalWidth || img.width || 0
            const h = img.naturalHeight || img.height || 0
            const alt = img.alt || ''
            
            // 父级元素信息
            let parent = img.parentElement
            let parentChain = []
            for (let i = 0; i < 5 && parent; i++) {
              parentChain.push({
                tag: parent.tagName,
                class: (parent.className || '').toString().slice(0, 100),
                role: parent.getAttribute('role'),
                dataset: JSON.stringify(parent.dataset)
              })
              parent = parent.parentElement
            }
            
            results.push({
              msgIdx, imgIdx, role,
              src: src.slice(0, 200),
              w, h, alt: alt.slice(0, 100),
              parentChain
            })
          })
          
          // 也查找 DALL·E 生成图容器
          const genContainers = msgEl.querySelectorAll('[class*="generated"], [class*="dalle"], [class*="image-gen"], [class*="ai-image"]')
          genContainers.forEach(el => {
            results.push({
              msgIdx, role,
              type: 'gen_container',
              tag: el.tagName,
              class: (el.className || '').toString().slice(0, 200),
              innerHTML: el.innerHTML.slice(0, 300)
            })
          })
        })
        
        return JSON.stringify(results, null, 2)
      })()
    `,
    returnByValue: true
  })

  console.log(domResult.result?.value ?? JSON.stringify(domResult))

  console.log("\n=== 2. 检查消息的 data 属性（查找图片相关的 DOM 数据） ===")

  const dataAttrsResult = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const results = []
        document.querySelectorAll('[data-message-author-role]').forEach((el, idx) => {
          const allAttrs = {}
          for (const attr of el.attributes) {
            allAttrs[attr.name] = attr.value.slice(0, 100)
          }
          results.push({ idx, role: el.dataset.messageAuthorRole, attrs: allAttrs })
        })
        return JSON.stringify(results, null, 2)
      })()
    `,
    returnByValue: true
  })

  console.log(dataAttrsResult.result?.value ?? JSON.stringify(dataAttrsResult))

  console.log("\n=== 3. 查找包含 image/generated 关键字的元素 ===")

  const keywordResult = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const results = []
        document.querySelectorAll('[data-message-author-role]').forEach((el, idx) => {
          // 查找所有包含 'image' / 'generated' / 'dalle' / 'asset' 关键词的元素
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT)
          let node
          while (node = walker.nextNode()) {
            const tag = node.tagName
            const cls = (node.className || '').toString()
            const ds = JSON.stringify(node.dataset || {})
            if (
              cls.includes('image') || cls.includes('generated') || cls.includes('dalle') ||
              cls.includes('asset') || cls.includes('gen_img') ||
              ds.includes('image') || ds.includes('asset') || ds.includes('file_id') ||
              tag === 'IMG'
            ) {
              results.push({
                msgIdx: idx,
                tag,
                class: cls.slice(0, 200),
                dataset: ds.slice(0, 200),
                text: (node.textContent || '').slice(0, 100)
              })
            }
          }
        })
        return JSON.stringify(results.slice(0, 50), null, 2)
      })()
    `,
    returnByValue: true
  })

  console.log(keywordResult.result?.value ?? JSON.stringify(keywordResult))

  ws.close()
  console.log("\n=== 分析完成 ===")
}

main().catch(console.error)