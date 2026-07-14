import type {
  ChatMessage,
  ImageRef,
  IngestEvent,
  Role,
  SiteId
} from "./types"
import type { ParsedPayload } from "./messaging"
import {
  extractChatgptAssetImages,
  extractDoubaoBlockImages,
  filterDoubaoGeneratedImages,
  mergeImages,
  pickChatgptAttachmentImages,
  pickImages,
  stripAllImageMarkdown,
  stripDoubaoNonGenImageMarkdown
} from "./images"
import {
  buildConv,
  getPath,
  hash,
  nowMs,
  pickArray,
  pickConvIdFromUrl,
  pickString,
  safeJson,
  splitSse,
  toRole,
  tsToMs
} from "./parsers-utils"

// ============== 路由 ==============

export function parseEvent(ev: IngestEvent): ParsedPayload | null {
  switch (ev.site) {
    case "deepseek":
      return parseDeepseek(ev)
    case "chatgpt":
      return parseChatgpt(ev)
    case "doubao":
      return parseDoubao(ev)
  }
}

// ============== DeepSeek ==============

// DeepSeek share/history 接口返回的 message 结构（实测）
interface DsApiMessage {
  message_id?: number | string
  parent_id?: number | string | null
  role?: string // "USER" / "ASSISTANT"（大写）
  inserted_at?: number // 秒级浮点
  fragments?: Array<{
    id?: number
    type?: string // "REQUEST" / "RESPONSE" / "TIP" / "THINK" 等
    content?: string
    style?: string
    hide_on_wip?: boolean
  }>
}

interface DsLegacyMsg {
  message_id?: string | number
  id?: string | number
  role?: string
  content?: string
  inserted_at?: number
  created_at?: number
}

function parseDeepseek(ev: IngestEvent): ParsedPayload | null {
  // biz_data 包装：data.biz_data
  const root = unwrapDeepseek(safeJson(ev.body))
  const convId = pickConvIdFromUrl(ev.url, ev.site) ?? "unknown"

  // 1) 分享/历史接口：messages 数组，含 fragments
  const apiList = pickArray(root, ["messages", "data.messages"]) as
    | DsApiMessage[]
    | null
  if (apiList && apiList.length > 0) {
    const messages: ChatMessage[] = []
    for (const m of apiList) {
      const text = (m.fragments ?? [])
        .filter((f) => {
          const t = (f.type ?? "").toUpperCase()
          // 只取 REQUEST / RESPONSE，丢弃 TIP / 隐藏的提示等
          return t === "REQUEST" || t === "RESPONSE"
        })
        .map((f) => f.content ?? "")
        .filter(Boolean)
        .join("\n")
        .trim()
      if (!text) continue
      const role = toRole((m.role ?? "").toLowerCase())
      messages.push({
        turnId: String(m.message_id ?? hash(text)),
        role,
        content: text,
        createdAt: tsToMs(m.inserted_at ?? nowMs() / 1000),
        images: pickImages(text)
      })
    }
    if (messages.length === 0) return null
    const title =
      pickString(root, ["title", "data.title", "chat_session.title"]) ||
      `deepseek ${convId}`
    return {
      conversation: { ...buildConv(ev.site, convId, ev.url, messages.length), title },
      messages,
      replace: true // 完整快照
    }
  }

  // 2) 旧格式：chat_messages 简单结构
  const legacy = pickArray(root, ["chat_messages"]) as DsLegacyMsg[] | null
  if (legacy && legacy.length > 0) {
    const messages: ChatMessage[] = []
    for (const m of legacy) {
      const content = typeof m.content === "string" ? m.content : ""
      if (!content) continue
      const ts = (m.inserted_at ?? m.created_at ?? nowMs() / 1000) * 1
      messages.push({
        turnId: String(m.message_id ?? m.id ?? hash(content + ts)),
        role: toRole(m.role),
        content,
        createdAt: tsToMs(ts),
        images: pickImages(content)
      })
    }
    if (messages.length > 0)
      return {
        conversation: buildConv(ev.site, convId, ev.url, messages.length),
        messages,
        replace: true
      }
  }

  // 3) SSE 流（completion）：合并 delta 作为 assistant 的最新内容
  const events = splitSse(ev.body)
  if (events.length > 0) {
    const combined = events
      .map((e) =>
        pickString(e, [
          "choices.0.delta.content",
          "v.fragments.0.content",
          "v",
          "content"
        ])
      )
      .filter(Boolean)
      .join("")
    if (combined) {
      const messages: ChatMessage[] = [
        {
          // 用 "sse-current" 稳定 key，流式更新只 upsert 同 row
          turnId: "sse-current",
          role: "assistant",
          content: combined,
          createdAt: ev.capturedAt,
          images: pickImages(combined)
        }
      ]
      return {
        conversation: buildConv(ev.site, convId, ev.url, messages.length),
        messages
      }
    }
  }

  return null
}

