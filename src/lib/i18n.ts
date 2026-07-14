// 多语言支持：检测浏览器语言，CN/HK/TW 显示中文，其余显示英文。
const zhRegions = new Set(["zh-CN", "zh-HK", "zh-TW", "zh-MO", "zh-SG"])

function isZh(): boolean {
  return zhRegions.has(navigator.language)
}

type Lang = "zh" | "en"

const dict: Record<string, Record<Lang, string>> = {
  brandSub: { zh: "守护创作者与 AI 交流的回忆和数据🐾", en: "Guardian of the conversation between creators and AI" },
  refreshTitle: { zh: "刷新", en: "Refresh" },
  scrollBtnIdle: { zh: "完整获取", en: "Fetch All" },
  scrollBtnBusy: { zh: "获取中…", en: "Fetching…" },
  scrollMeta: { zh: "补全当前豆包或 ChatGPT 的完整历史对话", en: "Capture the full history of the current Doubao or ChatGPT conversation" },
  scrollAlert1: { zh: "请在豆包对话页或 ChatGPT 分享页使用此功能", en: "Please use this feature on a Doubao chat page or ChatGPT shared page" },
  scrollAlert2: { zh: "完整获取失败，请确认当前页已加载扩展", en: "Fetch failed. Please ensure the extension is loaded on the current page" },
  batchFetchBtnIdle: { zh: "快速拉取历史", en: "Fast Fetch History" },
  batchFetchBtnBusy: { zh: "快速拉取中…", en: "Fast Fetching…" },
  batchFetchMeta: { zh: "基于 next_index 批量翻页，快速获取豆包全部历史", en: "Batch fetch Doubao history via next_index pagination" },
  batchFetchAlert: { zh: "请在豆包对话页使用此功能", en: "Please use this feature on a Doubao chat page" },
  batchFetchFail: { zh: "快速拉取失败", en: "Fast fetch failed" },
  folderLabel: { zh: "文件夹名称", en: "Folder Name" },
  folderPlaceholder: { zh: "默认保存在 Downloads 目录", en: "Saved in Downloads by default" },
  folderTitle: { zh: "相对 Downloads 根目录的子路径，如 ai-chats/2026", en: "Subdirectory relative to Downloads, e.g. ai-chats/2026" },
  searchPlaceholder: { zh: "筛选标题或内容…", en: "Filter by title or content…" },
  searchClear: { zh: "清除", en: "Clear" },
  countSearching: { zh: "筛选中…", en: "Searching…" },
  countN: { zh: " 个对话", en: " conversations" },
  batchBtn: { zh: "批量下载", en: "Batch Download" },
  progressText: { zh: "下载中", en: "Downloading" },
  progressImg: { zh: "图片", en: "images" },
  emptyCatAccessible: { zh: "猫", en: "Cat" },
  emptyNoMatch: { zh: "没有匹配的对话。", en: "No matching conversations." },
  emptyNoData: {
    zh: "暂无数据。打开 DeepSeek / ChatGPT / 豆包 任一对话页即可自动采集。",
    en: "No data yet. Open any DeepSeek / ChatGPT / Doubao chat page to auto-capture."
  },
  emptyGuideLine1: {
    zh: "如果没有识别到对话内容：",
    en: "If no conversation content is detected:"
  },
  emptyGuideLine2: {
    zh: "1. 点击右上角 ↻ 刷新按钮",
    en: "1. Click the ↻ refresh button at the top-right corner"
  },
  emptyGuideLine3: {
    zh: "2. 或刷新当前对话页面",
    en: "2. Or refresh the current chat page"
  },
  emptyGuideLine4: {
    zh: "3. 如问题仍存在，可发邮件至",
    en: "3. If the issue persists, email us at"
  },
  modalTitle: { zh: "将下载", en: "Will download" },
  modalTitleSuffix: { zh: "个对话文件", en: " conversation files" },
  modalSubtitle: { zh: "请选择导出格式", en: "Select export format" },
  modalImgNote: {
    zh: "对话中的图片将保存为独立文件，存放于对话文件夹下的 images 子目录中",
    en: "Images in conversations will be saved as separate files in an images subfolder within each conversation folder"
  },
  modalCancel: { zh: "取消", en: "Cancel" },
}

export function t(key: string): string {
  const lang: Lang = isZh() ? "zh" : "en"
  return dict[key]?.[lang] ?? key
}
