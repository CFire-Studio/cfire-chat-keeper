// 统一数据模型：各站点 parser 产出同一形状
export type SiteId = "deepseek" | "chatgpt" | "doubao"

export type Role = "user" | "assistant" | "system" | "tool" | "unknown"

export interface ImageRef {
  url: string             // 图片资源 URL（http/https）
  alt?: string            // 可选描述，用于 markdown 输出
}

export interface ChatMessage {
  turnId: string          // 站点原始消息 id，没有则 hash(content+ts)
  role: Role
  content: string         // 纯文本（拼接后）
  contentMd?: string      // Markdown 原文（可选）
  createdAt: number       // ms
  meta?: Record<string, unknown>
  images?: ImageRef[]     // 从消息内容中提取的图片引用
}

export interface Conversation {
  id: string              // `${site}:${conversationId}`
  site: SiteId
  conversationId: string  // 站点原始会话 id / share id
  title: string
  url: string
  isShare: boolean
  createdAt?: number
  updatedAt: number
  messageCount: number
  imageCount?: number     // 去重图片数（background 在 PARSED 后统计）
  schemaVersion: 1
}

export interface RawPayload {
  id: string              // `${convId}:${seq}`
  convId: string
  source: "fetch-hook" | "xhr-hook" | "dom"
  url: string
  status?: number
  capturedAt: number
  body: string            // 统一为文本；SSE 合并后原文
  requestBody?: string    // 请求体原文（用于分析/复现分页参数）
}

export interface IngestEvent {
  source: RawPayload["source"]
  site: SiteId
  url: string
  status?: number
  body: string
  requestBody?: string
  capturedAt: number
}