function unwrapDeepseek(json: unknown): unknown {
  if (!json || typeof json !== "object") return json
  const j = json as { data?: { biz_data?: unknown } }
  return j.data?.biz_data ?? (json as { data?: unknown }).data ?? json
}

// ============== ChatGPT ==============

interface CgAttachment {
  id?: string          // "file-xxx"
  mimeType?: string    // "image/png" 等
  name?: string
}

interface CgMessage {
  id?: string
  author?: { role?: string }
  content?: { parts?: unknown[] }
  attachments?: CgAttachment[]
  create_time?: string | number
  update_time?: string | number
  createTime?: string | number
  created_at?: string | number
  createdAt?: string | number
  metadata?: Record<string, unknown> & { is_visually_hidden_from_conversation?: boolean }
}

interface CgMappingNode {
  id?: string
  message?: CgMessage
  parent?: string
  children?: string[]
}

interface ChatgptParsedMessage extends ChatMessage {
  hasOriginalTime: boolean
}

function parseChatgpt(ev: IngestEvent): ParsedPayload | null {
  const convId = pickConvIdFromUrl(ev.url, ev.site) ?? "unknown"
  const messages: ChatgptParsedMessage[] = []

  // 情况 1：GET /backend-api/conversation/<id> 返回 mapping
  const json = safeJson(ev.body) as
    | {
        mapping?: Record<string, CgMappingNode>
        current_node?: string
        title?: string
        create_time?: string | number
        created_at?: string | number
        createTime?: string | number
        createdAt?: string | number
        update_time?: string | number
      }
    | null
  if (json && json.mapping) {
    for (const node of orderedChatgptNodes(json.mapping, json.current_node)) {
      const m = node?.message
      if (!m) continue
      if (m.metadata?.is_visually_hidden_from_conversation) continue
      const parts = m.content?.parts ?? []
      const text = parts
        .map((p) => (typeof p === "string" ? p : ""))
        .join("\n")
        .trim()
      // 图片来源 1：parts[] 中的 image_asset_pointer（DALL·E 生成图 / 用户上传图）
      const assetImages = extractChatgptAssetImages(parts)
      // 图片来源 2：attachments[] 中的图片附件（用户上传文件，id 形如 "file-xxx"）
      const attachImages = pickChatgptAttachmentImages(m.attachments)
      const allImages = mergeImages(assetImages, attachImages) ?? []
      if (!text && allImages.length === 0) continue
      // 文本里也可能含 markdown 图片，合并去重
      const images = mergeImages(allImages, pickImages(text) ?? [])
      // 无文本时用图片 markdown 填充 content，确保导出可见
      const imgMd = (images ?? [])
        .map((img) => `![${img.alt ?? "image"}](${img.url})`)
        .join("\n")
      const content = text && imgMd ? `${text}\n\n${imgMd}` : text || imgMd
      const messageTime = getChatgptMessageTime(m)
      messages.push({
        turnId: String(m.id ?? hash(content)),
        role: toRole(m.author?.role),
        content,
        createdAt: messageTime ?? 0,
        images,
        hasOriginalTime: messageTime !== undefined
      })
    }
    deduplicateChatgptMessages(messages)
  } else {
    // 情况 2：POST /backend-api/conversation SSE 流
    const events = splitSse(ev.body)
    let assistant = ""
    let lastId: string | undefined
    for (const e of events) {
      const v = pickString(e, ["v"])
      if (v) assistant += v
      const id = pickString(e, ["message.id"])
      if (id) lastId = id
    }
    if (assistant) {
      messages.push({
        turnId: lastId ?? hash(assistant),
        role: "assistant",
        content: assistant,
        createdAt: 0,
        images: pickImages(assistant),
        hasOriginalTime: false
      })
    }
  }

  if (messages.length === 0) return null
  const title =
    (json && typeof json.title === "string" && json.title) || `chatgpt ${convId}`
  const isFullSnapshot = !!(json && json.mapping)
  const createdAt = isFullSnapshot
    ? getChatgptConversationTime(json, messages)
    : messages.find((m) => m.hasOriginalTime && m.createdAt > 0)?.createdAt
  return {
    conversation: {
      ...buildConv(ev.site, convId, ev.url, messages.length, false, createdAt),
      title
    },
    messages: messages.map(({ hasOriginalTime, ...m }) => ({
      ...m,
      meta: { ...(m.meta ?? {}), hasOriginalTime }
    })),
    replace: isFullSnapshot
  }
}

