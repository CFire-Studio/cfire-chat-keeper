// 验证 collector.ts 中 updateLastDoubaoConvId 能从 chain/info 响应提取真实 conversation_id
const fs = require("fs")
const path = require("path")

const chainPath = path.join(__dirname, "_probe-doubao-bot-chain.json")
const chains = JSON.parse(fs.readFileSync(chainPath, "utf-8"))

function safeJson(v) {
  if (v == null) return null
  if (typeof v === "object") return v
  try { return JSON.parse(v) } catch { return null }
}

function getPath(obj, pathStr) {
  if (!obj || typeof obj !== "object") return undefined
  const parts = pathStr.split(".")
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = cur[p]
  }
  return cur
}

function updateLastDoubaoConvId(body) {
  const json = safeJson(body)
  if (!json || typeof json !== "object") return null
  const id =
    getPath(json, "downlink_body.pull_singe_chain_downlink_body.messages.0.conversation_id") ??
    getPath(json, "downlink_body.get_conv_info_downlink_body.conversation_info.conversation_id")
  return typeof id === "string" && id ? id : null
}

for (const entry of chains) {
  const id = updateLastDoubaoConvId(entry.body)
  console.log("Extracted convId from chain:", id)
}

// 测试 info 响应
const infoBody = {
  downlink_body: {
    get_conv_info_downlink_body: {
      conversation_info: {
        conversation_id: "22222222222222222",
        name: "猫小九"
      }
    }
  }
}
console.log("Extracted convId from info:", updateLastDoubaoConvId(JSON.stringify(infoBody)))

// 验证 convId 与 URL bot_id 不同
const urlBotId = "5555555555555555555"
const apiConvId = updateLastDoubaoConvId(chains[0].body)
console.log("URL bot_id:", urlBotId)
console.log("API conversation_id:", apiConvId)
console.log("Aligned:", apiConvId && apiConvId !== urlBotId)
