// MV3 Service Worker：消息汇聚 → IndexedDB
import { MSG } from "~lib/messaging"
import {
  clearMessages,
  countImages,
  countMessages,
  deleteConversation,
  deleteMessagesByTurnIds,
  getRawByConvId,
  getMessages,
  listConversations,
  saveRaw,
  searchConversations,
  upsertConversation,
  upsertMessages
} from "~lib/db"
import { updateBadge } from "~lib/badge"
import { imageDedupeKey, mergeImages } from "~lib/images"
import { parseEvent } from "~lib/parsers"
import type { ChatMessage, Conversation, ImageRef, IngestEvent, SiteId } from "~lib/types"

// 重新计算每个对话的 imageCount（使用 imageDedupeKey 去重），
// 确保列表查询始终返回准确值，不受 DB 中旧数据影响。
async function refreshImageCounts(convs: Conversation[]): Promise<Conversation[]> {
  const result: Conversation[] = []
  for (const c of convs) {
    const imgCount = await countImages(c.id)
    if (imgCount !== c.imageCount) {
      await upsertConversation({ ...c, imageCount: imgCount })
      result.push({ ...c, imageCount: imgCount })
    } else {
      result.push(c)
    }
  }
  return result
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then((reply) => sendResponse(reply))
    .catch((e) => {
      console.error("[ack:bg]", e)
      sendResponse({ ok: false, error: String(e) })
    })
  return true // async
})

async function handle(msg: { type: string; payload: any }) {
  switch (msg.type) {
    case MSG.INGEST: {
      const p = msg.payload
      const parsed = parseEvent(p)
      const convId = parsed?.conversation.id ?? `${p.site}:raw`
      const convKey = `${convId}:${p.url}:${p.capturedAt}`
      await saveRaw({
        id: convKey,
        convId,
        source: p.source,
        url: p.url,
        status: p.status,
        capturedAt: p.capturedAt,
        body: p.body
      })
      return { ok: true }
    }
    case MSG.PARSED: {
      const { conversation, replace } = msg.payload
      const messages = await normalizeParsedMessages(conversation, msg.payload.messages)
      const convs = await listConversations()
      const existing = convs.find((c) => c.id === conversation.id)
      const createdAt = conversation.createdAt ?? existing?.createdAt
      const updatedAt = Math.max(existing?.updatedAt ?? 0, conversation.updatedAt)
      const nextConversation = { ...conversation, createdAt, updatedAt }
      await upsertConversation(nextConversation)
      if (replace) {
        await clearMessages(conversation.id)
      } else {
        // 跨事件去重：非 replace 场景（如 DOM 图片采集），新消息可能与
        // 已有 API 快照消息内容重复。按 role + 纯文本去重，保留信息量更大的一条。
        const staleTurnIds = await findDuplicateTurnIds(conversation.id, messages)
        if (staleTurnIds.length > 0) {
          await deleteMessagesByTurnIds(conversation.id, staleTurnIds)
        }
      }
      await upsertMessages(conversation.id, messages)
      // 始终从 DB 重算 messageCount + imageCount，确保准确
      const actualCount = await countMessages(conversation.id)
      const imgCount = await countImages(conversation.id)
      await upsertConversation({
        ...nextConversation,
        messageCount: actualCount,
        imageCount: imgCount
      })
      await updateBadge()
      return { ok: true }
    }
    case MSG.LIST_CONVERSATIONS: {
      const convs = await listConversations()
      return await refreshImageCounts(convs)
    }
    case MSG.GET_MESSAGES:
      return await getMessages(msg.payload.id)
    case MSG.DELETE_CONV:
      await deleteConversation(msg.payload.id)
      await updateBadge()
      return { ok: true }
    case MSG.SEARCH_CONVERSATIONS: {
      const convs = await searchConversations(msg.payload.keyword)
      return await refreshImageCounts(convs)
    }
    case MSG.UPDATE_TITLE: {
      const { id, title } = msg.payload
      const convs = await listConversations()
      const existing = convs.find((c) => c.id === id)
      if (existing) {
        await upsertConversation({ ...existing, title })
      }
      return { ok: true }
    }
    case MSG.REPARSE_RAW: {
      const { site, convId } = msg.payload
      const raws = await getRawByConvId(convId)
      let reprocessed = 0
      const convIdsTouched = new Set<string>()
      for (const raw of raws) {
        const evt: IngestEvent = {
          source: raw.source,
          site,
          url: raw.url,
          status: raw.status,
          body: raw.body,
          capturedAt: raw.capturedAt
        }
        const parsed = parseEvent(evt)
        if (!parsed || parsed.conversation.id !== convId) continue
        await upsertConversation(parsed.conversation)
        await upsertMessages(parsed.conversation.id, parsed.messages)
        convIdsTouched.add(parsed.conversation.id)
        reprocessed++
      }
      for (const convId of convIdsTouched) {
        const convs = await listConversations()
        const c = convs.find((x) => x.id === convId)
        if (!c) continue
        const actualCount = await countMessages(convId)
        const imgCount = await countImages(convId)
        await upsertConversation({ ...c, messageCount: actualCount, imageCount: imgCount })
      }
      await updateBadge()
      return { ok: true, reprocessed }
    }
    default:
      return { ok: false, error: "unknown type" }
  }
}