function getChatgptConversationTime(
  json: {
    create_time?: string | number
    created_at?: string | number
    createTime?: string | number
    createdAt?: string | number
    update_time?: string | number
  } | null,
  messages: ChatMessage[]
): number | undefined {
  const fromJson = getChatgptPayloadTime(json)
  if (Number.isFinite(fromJson)) return fromJson
  const firstMessageAt = messages.find((m) => Number.isFinite(m.createdAt) && m.createdAt > 0)?.createdAt
  return firstMessageAt
}

function getChatgptPayloadTime(
  json: {
    create_time?: string | number
    created_at?: string | number
    createTime?: string | number
    createdAt?: string | number
    update_time?: string | number
  } | null
): number | undefined {
  return pickTimestamp(json, [
    "create_time",
    "createTime",
    "created_at",
    "createdAt",
    "update_time"
  ])
}

// 字段优先级：消息顶层时间最可靠；metadata 内仅信任明确为「创建时间」的字段。
// 移除 metadata.timestamp_ / finished_at / completed_at / update_time / updated_at 等
// 事件时间字段——它们在 client-created 节点（前端未持久化消息）中是前端注入的共享值，
// 同一时刻创建的多条消息会共享相同时间戳，无法反映对话顺序。
function getChatgptMessageTime(m: CgMessage): number | undefined {
  return pickTimestamp(m, [
    "create_time",
    "createTime",
    "created_at",
    "createdAt",
    "update_time",
    "metadata.create_time",
    "metadata.createTime",
    "metadata.created_at",
    "metadata.createdAt",
    "metadata.message_create_time",
    "metadata.messageCreateTime"
  ])
}

function pickTimestamp(obj: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getPath(obj, path)
    if (typeof value !== "string" && typeof value !== "number") continue
    const parsed = tsToMs(value, NaN)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function deduplicateChatgptMessages(messages: ChatgptParsedMessage[]): void {
  const seen = new Map<string, number>() // key → index
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const textOnly = m.content.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim()
    const key = `${m.role}:${textOnly}`
    if (!textOnly) {
      // 纯图片消息（如 DALL·E 生成结果）不去重，按 turnId 去重即可
      const idKey = `${m.role}:img:${m.turnId}`
      if (seen.has(idKey)) {
        messages.splice(i, 1)
        i--
      } else {
        seen.set(idKey, i)
      }
      continue
    }
    const prevIdx = seen.get(key)
    if (prevIdx === undefined) {
      seen.set(key, i)
      continue
    }
    const prev = messages[prevIdx]
    // 判断哪条保留：有原始时间 > 图片数 > 文本长度
    const prevScore =
      (prev.hasOriginalTime ? 1000 : 0) +
      (prev.images?.length ?? 0) * 10 +
      prev.content.length
    const curScore =
      (m.hasOriginalTime ? 1000 : 0) +
      (m.images?.length ?? 0) * 10 +
      m.content.length
    if (curScore > prevScore) {
      messages.splice(prevIdx, 1)
      seen.set(key, i)
      i-- // 修正索引
    } else {
      messages.splice(i, 1)
      i--
    }
  }
}

