import type { SiteId } from "./types"

export interface SiteConfig {
  id: SiteId
  hostnames: string[]
  // 需要拦截的接口 URL 特征（substring 匹配，避免复杂正则）
  capturePatterns: string[]
  // 从 location.pathname 取 conversationId；匹配不到返回 null
  pickConversationId(pathname: string): string | null
  // 是否为分享页（决定是否主走 DOM 兜底）
  isSharePage(pathname: string): boolean
}

const configs: SiteConfig[] = [
  {
    id: "deepseek",
    hostnames: ["chat.deepseek.com"],
    capturePatterns: ["/api/v0/chat/", "/api/v0/share/", "/completion"],
    pickConversationId(p) {
      // /a/chat/s/<uuid>  或 /share/<id>
      const m =
        p.match(/\/a\/chat\/s\/([^/?#]+)/) ??
        p.match(/\/share\/([^/?#]+)/)
      return m ? m[1] : null
    },
    isSharePage: (p) => p.startsWith("/share/")
  },
  {
    id: "chatgpt",
    hostnames: ["chatgpt.com", "chat.openai.com"],
    capturePatterns: [
      "/backend-api/conversation",
      "/backend-api/f/conversation",
      "/public-api/conversations"
    ],
    pickConversationId(p) {
      const m = p.match(/\/c\/([^/?#]+)/) ?? p.match(/\/share\/([^/?#]+)/)
      return m ? m[1] : null
    },
    isSharePage: (p) => p.startsWith("/share/")
  },
  {
    id: "doubao",
    hostnames: ["www.doubao.com"],
    // /im/chain/single 返回完整消息链；/samantha/ /alice/ 命中大量无关配置 API，已弃用
    capturePatterns: ["/im/chain/single"],
    pickConversationId(p) {
      const m =
        p.match(/\/chat\/(\d+)/) ??
        p.match(/\/thread\/([^/?#]+)/)
      return m ? m[1] : null
    },
    isSharePage: (p) => p.startsWith("/thread/")
  }
]

export function matchSite(hostname: string): SiteConfig | null {
  return configs.find((c) => c.hostnames.includes(hostname)) ?? null
}

export function allSites(): SiteConfig[] {
  return configs
}
