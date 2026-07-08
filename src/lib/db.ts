import type { ChatMessage, Conversation, RawPayload } from "./types"
import { imageDedupeKey } from "./images"

const DB_NAME = "cfire-chat-keeper"
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains("conversations")) {
        const s = db.createObjectStore("conversations", { keyPath: "id" })
        s.createIndex("site", "site")
        s.createIndex("updatedAt", "updatedAt")
      }
      if (!db.objectStoreNames.contains("messages")) {
        const s = db.createObjectStore("messages", {
          keyPath: ["convId", "turnId"]
        })
        s.createIndex("convId", "convId")
      }
      if (!db.objectStoreNames.contains("raw")) {
        const s = db.createObjectStore("raw", { keyPath: "id" })
        s.createIndex("convId", "convId")
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(
  store: string | string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        let result: T
        Promise.resolve(fn(t)).then((r) => (result = r as T), reject)
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      })
  )
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function upsertConversation(c: Conversation): Promise<void> {
  await tx("conversations", "readwrite", (t) => {
    t.objectStore("conversations").put(c)
  })
}

export async function upsertMessages(
  convId: string,
  messages: ChatMessage[]
): Promise<void> {
  if (messages.length === 0) return
  await tx("messages", "readwrite", (t) => {
    const s = t.objectStore("messages")
    for (const m of messages) s.put({ ...m, convId })
  })
}

// 清空指定 conversation 的所有 messages（不动 conversation 本身）
export async function clearMessages(convId: string): Promise<void> {
  await tx("messages", "readwrite", async (t) => {
    const idx = t.objectStore("messages").index("convId")
    const cur = idx.openCursor(IDBKeyRange.only(convId))
    await new Promise<void>((resolve, reject) => {
      cur.onerror = () => reject(cur.error)
      cur.onsuccess = () => {
        const c = cur.result
        if (!c) return resolve()
        c.delete()
        c.continue()
      }
    })
  })
}

// 删除指定 conversation 中 turnId 在给定列表中的 messages
// 用于跨事件去重：DOM 图片采集的消息可能与 API 快照消息内容重复
export async function deleteMessagesByTurnIds(
  convId: string,
  turnIds: string[]
): Promise<void> {
  if (turnIds.length === 0) return
  await tx("messages", "readwrite", (t) => {
    const store = t.objectStore("messages")
    for (const tid of turnIds) {
      store.delete([convId, tid])
    }
  })
}

export async function saveRaw(r: RawPayload): Promise<void> {
  await tx("raw", "readwrite", (t) => {
    t.objectStore("raw").put(r)
  })
}

export async function getRawByConvId(convId: string): Promise<RawPayload[]> {
  return tx("raw", "readonly", async (t) => {
    const idx = t.objectStore("raw").index("convId")
    return reqAsPromise(
      idx.getAll(IDBKeyRange.only(convId)) as IDBRequest<RawPayload[]>
    )
  })
}

export async function listConversations(): Promise<Conversation[]> {
  return tx("conversations", "readonly", async (t) => {
    const all = await reqAsPromise(
      t.objectStore("conversations").getAll() as IDBRequest<Conversation[]>
    )
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  })
}

// 标题 OR 全文内容包含关键词（大小写不敏感）。单事务扫描，避免 N 次 round-trip。
export async function searchConversations(keyword: string): Promise<Conversation[]> {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return listConversations()
  return tx(["conversations", "messages"], "readonly", async (t) => {
    // 收集消息内容命中关键词的 convId 集合
    const matchedConvIds = new Set<string>()
    const cur = t.objectStore("messages").openCursor()
    await new Promise<void>((resolve, reject) => {
      cur.onerror = () => reject(cur.error)
      cur.onsuccess = () => {
        const c = cur.result
        if (!c) return resolve()
        const m = c.value as ChatMessage & { convId: string }
        if (
          m.content?.toLowerCase().includes(kw) ||
          m.contentMd?.toLowerCase().includes(kw)
        ) {
          matchedConvIds.add(m.convId)
        }
        c.continue()
      }
    })
    const all = await reqAsPromise(
      t.objectStore("conversations").getAll() as IDBRequest<Conversation[]>
    )
    return all
      .filter(
        (c) =>
          c.title?.toLowerCase().includes(kw) || matchedConvIds.has(c.id)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })
}

export async function getMessages(convId: string): Promise<ChatMessage[]> {
  return tx("messages", "readonly", async (t) => {
    const idx = t.objectStore("messages").index("convId")
    const list = await reqAsPromise(
      idx.getAll(IDBKeyRange.only(convId)) as IDBRequest<ChatMessage[]>
    )
    return list
      .filter((m) => !(convId.startsWith("doubao:") && m.turnId === "dom-images"))
      .sort((a, b) => a.createdAt - b.createdAt)
  })
}

export async function countMessages(convId: string): Promise<number> {
  return (await getMessages(convId)).length
}

// 统计对话内去重图片 URL 数量（用于角标总数和 Conversation.imageCount）
// 使用 imageDedupeKey 去重，豆包 rc_gen_image/<hex> 的不同变体只计一次
export async function countImages(convId: string): Promise<number> {
  const msgs = await getMessages(convId)
  const seen = new Set<string>()
  for (const m of msgs) {
    for (const img of m.images ?? []) {
      seen.add(imageDedupeKey(img.url))
    }
  }
  return seen.size
}

export async function deleteConversation(id: string): Promise<void> {
  await tx(["conversations", "messages", "raw"], "readwrite", async (t) => {
    t.objectStore("conversations").delete(id)
    const ms = t.objectStore("messages").index("convId")
    const rs = t.objectStore("raw").index("convId")
    for (const idx of [ms, rs]) {
      const cur = idx.openCursor(IDBKeyRange.only(id))
      await new Promise<void>((resolve, reject) => {
        cur.onerror = () => reject(cur.error)
        cur.onsuccess = () => {
          const c = cur.result
          if (!c) return resolve()
          c.delete()
          c.continue()
        }
      })
    }
  })
}
