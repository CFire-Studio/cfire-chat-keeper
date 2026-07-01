// 通用 content script（isolated world）：
// 1) 监听 window.postMessage，把命中响应解析后发给 background
// 2) DOM 兜底（按"消息行"采集，避免子段落引起的内容重复）
//
// MAIN world 的 fetch/XHR 拦截由 main-world-hook.ts 负责（world:"MAIN" 绕过 CSP）。
//
// 关键设计：
//   - 一次会话的所有 message 用稳定 turnId 写入 IDB（按 DOM 顺序 idx 或 API message_id），
//     流式更新只 upsert 同一行的 content，不会产生新 row。
//   - 每个站点用一段"行级遍历"逻辑（DOM_PARSERS），而不是宽泛 selector + 误命中子节点。
import type { PlasmoCSConfig } from "plasmo"

import { send, MSG } from "~lib/messaging"
import { matchSite } from "~lib/site-config"
import { parseEvent } from "~lib/parsers"
import { filterDoubaoGeneratedImages, pickImages } from "~lib/images"
import type { ChatMessage, ImageRef, IngestEvent, Role, SiteId } from "~lib/types"
import type { ParsedPayload } from "~lib/messaging"

export const config: PlasmoCSConfig = {
  matches: [
    "https://chat.deepseek.com/*",
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://www.doubao.com/*"
  ],
  run_at: "document_start",
  all_frames: false
}

const site = matchSite(location.hostname)
if (site) {
  bindPostMessage(site.id)
  scheduleDomFallback(site.id, site.isSharePage(location.pathname))
  if (site.id === "doubao" && !site.isSharePage(location.pathname)) {
    scheduleSidebarTitleScrape()
  }
}

// 最近一次 /im/chain/single 响应到达时间，scrollUpLoop 用它判断是否还有更早消息
let lastImChainRespAt = 0

// popup 通过 chrome.tabs.sendMessage 发来 SCROLL_UP，触发自动滚动获取完整历史
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== MSG.SCROLL_UP) return false // 非目标消息不处理，避免干扰 background
  ;(async () => {
    try {
      const result = await scrollUpLoop()
      // 二次处理：滚动加载完成后，从 DOM 抓取 AI 生成图片。
      // 豆包虚拟滚动下只有可见消息在 DOM 中，滚到底部确保对话末尾的图片被渲染。
      if (site?.id === "doubao") {
        await collectDoubaoDomImages()
      }
      sendResponse(result)
    } catch {
      sendResponse({ iterations: 0, scrolled: false })
    }
  })()
  return true // 异步响应
})

function bindPostMessage(siteId: SiteId) {
  window.addEventListener("message", (ev) => {
    const d = ev.data
    if (!d || d.__tag !== "ACK_NET") return
    if (typeof d.url === "string" && d.url.indexOf("/im/chain/single") >= 0) {
      lastImChainRespAt = Date.now()
    }
    const evt: IngestEvent = {
      source: d.source,
      site: siteId,
      url: d.url,
      status: d.status,
      body: d.body,
      capturedAt: Date.now()
    }
    const parsed = parseEvent(evt)
    if (parsed) send(MSG.PARSED, parsed).catch(() => void 0)
    send(MSG.INGEST, evt).catch(() => void 0)
  })
}

// ============== 自动滚动：触发页面分页加载完整历史 ==============

