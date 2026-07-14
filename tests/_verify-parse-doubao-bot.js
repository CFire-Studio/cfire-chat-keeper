// 验证 parsers.ts 中 parseDoubao 对 bot 页面 /im/chain/single 的解析能力
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

function pickArray(obj, paths) {
  for (const p of paths) {
    const v = getPath(obj, p)
    if (Array.isArray(v)) return v
  }
  return null
}

function extractContentText(content) {
  if (typeof content !== "string") return ""
  const trimmed = content.trim()
  if (!trimmed) return ""
  const parsed = safeJson(trimmed)
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.text === "string" && parsed.text) return parsed.text
  }
  return trimmed
}

function extractMessageText(m) {
  const blocks = m.content_block ?? []
  const fromBlocks = blocks
    .filter((b) => b.block_type === 10000 && !b.parent_id)
    .map((b) => getPath(b, "content.text_block.text"))
    .filter(Boolean)
    .join("\n")
    .trim()
  if (fromBlocks) return fromBlocks
  return extractContentText(m.content) || (m.tts_content ?? "").trim()
}

let totalMessages = 0
let userCount = 0
let assistantCount = 0
let firstConvId = null

for (const entry of chains) {
  const body = safeJson(entry.body)
  const msgs = pickArray(body, ["downlink_body.pull_singe_chain_downlink_body.messages"])
  if (!msgs || msgs.length === 0) {
    console.log("No messages in:", entry.url.slice(0, 120))
    continue
  }
  console.log("URL:", entry.url.slice(0, 120))
  console.log("Messages count:", msgs.length)
  firstConvId = msgs[0].conversation_id
  for (const m of msgs) {
    const text = extractMessageText(m)
    const role = m.user_type === 1 ? "user" : "assistant"
    if (role === "user") userCount++; else assistantCount++
    totalMessages++
    console.log(`  [${role}] ${text.slice(0, 60).replace(/\n/g, " ")}${text.length > 60 ? "..." : ""}`)
  }
}

console.log("\n=== Summary ===")
console.log("conversation_id:", firstConvId)
console.log("total messages:", totalMessages)
console.log("user:", userCount, "assistant:", assistantCount)
