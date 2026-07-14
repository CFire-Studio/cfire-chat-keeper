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
  if (site.id === "doubao") {
    installDoubaoBatchFetcher()
  }
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
      const requestBody = extractRequestBody(args[1])
      const promise = fn.apply(this, args as any)
      if (hit(url)) {
        promise
          .then((res: Response) => {
            try {
              const clone = res.clone()
              clone
                .text()
                .then((body: string) =>
                  post({ source: "fetch-hook", url, status: res.status, body, requestBody })
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

  function extractRequestBody(init: unknown): string | undefined {
    if (!init || typeof init !== "object") return undefined
    try {
      const body = (init as any).body
      if (typeof body === "string") return body
      if (body instanceof URLSearchParams) return body.toString()
      if (body instanceof FormData) return undefined
      if (body instanceof Blob) return undefined
      return undefined
    } catch {
      return undefined
    }
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
    const requestBody = typeof arguments[0] === "string" ? arguments[0] : undefined
    if (hit(url)) {
      this.addEventListener("loadend", () => {
        try {
          const rt = this.responseType
          const text = rt === "" || rt === "text" ? this.responseText : ""
          if (text) post({ source: "xhr-hook", url, status: this.status, body: text, requestBody })
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

// ============== 豆包历史批量拉取（MAIN world，使用页面 cookies）==============
//
// 豆包 /im/chain/single 响应带 has_more + next_index，可通过 next_index 循环翻页，
// 一次性拉完整段对话，比虚拟滚动快得多。
// 触发源：collector.ts（isolated world）通过 window.postMessage 发来初始请求信息。

function installDoubaoBatchFetcher() {
  if ((window as any).__DOUBAO_BATCH_FETCH_INSTALLED__) return
  ;(window as any).__DOUBAO_BATCH_FETCH_INSTALLED__ = true

  window.addEventListener("message", (ev) => {
    const d = ev.data
    if (!d || d.__tag !== "ACK_TRIGGER_BATCH_FETCH") return
    runDoubaoBatchFetch(d.url, d.requestBody, d.nextIndex, d.conversationId)
  })
}

async function runDoubaoBatchFetch(
  url: string,
  baseRequestBody: string | null,
  startNextIndex: string | null,
  conversationId?: string | null
) {
  const result: { ok: boolean; fetched: number; reachedTop: boolean; error?: string } = {
    ok: false,
    fetched: 0,
    reachedTop: false
  }
  try {
    let req: any = parseDoubaoChainRequest(baseRequestBody)
    if (!req) {
      if (!conversationId) {
        result.error = "缺少 /im/chain/single 请求体和 conversationId"
        postBatchResult(result)
        return
      }
      req = {
        cmd: 3100,
        sequence_id: cryptoRandomUUID(),
        uplink_body: {
          pull_singe_chain_uplink_body: {
            conversation_id: conversationId,
            conversation_type: 3,
            limit: 20,
            ext: {},
            filter: { index_list: [] },
            evaluate_ab_params: "",
            evaluate_common_params: ""
          }
        },
        channel: 2,
        version: "1"
      }
    }

    let anchorIndex: number = startNextIndex ? Number(startNextIndex) : 999999
    let fetched = 0
    const maxPages = 2000 // 安全上限：约 2000 * 20 = 4w 条消息
    let pageDelay = 120   // 初始间隔；遇到错误会退避
    let consecutiveErrors = 0
    const maxConsecutiveErrors = 5

    for (let page = 0; page < maxPages; page++) {
      // 确保请求体包含正确的 uplink_body 结构
      if (!req.uplink_body || typeof req.uplink_body !== "object") {
        req.uplink_body = {}
      }
      const uplink = req.uplink_body as Record<string, any>
      if (!uplink.pull_singe_chain_uplink_body || typeof uplink.pull_singe_chain_uplink_body !== "object") {
        uplink.pull_singe_chain_uplink_body = {}
      }
      const body = uplink.pull_singe_chain_uplink_body
      body.anchor_index = anchorIndex
      body.direction = 1
      body.limit = 20
      body.conversation_type = body.conversation_type ?? 3
      body.ext = body.ext ?? {}
      body.filter = body.filter ?? { index_list: [] }

      let data: any
      let lastError: string | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json; encoding=utf-8" },
            body: JSON.stringify(req)
          })
          if (!res.ok) {
            lastError = `HTTP ${res.status}`
          } else {
            data = await res.json()
            if (data?.status_code) {
              lastError = `${data.status_code}: ${data.status_desc || "unknown"}`
              data = null
            } else {
              lastError = null
              break
            }
          }
        } catch (e) {
          lastError = String(e)
        }
        if (attempt < 2) {
          pageDelay = Math.min(pageDelay + 200, 2000)
          await sleep(pageDelay)
        }
      }

      if (lastError || !data) {
        consecutiveErrors++
        if (consecutiveErrors >= maxConsecutiveErrors) {
          result.error = `连续 ${maxConsecutiveErrors} 次请求失败，最后一次：${lastError || "unknown"}`
          break
        }
        // 单页错误：跳过当前 anchor，尝试下一页（可能服务端该页异常）
        anchorIndex = Math.max(0, anchorIndex - 20)
        if (page > 0) await sleep(pageDelay)
        continue
      }
      consecutiveErrors = 0

      const chain = getDeepPath(data, ["downlink_body", "pull_singe_chain_downlink_body"])
      if (!chain || typeof chain !== "object") {
        result.error = "响应缺少 pull_singe_chain_downlink_body"
        break
      }
      const msgs = Array.isArray(chain.messages) ? chain.messages : []
      fetched += msgs.length
      if (chain.has_more === false || !chain.next_index) {
        result.reachedTop = true
        break
      }
      anchorIndex = Number(chain.next_index)
      if (page > 0) await sleep(pageDelay)
    }

    result.ok = !result.error
    result.fetched = fetched
  } catch (e) {
    result.error = String(e)
  }
  postBatchResult(result)
}

function postBatchResult(result: { ok: boolean; fetched: number; reachedTop: boolean; error?: string }) {
  window.postMessage({ __tag: "ACK_BATCH_FETCH_RESULT", ...result }, "*")
}

function parseDoubaoChainRequest(body: string): any | null {
  try {
    const json = JSON.parse(body)
    if (!json || typeof json !== "object") return null
    return json
  } catch {
    return null
  }
}

function setDeepPath(obj: any, path: string[], value: unknown): void {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    if (cur == null || typeof cur !== "object") return
    cur = cur[path[i]]
  }
  const last = path[path.length - 1]
  if (cur != null && typeof cur === "object") {
    cur[last] = value
  }
}

function getDeepPath(obj: any, path: string[]): any {
  let cur = obj
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = cur[p]
  }
  return cur
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function cryptoRandomUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${1e7}-${1e3}-${4e3}-${8e3}-${1e11}`.replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)
  )
}