// 定位豆包消息列表的滚动容器。
// 豆包 DOM 层级：message-list > v_list_scroller > scroller_content > list_items > [v_list_row]
// v_list_scroller 是 message-list 的后代（非祖先），是真正的滚动容器。
function findScrollContainer(): HTMLElement | null {
  // 1. 优先找豆包虚拟滚动容器 v_list_scroller
  const scroller = document.querySelector("[class*='v_list_scroller']")
  if (scroller instanceof HTMLElement) return scroller
  // 2. message-list 内部其他 scroller 元素
  const msgList = document.querySelector("[class*='message-list']")
  if (msgList instanceof HTMLElement) {
    const inner = msgList.querySelector("[class*='scroller']")
    if (inner instanceof HTMLElement) return inner
  }
  // 3. 兜底
  return (document.scrollingElement as HTMLElement) || document.documentElement
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// 循环向上滚动，触发页面发起 /im/chain/single 加载更早消息。
// 通过监测 lastImChainRespAt 变化判断是否还有更早消息；无新响应即到顶。
async function scrollUpLoop(
  maxIter = 30,
  waitMs = 2000
): Promise<{ iterations: number; scrolled: boolean }> {
  const container = findScrollContainer()
  if (!container) return { iterations: 0, scrolled: false }

  let iter = 0
  for (; iter < maxIter; iter++) {
    const beforeTs = lastImChainRespAt
    // 滚到顶：触发虚拟滚动的 load-more（IntersectionObserver on scroll_holder sentinel）
    container.scrollTop = 0
    // 主动派发 scroll 事件（某些框架监听 scroll 而非仅依赖 IntersectionObserver）
    container.dispatchEvent(new Event("scroll", { bubbles: true }))
    // 等待新的 /im/chain/single 响应
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      if (lastImChainRespAt > beforeTs) break
      await sleep(100)
    }
    // 超时无新响应 → 已到顶
    if (lastImChainRespAt <= beforeTs) break
    // 等 DOM 渲染稳定后再滚
    await sleep(300)
  }
  return { iterations: iter, scrolled: iter > 0 }
}

// ============== DOM 图片补充（完整获取的二次处理）==============
//
// 豆包 AI 生成图片可能存于 API 响应的 image_block 中（由 parseDoubao 提取），
// 但当 API 响应未直接暴露图片 URL（仅有 file_id/uri）时，解析器可能遗漏。
// 此函数从已渲染的 DOM <img> 中抓取图片 URL 作为补充来源。
// 虚拟滚动下仅可见消息在 DOM 中，故先滚到底部渲染最新消息（含对话末尾图片）。

async function collectDoubaoDomImages(): Promise<void> {
  const container = findScrollContainer()
  if (!container) return
  // 滚到底部，渲染对话末尾的最新消息（AI 生成图片通常在此）
  container.scrollTop = container.scrollHeight
  container.dispatchEvent(new Event("scroll", { bubbles: true }))
  // 等待虚拟滚动渲染 + 图片懒加载触发
  await sleep(1200)

  const imgs = collectVisibleImageUrls()
  if (imgs.length === 0) return

  const convId =
    matchSite(location.hostname)?.pickConversationId(location.pathname) ??
    "dom"
  const now = Date.now()
  const payload: ParsedPayload = {
    conversation: {
      id: `doubao:${convId}`,
      site: "doubao",
      conversationId: convId,
      title: `doubao ${convId}`,
      url: location.href,
      isShare: false,
      updatedAt: now,
      messageCount: 1,
      schemaVersion: 1
    },
    messages: [
      {
        // 稳定 turnId：重复执行只 upsert 同一行，不产生重复
        turnId: "dom-images",
        role: "assistant",
        content: imgs
          .map((img) => `![${img.alt ?? "image"}](${img.url})`)
          .join("\n\n"),
        createdAt: now,
        images: imgs
      }
    ]
  }
  send(MSG.PARSED, payload).catch(() => void 0)
}