function orderedChatgptNodes(
  mapping: Record<string, CgMappingNode>,
  currentNode?: string
): CgMappingNode[] {
  const seen = new Set<string>()
  const ordered: CgMappingNode[] = []
  let id = currentNode
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id)
    ordered.push(mapping[id])
    id = mapping[id].parent
  }
  if (ordered.length > 0) return ordered.reverse()
  return Object.values(mapping)
}

// ============== 豆包 ==============

// /im/chain/single 响应结构（实测）：
//   downlink_body.pull_singe_chain_downlink_body.messages[]
// 每条消息:
//   user_type: 1=user, 2=assistant
//   message_id: 稳定 ID
//   create_time: 秒级时间戳字符串
//   content_block[]:
//     block_type=10000 text_block  — 文本块（正文 or 思考展开）
//     block_type=10040 thinking_block — 思考标题
//     block_type=10006 link_reader_block — 链接阅读
//     block_type=????? image_block / gallery_block — AI 生成图片（block_type 随版本变化）
//   区分正文 vs 思考：parent_id 为空 = 顶层正文；parent_id 指向 thinking_block = 思考子块
//   图片提取不依赖 block_type，由 extractDoubaoBlockImages 深度扫描 content 字段。

interface DbContentBlock {
  block_type?: number
  block_id?: string
  parent_id?: string
  content?: {
    text_block?: { text?: string }
    [key: string]: unknown
  }
}

interface DbMsg {
  message_id?: string
  conversation_id?: string
  user_type?: number // 1=user 2=assistant
  create_time?: string | number // 秒级
  content?: string // 智能体/旧版消息：JSON 字符串或纯文本
  content_type?: number
  tts_content?: string
  content_block?: DbContentBlock[]
}

function parseDoubao(ev: IngestEvent): ParsedPayload | null {
  const json = safeJson(ev.body)

  // /im/conversation/info: 解析会话标题
  if (typeof ev.url === "string" && ev.url.indexOf("/im/conversation/info") >= 0) {
    const info = getPath(json, "downlink_body.get_conv_info_downlink_body.conversation_info") as
      | { conversation_id?: string; name?: string }
      | undefined
    if (info?.conversation_id && info?.name) {
      return {
        conversation: {
          ...buildConv(ev.site, String(info.conversation_id), ev.url, 0),
          title: info.name
        },
        messages: []
      }
    }
    return null
  }

  // /im/chain/single: 完整消息链
  const rawMsgs = pickArray(json, [
    "downlink_body.pull_singe_chain_downlink_body.messages"
  ]) as DbMsg[] | null

  // 会话 ID 不在 URL 里（/im/chain/single 是通用接口），从响应体取
  const convId =
    pickConvIdFromUrl(ev.url, ev.site) ??
    rawMsgs?.find((m) => m.conversation_id)?.conversation_id ??
    "unknown"

  if (!rawMsgs || rawMsgs.length === 0) {
    // SSE 流式兜底（发送新消息时的增量）
    const events = splitSse(ev.body)
    const text = events
      .map((e) => pickString(e, ["event_data.text", "text", "content"]))
      .filter(Boolean)
      .join("")
    if (text) {
      return {
        conversation: buildConv(ev.site, convId, ev.url, 1),
        messages: [
          {
            turnId: "sse-current",
            role: "assistant",
            content: text,
            createdAt: ev.capturedAt,
            images: pickImages(text)
          }
        ]
      }
    }
    return null
  }

  const messages: ChatMessage[] = []
  for (const m of rawMsgs) {
    const text = extractDoubaoMessageText(m)
    // 剥离产品功能按钮图标的 markdown 引用（Deep_Think / Search 等），保留生成图
    const normalizedText = stripDoubaoNonGenImageMarkdown(text)
    const allImages = extractDoubaoMessageImages(m, normalizedText)
    if (!normalizedText && allImages.length === 0) continue
    const role: Role = m.user_type === 1 ? "user" : "assistant"
    const ts = Number(m.create_time) || nowMs() / 1000
    // 先剥离文本中所有图片 markdown（避免与追加的 imgMd 重复），再追加合并后的图片
    const cleanText = stripAllImageMarkdown(normalizedText)
    const imgMd = allImages
      .map((img) => `![${img.alt ?? "image"}](${img.url})`)
      .join("\n")
    const content = cleanText && imgMd ? `${cleanText}\n\n${imgMd}` : cleanText || imgMd
    messages.push({
      turnId: String(m.message_id ?? hash(content)),
      role,
      content,
      createdAt: tsToMs(ts),
      images: allImages
    })
  }

  if (messages.length === 0) return null
  // /im/chain/single 返回分页子集：不设 replace，让多次响应通过 message_id
  // 复合主键 upsert 合并（DB put 天然去重），避免滚动加载时互相覆盖。
  return {
    conversation: buildConv(ev.site, convId, ev.url, messages.length),
    messages
  }
}

