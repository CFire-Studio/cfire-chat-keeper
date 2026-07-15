// 直接测试豆包 /im/chain/single 批量翻页
// 规律：direction=1 表示向旧消息翻页；anchor_index=999999 可从最新开始；
//       后续 anchor_index 用上一页响应的 next_index，直到 has_more=false。
const http = require("http")
const WebSocket = require("ws")
const crypto = require("crypto")

const CDP_HTTP = "http://127.0.0.1:9222"
const TARGET_URL_PREFIX = "https://www.doubao.com/chat/bot/chat/"
const CONVERSATION_ID = "22222222222222222"

function uuid() {
  return crypto.randomUUID()
}

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get(CDP_HTTP + path, (res) => {
      let data = ""
      res.on("data", (c) => (data += c))
      res.on("end", () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on("error", reject)
  })
}

async function main() {
  const list = await fetchJson("/json/list")
  const page = list.find((t) => t.type === "page" && t.url.startsWith(TARGET_URL_PREFIX))
  if (!page) throw new Error(`未找到豆包 bot 页面`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.once("open", resolve)
    ws.once("error", reject)
  })

  let msgId = 0
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId
      const handler = (buf) => {
        const msg = JSON.parse(buf.toString())
        if (msg.id === id) {
          ws.off("message", handler)
          resolve(msg)
        }
      }
      ws.on("message", handler)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  await send("Runtime.enable")

  const start = Date.now()
  const batchExpr = `
    (async function() {
      try {
        const url = "https://www.doubao.com/im/chain/single?version_code=20800&language=zh&device_platform=web&doubao_device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=1234567890123456789&pc_version=3.27.4&doubao_pc_version=3.27.4&web_id=9876543210987654321&tea_uuid=9876543210987654321&region=CN&sys_region=CN&samantha_web=1&web_platform=browser&use-olympus-account=1&web_tab_id=00000000-0000-0000-0000-000000000000"
        const conversationId = ${JSON.stringify(CONVERSATION_ID)}
        let anchorIndex = 999999
        let total = 0
        let pages = 0
        let skipped = 0
        const maxPages = 2000
        let delay = 120
        let consecutiveErrors = 0
        const maxConsecutiveErrors = 5
        const results = []

        while (pages < maxPages) {
          const reqBody = {
            cmd: 3100,
            sequence_id: "${uuid()}",
            uplink_body: {
              pull_singe_chain_uplink_body: {
                conversation_id: conversationId,
                anchor_index: anchorIndex,
                conversation_type: 3,
                direction: 1,
                limit: 20,
                ext: {},
                filter: { index_list: [] },
                evaluate_ab_params: "",
                evaluate_common_params: ""
              }
            },
            channel: 2,
            version: "1"
          }

          let data = null
          let lastErr = null
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json; encoding=utf-8" },
                body: JSON.stringify(reqBody)
              })
              const tmp = await res.json()
              if (tmp.status_code) {
                lastErr = String(tmp.status_code) + ": " + String(tmp.status_desc || "")
                delay = Math.min(delay + 200, 2000)
              } else {
                data = tmp
                lastErr = null
                break
              }
            } catch (e) {
              lastErr = String(e)
            }
            if (attempt < 2) await new Promise(r => setTimeout(r, delay))
          }

          if (lastErr || !data) {
            consecutiveErrors++
            if (consecutiveErrors >= maxConsecutiveErrors) {
              results.push({ page: pages + 1, error: "stopped after " + maxConsecutiveErrors + " errors", lastErr })
              break
            }
            skipped++
            anchorIndex = Math.max(0, anchorIndex - 20)
            if (pages > 0) await new Promise(r => setTimeout(r, delay))
            continue
          }
          consecutiveErrors = 0

          const c = data?.downlink_body?.pull_singe_chain_downlink_body
          if (!c) {
            results.push({ page: pages + 1, error: "no chain", dataPreview: JSON.stringify(data).slice(0, 500) })
            break
          }
          const msgs = c.messages || []
          total += msgs.length
          pages++
          results.push({
            page: pages,
            count: msgs.length,
            hasMore: c.has_more,
            nextIndex: c.next_index,
            firstIndex: msgs[0]?.index_in_conv,
            lastIndex: msgs[msgs.length - 1]?.index_in_conv
          })
          if (c.has_more === false || !c.next_index) break
          anchorIndex = Number(c.next_index)
          if (pages > 1) await new Promise(r => setTimeout(r, delay))
        }

        window.__TEST_RESULT__ = JSON.stringify({ pages, total, skipped, results: results.slice(0, 5).concat(results.slice(-3)) })
      } catch (e) {
        window.__TEST_RESULT__ = JSON.stringify({ error: String(e), stack: e.stack })
      }
    })()
  `
  await send("Runtime.evaluate", {
    expression: batchExpr,
    returnByValue: true,
    awaitPromise: true
  })
  const batchRes = await send("Runtime.evaluate", {
    expression: `window.__TEST_RESULT__`,
    returnByValue: true
  })
  const result = JSON.parse(batchRes.result?.result?.value || "{}")
  if (result.error) throw new Error(result.error)
  console.log("批量拉取结果:", result)
  console.log("耗时:", Date.now() - start, "ms")

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})

