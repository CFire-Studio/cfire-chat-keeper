// 文件夹名称历史管理：记忆用户使用过的保存目录，提供前缀搜索。
//
// 存储于 chrome.storage.local，最多保留 10 条，新值插入头部并去重。
const STORAGE_KEY = "saveDirHistory"
const MAX_HISTORY = 10

export async function loadHistory(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (r) => {
      resolve(Array.isArray(r[STORAGE_KEY]) ? r[STORAGE_KEY] : [])
    })
  })
}

export async function addHistory(dir: string): Promise<void> {
  const trimmed = dir.trim()
  if (!trimmed) return
  const history = await loadHistory()
  const filtered = history.filter((h) => h !== trimmed)
  filtered.unshift(trimmed)
  const next = filtered.slice(0, MAX_HISTORY)
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
}

export function filterByPrefix(history: string[], input: string): string[] {
  const prefix = input.trim().toLowerCase()
  if (!prefix) return history
  return history.filter((h) => h.toLowerCase().startsWith(prefix))
}
