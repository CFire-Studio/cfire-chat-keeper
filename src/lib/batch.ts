// 批量下载纯逻辑：从 popup.tsx 提取，保持 popup 专注 UI/状态。
//
// 职责：遍历目标对话列表，逐个导出文本文件 + 下载勾选的图片，通过回调报告进度。
// 对话与图片交错下载（匹配原始行为），错开间隔避免 Chrome 拦截多文件下载。
import { MSG, send } from "./messaging"
import { collectImages } from "./images"
import { exportConversation, downloadImage } from "./export"
import type { Conversation } from "./types"

export type BatchProgress = {
  done: number
  total: number
  imgDone: number
  imgTotal: number
}

export async function runBatchDownload(
  targets: Conversation[],
  fmt: "json" | "md",
  selectedImages: Record<string, Set<string>>,
  saveDir: string,
  onProgress: (p: BatchProgress) => void
): Promise<void> {
  const total = targets.length
  let done = 0
  let imgDone = 0
  let imgTotal = 0

  onProgress({ done, total, imgDone, imgTotal })

  for (const c of targets) {
    try {
      await exportConversation(c, fmt, saveDir)
    } catch (e) {
      console.error("[ack:batch]", e)
    }
    done++
    onProgress({ done, total, imgDone, imgTotal })
    await new Promise((r) => setTimeout(r, 250))

    // 下载该对话勾选的图片
    const selected = selectedImages[c.id]
    if (selected && selected.size > 0) {
      const msgs = await send(MSG.GET_MESSAGES, { id: c.id })
      const allImgs = collectImages(msgs)
      const picked = allImgs.filter((img) => selected.has(img.url))
      imgTotal += picked.length
      onProgress({ done, total, imgDone, imgTotal })

      for (let i = 0; i < picked.length; i++) {
        try {
          await downloadImage(c, picked[i], i, saveDir)
        } catch (e) {
          console.error("[ack:img]", e)
        }
        imgDone++
        onProgress({ done, total, imgDone, imgTotal })
        await new Promise((r) => setTimeout(r, 200))
      }
    }
  }

  onProgress({ done, total, imgDone, imgTotal })
}
