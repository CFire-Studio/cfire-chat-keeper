// 图片资源提取与下载辅助工具。
//
// 设计：
//   - extractImages 是纯函数，从文本中识别 markdown `![alt](url)` 与 HTML `<img src>` 两种形式
//   - 仅保留 http/https URL，跳过 data: 内嵌（无法单独下载）
//   - 不强求扩展名（CDN 链接常无扩展名）；markdown 形式本身即显式声明为图片
//   - 调用方：parsers.ts 的 3 站点 parser + buildFromDom；popup.tsx 的批量图片下载
import type { ChatMessage, ImageRef } from "./types"

// markdown: ![alt](url) 或 ![alt](url "title")
const MD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
// html: 先抓整段 <img ...>，再用属性正则分别取 src/alt（避免 src/alt 顺序与可选 alt 干扰）
const HTML_IMG_RE = /<img\b[^>]*>/gi
const SRC_RE = /\bsrc=["']([^"']+)["']/i
const ALT_RE = /\balt=["']([^"']*)["']/i

export function extractImages(text: string): ImageRef[] {
  if (!text) return []
  const out: ImageRef[] = []
  const seen = new Set<string>()

  const push = (url: string, alt?: string) => {
    if (!url || seen.has(url)) return
    if (!/^https?:\/\//i.test(url)) return // 跳过 data: / blob: / 相对路径
    seen.add(url)
    out.push({ url, alt: alt || undefined })
  }

  let m: RegExpExecArray | null
  MD_IMG_RE.lastIndex = 0
  while ((m = MD_IMG_RE.exec(text)) !== null) {
    push(m[2], m[1])
  }
  HTML_IMG_RE.lastIndex = 0
  while ((m = HTML_IMG_RE.exec(text)) !== null) {
    const tag = m[0]
    const sm = SRC_RE.exec(tag)
    if (!sm) continue
    const am = ALT_RE.exec(tag)
    push(sm[1], am?.[1])
  }
  return out
}

// 合并多条消息中的图片 URL（去重，保留首次出现顺序）
// 豆包生成图按 rc_gen_image/<hex> 去重，避免 API 消息与 DOM 补充消息间重复
export function collectImages(msgs: ChatMessage[]): ImageRef[] {
  const out: ImageRef[] = []
  const seen = new Set<string>()
  for (const m of msgs) {
    for (const img of m.images ?? []) {
      const key = imageDedupeKey(img.url)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(img)
      }
    }
  }
  return out
}

// 从 URL 派生安全的图片文件名；失败或为空时退化为 `001-image`
export function basenameFromUrl(url: string, idx: number): string {
  const prefix = String(idx + 1).padStart(3, "0")
  try {
    const u = new URL(url)
    const last = u.pathname.split("/").filter(Boolean).pop() ?? ""
    const safe = last.replace(/[^\w.-]/g, "").slice(0, 40)
    return safe ? `${prefix}-${safe}` : `${prefix}-image`
  } catch {
    return `${prefix}-image`
  }
}

// 从 text 提取图片；空数组返回 undefined，避免给 message 增加空字段
export function pickImages(text: string): ImageRef[] | undefined {
  const imgs = extractImages(text)
  return imgs.length > 0 ? imgs : undefined
}

