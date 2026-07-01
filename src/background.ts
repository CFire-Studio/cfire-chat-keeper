// MV3 Service Worker：消息汇聚 → IndexedDB
import { MSG } from "~lib/messaging"
import {
  clearMessages,
  countImages,
  countMessages,
  deleteConversation,
  getMessages,
  listConversations,
  saveRaw,
  searchConversations,
  upsertConversation,
  upsertMessages
} from "~lib/db"
import { updateBadge } from "~lib/badge"
import type { Conversation } from "~lib/types"

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
      const convKey = `${p.site}:${p.url}:${p.capturedAt}`
      await saveRaw({
        id: convKey,
        convId: `${p.site}:raw`,
        source: p.source,
        url: p.url,
        status: p.status,
        capturedAt: p.capturedAt,
        body: p.body
      })
      return { ok: true }
    }
    case MSG.PARSED: {
      const { conversation, messages, replace } = msg.payload
      await upsertConversation(conversation)
      if (replace) await clearMessages(conversation.id)
      await upsertMessages(conversation.id, messages)
      // 始终从 DB 重算 messageCount + imageCount，确保准确
      const actualCount = await countMessages(conversation.id)
      const imgCount = await countImages(conversation.id)
      await upsertConversation({
        ...conversation,
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
    default:
      return { ok: false, error: "unknown type" }
  }
}