// 豆包消息正文提取：优先新版 content_block，再回退到智能体/旧版的 content 字符串
function extractDoubaoMessageText(m: DbMsg): string {
  const blocks = m.content_block ?? []
  const fromBlocks = blocks
    .filter((b) => b.block_type === 10000 && !b.parent_id)
    .map((b) => pickString(b, ["content.text_block.text"]))
    .filter(Boolean)
    .join("\n")
    .trim()
  if (fromBlocks) return fromBlocks
  return extractDoubaoContentText(m.content) || (m.tts_content ?? "").trim()
}

function extractDoubaoContentText(content: unknown): string {
  if (typeof content !== "string") return ""
  const trimmed = content.trim()
  if (!trimmed) return ""
  const parsed = safeJson(trimmed)
  if (parsed && typeof parsed === "object") {
    const text = (parsed as Record<string, unknown>).text
    if (typeof text === "string" && text) return text
  }
  return trimmed
}

// 豆包消息图片提取：合并 content_block 扫描与 content 字符串中的生成图
function extractDoubaoMessageImages(m: DbMsg, text: string): ImageRef[] {
  const blockImages = filterDoubaoGeneratedImages(extractDoubaoBlockImages(m.content_block ?? []))
  const contentImages: ImageRef[] = []
  if (typeof m.content === "string") {
    const parsed = safeJson(m.content)
    if (parsed && typeof parsed === "object") {
      contentImages.push(...extractDoubaoBlockImages([{ content: parsed }]))
    }
    contentImages.push(...(pickImages(m.content) ?? []))
  }
  const inlineImages = pickImages(text) ?? []
  return mergeImages(blockImages, filterDoubaoGeneratedImages(contentImages), filterDoubaoGeneratedImages(inlineImages)) ?? []
}

// ============== DOM 兜底（分享页 / SSR）==============

export interface DomBlock {
  role: Role
  text: string
}

export function buildFromDom(
  site: SiteId,
  convId: string,
  url: string,
  blocks: DomBlock[]
): ParsedPayload | null {
  if (blocks.length === 0) return null
  const now = nowMs()
  const messages: ChatMessage[] = blocks.map((b, i) => ({
    // 稳定 turnId：流式增长只 upsert 同一行的 content，不重复
    turnId: `dom-${i}`,
    role: b.role,
    content: b.text,
    createdAt: now + i,
    images: pickImages(b.text)
  }))
  return {
    conversation: buildConv(site, convId, url, messages.length, true),
    messages,
    replace: true
  }
}