// ChatGPT content.parts[] 中的显式图片对象 → ImageRef
//
// 已知结构变体：
//   A) { content_type: "image_asset_pointer", image_url: { url: "https://..." } }
//      — 用户上传图，URL 已签名可直接访问
//   B) { content_type: "image_asset_pointer", image_asset: { file_id: "file-xxx" }, asset_pointer: "file-service://file-xxx" }
//      — DALL·E 生成图等，无直接 URL，需走 /backend-api/files/<file_id>/download
//   C) { content_type: "image" / "image_url" 等, url: "https://..." } — GPT-4o 等原生生成
//   D) { image_url: "https://..." } — image_url 为直接字符串
//
// 防御策略：content_type 包含 "image" 即视为图片；image_url 同时支持 string 和 {url} 两种形态。
export function extractChatgptAssetImages(parts: unknown[]): ImageRef[] {
  const out: ImageRef[] = []
  const seen = new Set<string>()

  // alt 可选来源
  const pickAlt = (p: Record<string, unknown>): string | undefined => {
    const asset = p.image_asset as { file_id?: string } | undefined
    return asset?.file_id
  }

  for (const p of parts) {
    if (!p || typeof p !== "object") continue
    const part = p as Record<string, unknown>

    // 宽松 content_type：包含 "image" 即视为图片 part
    const ct = String(part.content_type ?? "")
    if (!ct.toLowerCase().includes("image")) continue

    // 1) 直接 URL：image_url 为字符串或 { url } 对象
    const rawUrl =
      (part.url as string | undefined) ??
      (typeof part.image_url === "string" ? part.image_url : undefined) ??
      ((part.image_url as { url?: string } | undefined)?.url)
    if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
      if (!seen.has(rawUrl)) {
        seen.add(rawUrl)
        out.push({ url: rawUrl, alt: pickAlt(part) })
      }
      continue
    }

    // 2) file_id / asset_pointer → 构造下载 URL
    const fileId =
      (part.image_asset as { file_id?: string } | undefined)?.file_id ??
      pickFileIdFromPointer(part.asset_pointer as string | undefined)
    if (fileId) {
      const downloadUrl = chatgptFileDownloadUrl(fileId)
      if (!seen.has(downloadUrl)) {
        seen.add(downloadUrl)
        out.push({ url: downloadUrl, alt: fileId })
      }
    }
  }
  return out
}

// asset_pointer 形如 "file-service://file-abc123" → 提取 "file-abc123"
function pickFileIdFromPointer(pointer?: string): string | undefined {
  if (!pointer) return undefined
  const m = pointer.match(/(file-[A-Za-z0-9_-]+)/)
  return m ? m[1] : undefined
}

// ChatGPT 文件下载 URL 前缀：兼容 chatgpt.com 与 chat.openai.com
function chatgptFileDownloadUrl(fileId: string): string {
  return `https://chatgpt.com/backend-api/files/${fileId}/download`
}

// ChatGPT message.attachments[] 中的图片附件 → ImageRef
// 附件结构：{ id: "file-xxx", mimeType: "image/png", name: "photo.png" }
// 与 parts 中的 image_asset_pointer 同样走 /backend-api/files/<id>/download
export function pickChatgptAttachmentImages(
  attachments?: Array<{ id?: string; mimeType?: string; name?: string }>
): ImageRef[] {
  if (!attachments || attachments.length === 0) return []
  const out: ImageRef[] = []
  const seen = new Set<string>()
  for (const a of attachments) {
    if (!a.id) continue
    if (a.mimeType && !a.mimeType.startsWith("image/")) continue
    const url = chatgptFileDownloadUrl(a.id)
    if (!seen.has(url)) {
      seen.add(url)
      out.push({ url, alt: a.name ?? a.id })
    }
  }
  return out
}

// 合并多个 ImageRef 列表（去重，保留首次出现顺序）；空则返回 undefined
// 豆包生成图按 rc_gen_image/<hex> 去重，避免同一图片的缩略图/原图/下载 URL 变体被重复计入
export function mergeImages(...lists: ImageRef[][]): ImageRef[] | undefined {
  const seen = new Set<string>()
  const merged: ImageRef[] = []
  for (const list of lists) {
    for (const img of list) {
      const key = imageDedupeKey(img.url)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(img)
      }
    }
  }
  return merged.length > 0 ? merged : undefined
}

// 图片去重键：豆包生成图以 rc_gen_image/<hex> 为键（同一图片的不同 URL 变体归一），
// 其他图片以完整 URL 为键
export function imageDedupeKey(url: string): string {
  const m = url.match(/\/rc_gen_image\/([a-f0-9]{32})/i)
  if (m) return `doubao-gen:${m[1]}`
  return url
}

// ============== 豆包 content_block 图片提取 ==============
//
// 豆包 AI 生成图片存于 image_block / gallery_block 等块中，block_type 与字段名
// 会随版本变化。这里采用「递归深度扫描」策略：只要值在图片相关容器内、或键名
// 暗示是图片 URL、或字符串本身带图片扩展名，就收集。对 link_reader_block 等
// 非图片容器内的 url 不误收。

