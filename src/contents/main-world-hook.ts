// MAIN world content script：在页面上下文中安装 fetch/XHR 拦截。
//
// 为什么不用 <script>textContent 注入？
//   DeepSeek / 豆包等站点的 CSP 禁止 inline script，<script> 元素注入会被拦截。
//   world:"MAIN" 由 Chrome 扩展机制直接注入，不受 CSP 限制。
//
// 为什么用 getter/setter 而非直接赋值？
//   SPA 框架（豆包/DeepSeek 等）在 document_start 之后会用自己的 wrapper 覆盖
//   window.fetch 和 XMLHttpRequest.prototype.open，导致直接赋值的 hook 被替换。
//   getter/setter 拦截赋值动作，将页面的 wrapper 再包一层，确保拦截链不断。
//
// 职责：仅拦截网络请求，通过 window.postMessage 把命中响应转发给 collector.ts（isolated world）。
import type { PlasmoCSConfig } from "plasmo"

import { matchSite } from "~lib/site-config"

export const config: PlasmoCSConfig = {
  matches: [
    "https://chat.deepseek.com/*",
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://www.doubao.com/*"
  ],
  run_at: "document_start",
  all_frames: false,
  world: "MAIN"
}

const site = matchSite(location.hostname)
if (site) {
  installHook(site.capturePatterns)
  if (site.id === "chatgpt") {
    scheduleChatgptSnapshot(site.isSharePage(location.pathname))
  }
}

function installHook(patterns: string[]) {
  const w = window as any
  if (w.__ACK_HOOK__) return
  w.__ACK_HOOK__ = true

  const TAG = "ACK_NET"

  function hit(u: string): boolean {
    try {
      return patterns.some((p) => u.indexOf(p) >= 0)
    } catch {
      return false
    }
  }

  function post(p: Record<string, unknown>) {
    try {
      window.postMessage(Object.assign({ __tag: TAG }, p), "*")
    } catch {
      // 页面可能处于异常状态，静默丢弃
    }
  }

  // ---- fetch 拦截：getter/setter 防覆盖 ----
  //   页面执行 window.fetch = myFetch 时，setter 将 myFetch 包一层拦截后再存储。
  //   页面执行 var f = window.fetch; f(url) 时，getter 返回当前包装函数。
  const rawFetch = window.fetch

  function wrapFetch(fn: typeof rawFetch): typeof rawFetch {
    return function (this: unknown) {
      const args = arguments
      let url = ""
      try {
        url = typeof args[0] === "string" ? args[0] : (args[0] as any)?.url || ""
      } catch {
        // ignore
      }
      const promise = fn.apply(this, args as any)
      if (hit(url)) {
        promise
          .then((res: Response) => {
            try {
              const clone = res.clone()
              clone
                .text()
                .then((body: string) =>
                  post({ source: "fetch-hook", url, status: res.status, body })
                )
                .catch(() => void 0)
            } catch {
              // ignore
            }
          })
          .catch(() => void 0)
      }
      return promise
    } as typeof rawFetch
  }

  let currentFetch = wrapFetch(rawFetch)
  try {
    Object.defineProperty(w, "fetch", {
      get() {
        return currentFetch
      },
      set(v: typeof rawFetch) {
        // 页面覆盖 fetch 时，把页面的 wrapper 再包一层
        currentFetch = wrapFetch(v)
      },
      configurable: true
    })
  } catch {
    // defineProperty 失败（极端情况），退回到直接赋值
    w.fetch = currentFetch
  }

  // ---- XHR 拦截：同样用 getter/setter 防覆盖 ----
  const XHR = XMLHttpRequest.prototype
  const rawOpen = XHR.open
  const rawSend = XHR.send

  function wrapOpen(fn: typeof rawOpen): typeof rawOpen {
    return function (this: XMLHttpRequest) {
      try {
        (this as any).__ack_url = String(arguments[1] || "")
      } catch {
        // ignore
      }
      return fn.apply(this, arguments as any)
    } as typeof rawOpen
  }

  // send 不需要 wrap——它读取 this.__ack_url，即使 open 被页面覆盖，
  // wrapOpen 的 setter 链也会确保 __ack_url 被设置
  function hookedSend(this: XMLHttpRequest) {
    const url = (this as any).__ack_url || ""
    if (hit(url)) {
      this.addEventListener("loadend", () => {
        try {
          const rt = this.responseType
          const text = rt === "" || rt === "text" ? this.responseText : ""
          if (text) post({ source: "xhr-hook", url, status: this.status, body: text })
        } catch {
          // ignore
        }
      })
    }
    return rawSend.apply(this, arguments as any)
  }

  let currentOpen = wrapOpen(rawOpen)
  try {
    Object.defineProperty(XHR, "open", {
      get() {
        return currentOpen
      },
      set(v: typeof rawOpen) {
        currentOpen = wrapOpen(v)
      },
      configurable: true
    })
  } catch {
    XHR.open = currentOpen
  }
  XHR.send = hookedSend
}

