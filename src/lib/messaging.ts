import type { ChatMessage, Conversation, IngestEvent, SiteId } from "./types"

export const MSG = {
  INGEST: "ack:ingest",          // 原始报文 → background
  PARSED: "ack:parsed",          // 解析后结果 → background
  LIST_CONVERSATIONS: "q:list",  // popup → background
  GET_MESSAGES: "q:messages",
  DELETE_CONV: "q:delete",
  SEARCH_CONVERSATIONS: "q:search", // popup → background（标题+全文搜索）
  SCROLL_UP: "ack:scroll-up",     // popup → content script (via chrome.tabs.sendMessage)
  UPDATE_TITLE: "ack:update-title", // collector → background（侧边栏标题更新）
  // scrollUpLoop 完成后，collector → background：从 raw 表重新解析所有 /im/chain/single
  // 响应并 upsert，兜底恢复 scrollUpLoop 期间因 SW 休眠丢失的 PARSED 消息
  REPARSE_RAW: "ack:reparse-raw",
  BATCH_FETCH_HISTORY: "ack:batch-fetch-history" // popup → content script：批量拉取豆包历史
} as const

export interface ParsedPayload {
  conversation: Conversation
  messages: ChatMessage[]
  // true：先清空该 conv 现有 messages 再写入（用于完整快照：DOM/API 全量列表）
  // false/缺省：只 upsert（用于 SSE 流式增量，避免抖动）
  replace?: boolean
}

export type ReqMap = {
  [MSG.INGEST]: { payload: IngestEvent; reply: { ok: boolean } }
  [MSG.PARSED]: { payload: ParsedPayload; reply: { ok: boolean } }
  [MSG.LIST_CONVERSATIONS]: { payload: null; reply: Conversation[] }
  [MSG.GET_MESSAGES]: { payload: { id: string }; reply: ChatMessage[] }
  [MSG.DELETE_CONV]: { payload: { id: string }; reply: { ok: boolean } }
  [MSG.SEARCH_CONVERSATIONS]: { payload: { keyword: string }; reply: Conversation[] }
  [MSG.UPDATE_TITLE]: { payload: { id: string; title: string }; reply: { ok: boolean } }
  [MSG.REPARSE_RAW]: { payload: { site: SiteId; convId: string }; reply: { ok: boolean; reprocessed: number } }
  [MSG.BATCH_FETCH_HISTORY]: { payload: { site: SiteId }; reply: { ok: boolean; fetched: number; reachedTop: boolean; error?: string } }
}

export function send<K extends keyof ReqMap>(
  type: K,
  payload: ReqMap[K]["payload"]
): Promise<ReqMap[K]["reply"]> {
  try {
    return chrome.runtime.sendMessage({ type, payload })
  } catch (error) {
    return Promise.reject(error)
  }
}