// 暗示图片 URL 的键名（不含泛化的 url，避免误收链接阅读块的网页 URL）
const IMG_KEY_RE =
  /^(?:image_url|image_urls|uri|src|thumb_url|thumbnail_url|download_url|origin_url|raw_url|file_url|image|img_url)$/
// 暗示图片容器的键名（后代中的 url 字符串也收）
const IMG_CONTAINER_RE = /image|thumb|gallery|photo|picture|img/i
// 图片扩展名
const IMG_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif)(?:[?#]|$)/i

export function extractDoubaoBlockImages(blocks: unknown[]): ImageRef[] {
  const out: ImageRef[] = []
  const seen = new Set<string>()

  const push = (rawUrl: string, alt?: string) => {
    if (!rawUrl) return
    // 解析协议相对 URL（//cdn... → https://cdn...）
    let url = rawUrl
    if (url.startsWith("//")) url = "https:" + url
    if (!/^https?:\/\//i.test(url)) return
    // 豆包生成图按 hex 去重，避免缩略图/原图/下载 URL 变体重复
    const key = imageDedupeKey(url)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ url, alt: alt || undefined })
  }

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue
    walkForImageUrls(block, push, "", false)
  }
  return out
}

function walkForImageUrls(
  obj: unknown,
  push: (url: string, alt?: string) => void,
  parentKey: string,
  inImageContext: boolean
): void {
  if (obj == null) return
  if (typeof obj === "string") {
    if (inImageContext || IMG_KEY_RE.test(parentKey) || IMG_EXT_RE.test(obj)) {
      push(obj)
    }
    return
  }
  if (Array.isArray(obj)) {
    for (const item of obj) walkForImageUrls(item, push, parentKey, inImageContext)
    return
  }
  if (typeof obj === "object") {
    const ctx = inImageContext || IMG_CONTAINER_RE.test(parentKey)
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      walkForImageUrls(v, push, k, ctx)
    }
  }
}

// ============== 豆包生成图片过滤 ==============
//
// 豆包响应中混入产品功能按钮图标（Deep_Think.png / Search.png 等），
// 它们以 markdown ![]() 形式出现在 text_block 或被 DOM 扫描到。
// 仅保留 AI 生成图片：URL path 含 /rc_gen_image/<32位十六进制>。
// 排除的典型：
//   - bytednsdoc.com/.../tool_icon/Deep_Think.png
//   - bytednsdoc.com/.../cot_tool_icon/Search.png
//   - doubao.com/.../doc-canvas-card-fallback-light.*.png

const DOUBAO_GEN_IMG_RE = /\/rc_gen_image\/[a-f0-9]{32}\b/i

export function isDoubaoGeneratedImage(url: string): boolean {
  return DOUBAO_GEN_IMG_RE.test(url)
}

export function filterDoubaoGeneratedImages(imgs: ImageRef[]): ImageRef[] {
  return imgs.filter((img) => isDoubaoGeneratedImage(img.url))
}

// 从豆包文本内容中剥离非生成图片的 markdown ![]() 引用。
// 复用 MD_IMG_RE（模块级正则，带 g 标志），逐个匹配判断 URL 是否为生成图。
export function stripDoubaoNonGenImageMarkdown(text: string): string {
  if (!text) return text
  MD_IMG_RE.lastIndex = 0
  return text.replace(MD_IMG_RE, (match, _alt: string, url: string) => {
    return isDoubaoGeneratedImage(url) ? match : ""
  }).replace(/\n{3,}/g, "\n\n").trim()
}

// 剥离文本中所有 markdown 图片引用（![alt](url)），用于 parseDoubao
// 在追加 blockImages markdown 前清理文本，避免同一图片在 content 中出现两次
export function stripAllImageMarkdown(text: string): string {
  if (!text) return text
  MD_IMG_RE.lastIndex = 0
  return text.replace(MD_IMG_RE, "").replace(/\n{3,}/g, "\n\n").trim()
}