function scheduleChatgptSnapshot(isShare: boolean) {
  const w = window as any
  const timers = [500, 1500, 3000, 6000]
  timers.forEach((delay) => setTimeout(() => postChatgptSnapshot(false), delay))
  window.addEventListener("message", (ev) => {
    if (ev.data?.__tag === "ACK_COLLECT_CHATGPT_SNAPSHOT") {
      postChatgptSnapshot(!!ev.data.force)
    }
  })

  async function postChatgptSnapshot(force = false) {
    if (!isShare && !isChatgptConversationPath(location.pathname)) return
    const data = isShare
      ? pickChatgptLoaderConversation(w)
      : pickChatgptAppConversation(w) ?? await fetchChatgptConversation()
    if (!data?.mapping || typeof data.mapping !== "object") return
    const mappingCount = Object.keys(data.mapping).length
    const signature = `${data.conversation_id ?? location.pathname}:${mappingCount}:${data.current_node ?? ""}`
    if (!force && w.__ACK_CHATGPT_SNAPSHOT_SIGNATURE__ === signature) return
    w.__ACK_CHATGPT_SNAPSHOT_SIGNATURE__ = signature
    window.postMessage(
      {
        __tag: "ACK_NET",
        source: "dom",
        url: location.href,
        status: 200,
        body: JSON.stringify(data)
      },
      "*"
    )
  }
}

function pickChatgptLoaderConversation(w: any): any | null {
  const loaderData = w.__reactRouterContext?.state?.loaderData
  if (!loaderData || typeof loaderData !== "object") return null
  for (const value of Object.values(loaderData)) {
    const data = (value as any)?.serverResponse?.data
    if (data?.mapping && typeof data.mapping === "object") return data
  }
  return null
}

function pickChatgptAppConversation(w: any): any | null {
  const convId = location.pathname.match(/\/c\/([^/?#]+)/)?.[1]
  const root = w.__remixContext ?? w.__reactRouterContext
  const found = findChatgptConversation(root, convId)
  if (found) return found
  return null
}

async function fetchChatgptConversation(): Promise<any | null> {
  const convId = location.pathname.match(/\/c\/([^/?#]+)/)?.[1]
  if (!convId) return null
  try {
    const res = await fetch(`${location.origin}/backend-api/conversation/${convId}`, {
      credentials: "include",
      cache: "no-store"
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.mapping && typeof data.mapping === "object") return data
  } catch {
    return null
  }
  return null
}

function findChatgptConversation(value: unknown, convId?: string, seen = new Set<unknown>()): any | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null
  seen.add(value)
  const obj = value as Record<string, unknown>
  if (obj.mapping && typeof obj.mapping === "object") {
    const id = obj.conversation_id ?? obj.conversationId ?? obj.id
    if (!convId || !id || id === convId) return obj
  }
  for (const child of Object.values(obj)) {
    const found = findChatgptConversation(child, convId, seen)
    if (found) return found
  }
  return null
}

function isChatgptConversationPath(pathname: string): boolean {
  return /^\/c\/[^/?#]+/.test(pathname)
}
