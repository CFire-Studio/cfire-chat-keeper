// 对话导出与图片下载的纯逻辑层。
// 拆出此模块仅为让 popup.tsx 专注于 UI/状态，保持单文件 < 400 行。
import { MSG, send } from "./messaging"
import { basenameFromUrl } from "./images"
import { formatMessageTime } from "./time"
import type { ChatMessage, Conversation } from "./types"

export async function exportConversation(
  c: Conversation,
  fmt: "json" | "md",
  saveDir: string
): Promise<void> {
  const msgs = await send(MSG.GET_MESSAGES, { id: c.id })
  const blob =
    fmt === "json"
      ? new Blob([JSON.stringify({ conversation: c, messages: msgs }, null, 2)], {
          type: "application/json"
        })
      : new Blob([toMarkdown(c, msgs)], { type: "text/markdown" })
  const url = URL.createObjectURL(blob)
  const ext = fmt === "md" ? "md" : "json"
  await chrome.downloads.download({
    url,
    filename: withSaveDir(saveDir, `${c.site}-${c.conversationId}.${ext}`)
  })
  // 下载启动后释放 Blob URL，避免批量场景下内存泄漏
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadImage(
  c: Conversation,
  img: { url: string },
  idx: number,
  saveDir: string
): Promise<void> {
  const base = basenameFromUrl(img.url, idx)
  const filename = withSaveDir(
    saveDir,
    `${c.site}-${c.conversationId}/images/${base}`
  )
  await chrome.downloads.download({ url: img.url, filename })
}

// 相对 Downloads 根目录的子路径消毒：去非法字符、首尾斜杠、. / .. 段
export function sanitizeDir(input: string): string {
  return input
    .trim()
    .replace(/[\\:*?"<>|]/g, "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/")
}

export function withSaveDir(saveDir: string, filename: string): string {
  const dir = sanitizeDir(saveDir)
  return dir ? `${dir}/${filename}` : filename
}

export function toMarkdown(c: Conversation, msgs: ChatMessage[]): string {
  const createdAt = c.createdAt ?? msgs[0]?.createdAt ?? c.updatedAt
  const head = `# ${c.title}\n\n- site: ${c.site}\n- url: ${c.url}\n- createdAt: ${new Date(
    createdAt
  ).toISOString()}\n\n---\n\n`
  const body = msgs
    .map((m) => {
      const hasOriginalTime = m.meta?.hasOriginalTime !== false
      const time = hasOriginalTime ? formatMessageTime(m.createdAt) : ""
      return `### ${m.role}${time ? " · " + time : ""}\n\n${m.content}\n`
    })
    .join("\n")
  return head + body
}
