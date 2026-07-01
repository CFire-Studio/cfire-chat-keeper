// 插件图标角标：显示待下载内容项总数（对话 + 图片）。
//
// 由 background 在数据变更后调用。Chrome badge 最多 4 字符，超 9999 显示 "9999+"。
import { listConversations } from "./db"

export async function updateBadge(): Promise<void> {
  try {
    const convs = await listConversations()
    const totalItems = convs.reduce(
      (sum, c) => sum + 1 + (c.imageCount ?? 0),
      0
    )
    const text =
      totalItems === 0
        ? ""
        : totalItems > 9999
          ? "9999+"
          : String(totalItems)
    await chrome.action.setBadgeText({ text })
    await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" })
  } catch (e) {
    console.error("[ack:badge]", e)
  }
}