async function normalizeParsedMessages(
  conversation: Conversation,
  messages: ChatMessage[]
): Promise<ChatMessage[]> {
  if (conversation.site !== "doubao") return messages
  const domImageMessage = messages.find((m) => m.turnId === "dom-images")
  if (!domImageMessage?.images?.length) return messages
  const existing = await getMessages(conversation.id)
  const merged = mergeDomImagesIntoExistingMessage(existing, domImageMessage.images)
  return messages.filter((m) => m.turnId !== "dom-images").concat(merged ?? [])
}

function mergeDomImagesIntoExistingMessage(
  messages: ChatMessage[],
  images: ImageRef[]
): ChatMessage | null {
  const existingKeys = new Set<string>()
  for (const message of messages) {
    for (const image of message.images ?? []) existingKeys.add(imageDedupeKey(image.url))
  }
  const missingImages = images.filter((image) => !existingKeys.has(imageDedupeKey(image.url)))
  if (missingImages.length === 0) return null
  const target = [...messages]
    .filter((m) => m.role === "assistant" && m.turnId !== "dom-images")
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!target) return null
  const mergedImages = mergeImages(target.images ?? [], missingImages) ?? []
  const appended = missingImages
    .map((image) => `![${image.alt ?? "image"}](${image.url})`)
    .join("\n")
  const content = target.content.includes(appended)
    ? target.content
    : target.content
      ? `${target.content}\n\n${appended}`
      : appended
  return { ...target, content, images: mergedImages }
}

// 跨事件去重：找出 DB 中与新消息内容重复的旧消息 turnId。
// 按 role + 纯文本（去掉图片 markdown）匹配，保留信息量更大的一条：
//   1. 有原始 API 时间的优先（API 快照 > DOM 采集）
//   2. 图片数多的优先  3. 文本更长的优先
// 返回应删除的旧消息 turnId 列表。
async function findDuplicateTurnIds(
  convId: string,
  newMessages: ChatMessage[]
): Promise<string[]> {
  if (newMessages.length === 0) return []
  const existing = await getMessages(convId)
  if (existing.length === 0) return []

  const staleTurnIds: string[] = []
  for (const neu of newMessages) {
    const textOnly = stripImageMarkdown(neu.content)
    if (!textOnly) continue // 纯图片消息不跨事件去重
    for (const old of existing) {
      if (old.turnId === neu.turnId) continue // 同 turnId 会被 upsert 覆盖，无需删
      if (old.role !== neu.role) continue
      const oldText = stripImageMarkdown(old.content)
      if (oldText !== textOnly) continue
      // 内容重复：优先保留有原始 API 时间的消息
      const neuHasTime = neu.meta?.hasOriginalTime === true
      const oldHasTime = old.meta?.hasOriginalTime === true
      if (oldHasTime && !neuHasTime) {
        // 旧消息有原始时间 → 删新（新消息仍会被 upsert，但信息量较低）
        // 注意：此处无法阻止 upsert，但下次完整快照 replace=true 时会清理
        continue
      }
      if (!oldHasTime && neuHasTime) {
        // 新消息有原始时间 → 删旧
        staleTurnIds.push(old.turnId)
        continue
      }
      // 两者都没有原始时间，或都有：保留信息量更大的
      const neuScore = (neu.images?.length ?? 0) * 10 + neu.content.length
      const oldScore = (old.images?.length ?? 0) * 10 + old.content.length
      if (neuScore >= oldScore) {
        staleTurnIds.push(old.turnId)
      }
    }
  }
  return staleTurnIds
}

function stripImageMarkdown(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim()
}
