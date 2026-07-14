// 直接构造 /im/chain/single 请求体测试批量翻页
// 不依赖滚动触发，直接尝试不同的 anchor_index + direction 组合
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

  // 先用一个已知较大的 anchor_index 测试 direction=0 和 direction=1
  const testAnchor = 999999
  for (const direction of [0, 1]) {
    const storeKey = `__TEST_${direction}`
    const expr = `
      (async function() {
        try {
          const url = "https://www.doubao.com/im/chain/single?version_code=20800&language=zh&device_platform=web&doubao_device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=1234567890123456789&pc_version=3.27.4&doubao_pc_version=3.27.4&web_id=9876543210987654321&tea_uuid=9876543210987654321&region=CN&sys_region=CN&samantha_web=1&web_platform=browser&use-olympus-account=1&web_tab_id=00000000-0000-0000-0000-000000000000"
          const reqBody = {
            cmd: 3100,
            sequence_id: "${uuid()}",
            uplink_body: {
              pull_singe_chain_uplink_body: {
                conversation_id: "${CONVERSATION_ID}",
                anchor_index: ${testAnchor},
                conversation_type: 3,
                direction: ${direction},
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
          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json; encoding=utf-8" },
            body: JSON.stringify(reqBody)
          })
          const data = await res.json()
          const chain = data?.downlink_body?.pull_singe_chain_downlink_body
          window["${storeKey}"] = JSON.stringify({
            direction: ${direction},
            status: data.status_desc,
            statusCode: data.status_code,
            msgCount: chain?.messages?.length || 0,
            hasMore: chain?.has_more,
            nextIndex: chain?.next_index,
            firstIndex: chain?.messages?.[0]?.index_in_conv,
            lastIndex: chain?.messages?.[chain?.messages?.length - 1]?.index_in_conv
          })
        } catch (e) {
          window["${storeKey}"] = JSON.stringify({ error: String(e), stack: e.stack })
        }
      })()
    `
    await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
    const read = await send("Runtime.evaluate", {
      expression: `window["${storeKey}"]`,
      returnByValue: true
    })
    console.log(`direction=${direction}:`, JSON.parse(read.result?.result?.value || "{}"))
  }

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