// 扫描消息区域内的 <img>，提取 AI 生成图片 URL。
// 过滤掉小尺寸图标/头像（生成图通常 > 200px）。
function collectVisibleImageUrls(): ImageRef[] {
  const out: ImageRef[] = []
  const seen = new Set<string>()
  const msgList = document.querySelector("[class*='message-list']")
  if (!msgList) return out
  msgList.querySelectorAll("img").forEach((img) => {
    const src = img.src || img.getAttribute("data-src") || ""
    if (!src || seen.has(src)) return
    if (!/^https?:\/\//i.test(src)) return
    // 跳过小图标/头像（宽度 < 100 视为非生成图）
    const w = img.naturalWidth || img.width || 0
    if (w > 0 && w < 100) return
    seen.add(src)
    out.push({ url: src, alt: img.alt || undefined })
  })
  // 仅保留 AI 生成图片，排除产品功能按钮图标（Deep_Think / Search 等）
  return filterDoubaoGeneratedImages(out)
}

// ============== 侧边栏对话标题采集 ==============
//
// 豆包侧边栏异步加载，对话标题不在 API 响应中。
// 通过 DOM 抓取侧边栏中与当前 conversationId 匹配的条目文本作为标题。
// 多策略匹配 + 重试，应对侧边栏延迟渲染。

function getCurrentConvId(): string | null {
  return site?.pickConversationId(location.pathname) ?? null
}

function scrapeDoubaoSidebarTitle(convId: string): string | null {
  // 策略 1：找侧边栏中 href 含 conversationId 的链接
  const link = document.querySelector<HTMLAnchorElement>(
    `a[href*='/chat/${convId}']`
  )
  if (link) {
    const t = (link.textContent ?? "").trim()
    if (t && t.length > 0 && t.length < 200) return t
  }
  // 策略 2：找 data-id 匹配的元素，取其内部 title 子元素
  const item = document.querySelector(`[data-id='${convId}']`)
  if (item) {
    const titleEl = item.querySelector("[class*='title'], [class*='name']")
    const t = (titleEl?.textContent ?? item.textContent ?? "").trim()
    if (t && t.length > 0 && t.length < 200) return t
  }
  // 策略 3：找侧边栏 active/selected 项
  const active = document.querySelector(
    "[class*='sidebar'] [class*='active'] [class*='title'], " +
    "[class*='sidebar'] [class*='active'] [class*='name'], " +
    "[class*='session-list'] [class*='active'] [class*='title']"
  )
  if (active) {
    const t = (active.textContent ?? "").trim()
    if (t && t.length > 0 && t.length < 200) return t
  }
  return null
}

function sendTitleUpdate(convId: string, title: string): void {
  send(MSG.UPDATE_TITLE, { id: `doubao:${convId}`, title }).catch(() => void 0)
}

function scheduleSidebarTitleScrape(retry = 0, maxRetry = 3): void {
  const convId = getCurrentConvId()
  if (!convId) return
  const delay = retry === 0 ? 2000 : 5000
  setTimeout(() => {
    const title = scrapeDoubaoSidebarTitle(convId)
    if (title) {
      sendTitleUpdate(convId, title)
    } else if (retry < maxRetry) {
      scheduleSidebarTitleScrape(retry + 1, maxRetry)
    }
  }, delay)
}

// ============== DOM 兜底 ==============

function scheduleDomFallback(siteId: SiteId, isShare: boolean) {
  const run = () => collectDom(siteId, isShare)
  setTimeout(run, 1500)
  const mo = new MutationObserver(debounce(run, 800))
  mo.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener("beforeunload", () => mo.disconnect())
}

function collectDom(siteId: SiteId, isShare: boolean) {
  // 豆包消息列表是虚拟滚动的，DOM 只含可见消息；非分享页依赖 /im/chain/single API，
  // DOM 兜底会以 replace=true 覆盖完整数据，因此跳过
  if (siteId === "doubao" && !isShare) return
  const parser = DOM_PARSERS[siteId]
  const rows = parser()
  if (rows.length === 0) return
  const convId =
    matchSite(location.hostname)?.pickConversationId(location.pathname) ??
    "dom-" + location.pathname.replace(/\W+/g, "-")

  // turnId 用稳定的 "dom-<idx>" — 流式增长只 upsert 同 row，不重复
  const now = Date.now()
  const messages: ChatMessage[] = rows.map((r, i) => ({
    turnId: `dom-${i}`,
    role: r.role,
    content: r.text,
    createdAt: now + i,
    images: pickImages(r.text)
  }))
  const payload: ParsedPayload = {
    conversation: {
      id: `${siteId}:${convId}`,
      site: siteId,
      conversationId: convId,
      title: `${siteId} ${convId}`,
      url: location.href,
      isShare,
      updatedAt: now,
      messageCount: messages.length,
      schemaVersion: 1
    },
    messages,
    // DOM 兜底是完整快照，必须先清旧 row，避免旧选择器残留
    replace: true
  }
  send(MSG.PARSED, payload).catch(() => void 0)
}

// 数据驱动：每站一段"按行遍历"的 DOM 解析
type DomRow = { role: Role; text: string }
type DomParser = () => DomRow[]

const DOM_PARSERS: Record<SiteId, DomParser> = {
  // DeepSeek：每条消息是 .ds-message。
  // - 助手：内含 .ds-markdown.ds-assistant-message-main-content
  // - 用户：不含 assistant md（实测含 .fbb737a4，但 hash 类易变，用否定法）
  deepseek() {
    const rows: DomRow[] = []
    const list = document.querySelectorAll(".ds-message")
    list.forEach((el) => {
      const assistantNode = el.querySelector(
        ".ds-markdown.ds-assistant-message-main-content"
      )
      if (assistantNode) {
        rows.push({ role: "assistant", text: textOf(assistantNode) })
      } else {
        // 用户行：直接取整行文本
        rows.push({ role: "user", text: textOf(el) })
      }
    })
    return rows.filter((r) => r.text.length > 0)
  },

  // ChatGPT：消息以 <section data-testid="conversation-turn-N"> 组织。
  // 用户消息内有 [data-message-author-role="user"] 子元素；助手消息（含 AI 生成图片）无此属性。
  // AI 生成图片在 group/imagegen-image 容器中，URL 形如 /backend-api/estuary/content?id=...
  chatgpt() {
    const rows: DomRow[] = []
    document
      .querySelectorAll<HTMLElement>("[data-testid^='conversation-turn-']")
      .forEach((el) => {
        const roleEl = el.querySelector<HTMLElement>("[data-message-author-role]")
        const role = (roleEl?.dataset.messageAuthorRole ?? "assistant") as Role
        // 助手消息无 role 元素，需剥离图片容器和操作按钮后再取文本
        let text = roleEl
          ? textOf(roleEl)
          : textStripped(el, [
              "[class*='imagegen-image']",
              "[data-testid*='overlay']",
              "button",
              ".sr-only"
            ])
        // 图片可能不在 role 元素内（AI 生成图在 section 内独立容器），扫描整个 section
        const imgs = el.querySelectorAll("img")
        const imgMd: string[] = []
        const seen = new Set<string>()
        imgs.forEach((img) => {
          const src = img.src || img.getAttribute("data-src") || ""
          if (!src || !/^https?:\/\//i.test(src)) return
          if (seen.has(src)) return // 同一 URL 去重（生成图在 DOM 中有 3 份副本）
          const w = img.naturalWidth || img.width || 0
          if (w > 0 && w < 100) return // 过滤图标/头像
          seen.add(src)
          imgMd.push(`![${img.alt || "image"}](${src})`)
        })
        if (imgMd.length > 0) {
          text = text ? `${text}\n\n${imgMd.join("\n")}` : imgMd.join("\n")
        }
        rows.push({ role, text })
      })
    return rows.filter((r) => r.text.length > 0)
  },

  // 豆包：data-testid 已弃用；用 bg-g-send(用户气泡) + message-action-bar(助手行) 定位
  // 注意：消息列表是虚拟滚动的，仅分享页（isShare=true）走 DOM 兜底
  doubao() {
    const rows: { role: Role; text: string; el: Element }[] = []
    // 用户：bg-g-send 是发送方气泡的背景类（实测稳定）
    document
      .querySelectorAll("[class*='message-list'] [class*='bg-g-send']")
      .forEach((el) => rows.push({ role: "user", text: textOf(el), el }))
    // 助手：message-action-bar 出现在助手消息下方；取其所在消息行的文本（去掉按钮文字）
    document
      .querySelectorAll("[class*='message-list'] [class*='message-action-bar']")
      .forEach((el) => {
        const row = el.parentElement?.parentElement
        if (row) {
          const full = textOf(row)
          const bar = textOf(el)
          rows.push({
            role: "assistant",
            text: bar ? full.replace(bar, "").trim() : full,
            el: row
          })
        }
      })
    rows.sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1
    )
    return rows.filter((r) => r.text.length > 0).map(({ role, text }) => ({ role, text }))
  }
}

function textOf(el: Element): string {
  // 用 innerText 拿到带换行的可视文本；fallback 到 textContent
  const t =
    (el as HTMLElement).innerText ?? el.textContent ?? ""
  return t.trim().replace(/\u00a0/g, " ")
}

// 克隆元素后移除指定子元素，再提取纯文本（用于剥离按钮/图片容器等噪声）
function textStripped(el: Element, skipSelectors: string[]): string {
  const clone = el.cloneNode(true) as HTMLElement
  for (const sel of skipSelectors) {
    clone.querySelectorAll(sel).forEach((e) => e.remove())
  }
  const t = clone.textContent ?? ""
  return t.trim().replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n")
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | null = null
  return ((...args: unknown[]) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T
}
