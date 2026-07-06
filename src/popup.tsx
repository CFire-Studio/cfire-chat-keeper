import { Fragment, useEffect, useState } from "react"

import { MSG, send } from "~lib/messaging"
import { collectImages, basenameFromUrl } from "~lib/images"
import { exportConversation } from "~lib/export"
import { runBatchDownload, type BatchProgress } from "~lib/batch"
import { loadHistory, addHistory, filterByPrefix } from "~lib/folder-history"
import { t } from "~lib/i18n"
import { styles } from "~popup-styles"
import logoUrl from "url:../assets/icon.png"
import type { Conversation, ImageRef } from "~lib/types"

// 邮箱地址：用户反馈问题
const DEV_EMAIL = "dev@tokenspark.uno"

export default function Popup() {
  const [list, setList] = useState<Conversation[]>([])
  const [scrolling, setScrolling] = useState(false)
  const [keyword, setKeyword] = useState("")
  const [debouncedKeyword, setDebouncedKeyword] = useState("")
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [saveDir, setSaveDir] = useState("")
  const [isDoubaoTab, setIsDoubaoTab] = useState(false)
  const [expandedConvs, setExpandedConvs] = useState<Set<string>>(new Set())
  const [convImages, setConvImages] = useState<Record<string, ImageRef[]>>({})
  const [selectedImages, setSelectedImages] = useState<Record<string, Set<string>>>({})
  const [folderHistory, setFolderHistory] = useState<string[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batching, setBatching] = useState<BatchProgress>({
    done: 0, total: 0, imgDone: 0, imgTotal: 0
  })
  // 刷新按钮旋转动效状态
  const [refreshSpinning, setRefreshSpinning] = useState(false)

  const refresh = () => {
    send(MSG.LIST_CONVERSATIONS, null).then(setList).catch(console.error)
  }

  const onRefreshClick = () => {
    if (busy) return
    setRefreshSpinning(true)
    refresh()
    setTimeout(() => setRefreshSpinning(false), 650)
  }

  useEffect(refresh, [])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setIsDoubaoTab(!!tabs[0]?.url?.includes("doubao.com/chat/"))
    })
  }, [])

  useEffect(() => {
    chrome.storage.local.get("saveDir", (r) => {
      if (typeof r.saveDir === "string") setSaveDir(r.saveDir)
    })
    loadHistory().then(setFolderHistory)
  }, [])

  // 注入刷新按钮旋转动画 keyframes 到 document
  useEffect(() => {
    const styleId = "cfire-keyframes"
    if (document.getElementById(styleId)) return
    const style = document.createElement("style")
    style.id = styleId
    style.textContent = styles.refreshKeyframes as string
    document.head.appendChild(style)
  }, [])

  const updateSaveDir = (v: string) => {
    setSaveDir(v)
    chrome.storage.local.set({ saveDir: v })
  }

  const folderSuggestions = filterByPrefix(folderHistory, saveDir)

  const onSaveDirBlur = async () => {
    if (saveDir.trim()) {
      await addHistory(saveDir)
      setFolderHistory(await loadHistory())
    }
  }

  useEffect(() => {
    const id = setTimeout(() => setDebouncedKeyword(keyword), 250)
    return () => clearTimeout(id)
  }, [keyword])

  // 滚动期间定时刷新列表，让用户实时看到加载进度，无需手动点刷新
  useEffect(() => {
    if (!scrolling) return
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [scrolling])

  useEffect(() => {
    const kw = debouncedKeyword.trim()
    if (!kw) {
      setSearchResults(null)
      return
    }
    let cancelled = false
    send(MSG.SEARCH_CONVERSATIONS, { keyword: kw })
      .then((r) => { if (!cancelled) setSearchResults(r) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [debouncedKeyword])

  const searching = !!debouncedKeyword.trim() && searchResults === null
  const displayList = debouncedKeyword.trim() ? searchResults ?? [] : list
  const busy = scrolling || batchRunning

  const onScrollUp = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url || !tab.url.includes("doubao.com/chat/")) {
      alert(t("scrollAlert1"))
      return
    }
    setScrolling(true)
    try {
      await chrome.tabs.sendMessage(tab.id, { type: MSG.SCROLL_UP })
    } catch {
      alert(t("scrollAlert2"))
    } finally {
      setScrolling(false)
      refresh()
    }
  }

  const onDelete = async (id: string) => {
    await send(MSG.DELETE_CONV, { id })
    refresh()
  }

  const toggleExpand = async (c: Conversation) => {
    const id = c.id
    const next = new Set(expandedConvs)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
      if (!convImages[id]) {
        const msgs = await send(MSG.GET_MESSAGES, { id })
        const imgs = collectImages(msgs)
        setConvImages((prev) => ({ ...prev, [id]: imgs }))
        if (!selectedImages[id]) {
          setSelectedImages((prev) => ({
            ...prev,
            [id]: new Set(imgs.map((i) => i.url))
          }))
        }
      }
    }
    setExpandedConvs(next)
  }

  const toggleImage = (convId: string, url: string) => {
    const cur = new Set(selectedImages[convId] ?? [])
    if (cur.has(url)) cur.delete(url)
    else cur.add(url)
    setSelectedImages((prev) => ({ ...prev, [convId]: cur }))
  }

  const runBatch = async (fmt: "json" | "md") => {
    setBatchDialogOpen(false)
    if (saveDir.trim()) {
      await addHistory(saveDir)
      setFolderHistory(await loadHistory())
    }
    setBatchRunning(true)
    setBatching({ done: 0, total: displayList.length, imgDone: 0, imgTotal: 0 })
    await runBatchDownload(displayList, fmt, selectedImages, saveDir, setBatching)
    setBatchRunning(false)
  }

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <img src={logoUrl} style={styles.logo} alt="CFire Chat Keeper" />
        <div style={{ flex: 1 }}>
          <div style={styles.brand}>CFire Chat Keeper</div>
          <div style={styles.brandSub}>{t("brandSub")}</div>
        </div>
        <button style={refreshSpinning ? styles.headerBtnSpinning : styles.headerBtn} onClick={onRefreshClick} disabled={busy} title={t("refreshTitle")}>↻</button>
      </div>

      {isDoubaoTab && (
        <div style={styles.scrollAction}>
          <button
            style={busy ? styles.btnPrimaryDisabled : styles.btnPrimary}
            onClick={onScrollUp}
            disabled={busy}
            title={t("scrollMeta")}
          >
            {scrolling ? t("scrollBtnBusy") : t("scrollBtnIdle")}
          </button>
          <span style={styles.meta}>{t("scrollMeta")}</span>
        </div>
      )}

      <div style={styles.saveDirRow}>
        <span style={styles.saveDirHint}>📁</span>
        <span style={styles.saveDirLabel}>{t("folderLabel")}</span>
        <input
          style={styles.saveDirInput}
          placeholder={t("folderPlaceholder")}
          value={saveDir}
          onChange={(e) => updateSaveDir(e.target.value)}
          onBlur={onSaveDirBlur}
          disabled={busy}
          title={t("folderTitle")}
        />
      </div>
      {folderSuggestions.length > 0 && (
        <div style={styles.chipRow}>
          {folderSuggestions.slice(0, 5).map((dir) => (
            <button
              key={dir}
              style={styles.chip}
              onClick={() => updateSaveDir(dir)}
              disabled={busy}
            >
              {dir}
            </button>
          ))}
        </div>
      )}

      <div style={styles.searchWrap}>
        <span style={styles.searchIcon}>🔍</span>
        <input
          style={styles.searchInput}
          placeholder={t("searchPlaceholder")}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          disabled={busy}
        />
        {keyword && !busy && (
          <button style={styles.searchClear} onClick={() => setKeyword("")} title={t("searchClear")}>✕</button>
        )}
      </div>

      <div style={styles.toolbar}>
        <span style={styles.count}>
          {searching ? t("countSearching") : `${displayList.length}${t("countN")}`}
        </span>
        <button
          style={displayList.length === 0 || busy ? styles.btnPrimaryDisabled : styles.btnPrimary}
          onClick={() => setBatchDialogOpen(true)}
          disabled={displayList.length === 0 || busy}
        >
          {t("batchBtn")}({displayList.length})
        </button>
      </div>

      {batchRunning && (
        <div style={styles.progressWrap}>
          <div style={styles.progressText}>
            {t("progressText")} {batching.done}/{batching.total}
            {batching.imgTotal > 0 && (
              <span style={styles.progressSubText}>· {t("progressImg")} {batching.imgDone}/{batching.imgTotal}</span>
            )}
            …
          </div>
          <div style={styles.progressBar}>
            <div style={{
              ...styles.progressFill,
              width: `${batching.total ? (batching.done / batching.total) * 100 : 0}%`
            }} />
          </div>
        </div>
      )}

      {displayList.length === 0 && !searching && (
        <div style={styles.empty}>
          <div style={styles.emptyCat}>🐱</div>
          {debouncedKeyword.trim()
            ? t("emptyNoMatch")
            : t("emptyNoData")}
          {!debouncedKeyword.trim() && (
            <div style={{ marginTop: 12 }}>
              <div style={styles.emptyGuideTitle}>{t("emptyGuideLine1")}</div>
              <div style={styles.emptyGuideText}>
                {t("emptyGuideLine2")}<br />
                {t("emptyGuideLine3")}<br />
                {t("emptyGuideLine4")}{" "}
                <a
                  href={`mailto:${DEV_EMAIL}?subject=CFire%20Keeper%20Feedback`}
                  style={styles.emptyGuideLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {DEV_EMAIL}
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {displayList.map((c) => (
        <Fragment key={c.id}>
          <div style={styles.row}>
            <div style={styles.title} title={c.url}>
              <span style={styles.titleSite}>{c.site}</span>{c.title}
              <div style={styles.meta}>
                {c.messageCount} · {new Date(c.updatedAt).toLocaleString()}
                {c.isShare ? " · share" : ""}
                {c.imageCount ? ` · ${c.imageCount} ${t("progressImg")}` : ""}
              </div>
            </div>
            {(c.imageCount ?? 0) > 0 && (
              <button
                style={styles.expandBtn}
                onClick={() => toggleExpand(c)}
                disabled={busy}
              >
                {c.imageCount} {expandedConvs.has(c.id) ? "image" : "image found"}
              </button>
            )}
            <button style={styles.btn} onClick={() => exportConversation(c, "md", saveDir)} disabled={busy}>MD</button>
            <button style={styles.btn} onClick={() => exportConversation(c, "json", saveDir)} disabled={busy}>JSON</button>
            <button style={styles.btn} onClick={() => onDelete(c.id)} disabled={busy}>✕</button>
          </div>
          {expandedConvs.has(c.id) && convImages[c.id]?.map((img, i) => (
            <div key={img.url} style={styles.imgRow}>
              <input
                type="checkbox"
                style={styles.checkbox}
                checked={selectedImages[c.id]?.has(img.url) ?? false}
                onChange={() => toggleImage(c.id, img.url)}
                disabled={busy}
              />
              <img
                src={img.url}
                style={styles.imgThumb}
                onError={(e) => {
                  const el = e.currentTarget
                  el.style.display = "none"
                  const fb = el.nextElementSibling as HTMLElement
                  if (fb) fb.style.display = "flex"
                }}
              />
              <div style={{ ...styles.imgFallback, display: "none" }}>
                {basenameFromUrl(img.url, i).slice(4)}
              </div>
              <span style={styles.imgName} title={img.url}>
                {basenameFromUrl(img.url, i)}
              </span>
            </div>
          ))}
        </Fragment>
      ))}

      {batchDialogOpen && (
        <div style={styles.overlay} onClick={() => setBatchDialogOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>
              {t("modalTitle")} {displayList.length} {t("modalTitleSuffix")}
              <div style={{ fontWeight: 400, fontSize: 12, color: "#888" }}>
                {t("modalSubtitle")}
              </div>
              <div style={{ fontWeight: 400, fontSize: 11, color: "#aaa", marginTop: 6 }}>
                {t("modalImgNote")}
              </div>
            </div>
            <div style={styles.modalRow}>
              <button style={styles.modalBtn} onClick={() => runBatch("md")}>Markdown</button>
              <button style={styles.modalBtn} onClick={() => runBatch("json")}>JSON</button>
            </div>
            <div style={{ ...styles.modalRow, marginTop: 8 }}>
              <button style={styles.modalCancel} onClick={() => setBatchDialogOpen(false)}>{t("modalCancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}