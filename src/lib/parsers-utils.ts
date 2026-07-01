// parsers.ts 共用的通用工具：基础类型转换、SSE/JSON 解析、URL/路径拾取。
// 拆出此模块仅为让 parsers.ts 专注于「按站点解析」这一职责，保持单文件 < 400 行。
import type { Conversation, Role, SiteId } from "./types"

export function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function makeId(site: SiteId, convId: string): string {
  return `${site}:${convId}`
}

export function toRole(r: unknown): Role {
  if (r === "user" || r === "assistant" || r === "system" || r === "tool")
    return r
  return "unknown"
}

export function nowMs(): number {
  return Date.now()
}

// 把 SSE 文本拆成事件 data 行，返回 JSON 对象数组（忽略解析失败的行）
export function splitSse(text: string): unknown[] {
  const out: unknown[] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^data:\s*(.*)$/)
    if (!m) continue
    const data = m[1].trim()
    if (!data || data === "[DONE]") continue
    try {
      out.push(JSON.parse(data))
    } catch {
      // 忽略 keep-alive / 非 JSON 行
    }
  }
  return out
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function buildConv(
  site: SiteId,
  convId: string,
  url: string,
  count: number,
  isShare = false
): Conversation {
  return {
    id: makeId(site, convId),
    site,
    conversationId: convId,
    title: `${site} ${convId}`,
    url,
    isShare: isShare || /\/share\/|\/thread\//.test(url),
    updatedAt: nowMs(),
    messageCount: count,
    schemaVersion: 1
  }
}

// 从 URL 解析出站点的 conversationId；不命中返回 null
export function pickConvIdFromUrl(url: string, site: SiteId): string | null {
  try {
    const u = new URL(url, "https://placeholder.local")
    const p = u.pathname
    if (site === "deepseek") {
      // 优先 query：/api/v0/share/content?share_id=xxx
      const q =
        u.searchParams.get("share_id") ??
        u.searchParams.get("chat_session_id") ??
        u.searchParams.get("session_id")
      if (q) return q
      // 再看 URL path
      const m =
        p.match(/\/a\/chat\/s\/([^/?#]+)/) ??
        p.match(/\/share\/(?!content\b)([^/?#]+)/) // 排除 /share/content 这种接口
      return m ? m[1] : null
    }
    if (site === "chatgpt") {
      const m =
        p.match(/\/c\/([^/?#]+)/) ??
        p.match(/\/share\/([^/?#]+)/) ??
        p.match(/\/conversation\/([^/?#]+)/)
      return m ? m[1] : null
    }
    if (site === "doubao") {
      const m =
        p.match(/\/chat\/(\d+)/) ?? p.match(/\/thread\/([^/?#]+)/)
      return m ? m[1] : null
    }
  } catch {
    /* noop */
  }
  return null
}

// 通用 JSON 路径拾取：getPath/getPath/getPath
export function pickArray(obj: unknown, paths: string[]): unknown[] | null {
  for (const p of paths) {
    const v = getPath(obj, p)
    if (Array.isArray(v)) return v
  }
  return null
}

export function pickString(obj: unknown, paths: string[]): string {
  for (const p of paths) {
    const v = getPath(obj, p)
    if (typeof v === "string") return v
  }
  return ""
}

export function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".")
  let cur: unknown = obj
  for (const k of parts) {
    if (cur == null) return undefined
    if (Array.isArray(cur) && /^\d+$/.test(k)) {
      cur = cur[Number(k)]
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[k]
    } else {
      return undefined
    }
  }
  return cur
}

// 秒级时间戳兼容：< 1e12 视为秒
export function tsToMs(v: number): number {
  return v < 1e12 ? v * 1000 : v
}
