// CFire Chat Keeper — popup 样式常量
// 设计语言：暖色调（琥珀 / 奶油 / 珊瑚），圆角柔和，小猫陪伴感。
// 从 popup.tsx 提取，保持 popup 文件 < 400 行。
import type React from "react"

// 色板：取自猫咪毛色的暖意
const C = {
  primary: "#FF8C42",        // 橘猫主色
  primaryHover: "#F4731C",
  primaryLight: "#FFF0E5",   // 主色浅底
  accent: "#FFB5A7",          // 珊瑚粉点缀
  bg: "#FFFBF5",             // 奶油背景
  surface: "#FFFFFF",
  text: "#3D2817",           // 深棕正文
  textSub: "#8B7355",        // 暖灰副文
  border: "#F0E0D0",         // 暖色描边
  borderLight: "#F7EEDD",
  shadow: "0 2px 8px rgba(255, 140, 66, 0.12)",
  shadowMd: "0 4px 16px rgba(255, 140, 66, 0.18)",
  danger: "#E85D5D"
}

// 字体尺寸层级：xs(10) / sm(11) / md(13) / lg(15)
// 相似内容统一归属同一层级
const F = {
  xs: 10,   // 极小：站点标签、品牌副标题、展开按钮、图片名、标签、回退文字
  sm: 11,   // 小号：元数据、次级按钮、输入标签、进度文字、计数、搜索图标
  md: 13,   // 正文：主按钮、搜索框、空状态、模态按钮、弹窗正文
  lg: 15,   // 大号：品牌标题、模态标题、刷新按钮
}

export const styles: Record<string, React.CSSProperties> = {
  root: {
    width: 380,
    maxHeight: 560,
    font: `${F.md}px/1.5 system-ui, -apple-system, sans-serif`,
    padding: 10,
    boxSizing: "border-box",
    background: C.surface,
    color: C.text
  },

  // ---- 头部：logo + 品牌名 + 刷新 ----
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: `2px solid ${C.borderLight}`
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  brand: {
    flex: 1,
    fontSize: F.lg,
    fontWeight: 700,
    color: C.text,
    letterSpacing: 0.3
  },
  brandSub: {
    fontSize: F.xs,
    color: C.textSub,
    fontWeight: 400,
    letterSpacing: 0.5
  },
  headerBtn: {
    fontSize: F.lg,
    cursor: "pointer",
    background: "none",
    border: "none",
    color: C.textSub,
    padding: "4px 6px",
    borderRadius: 8,
    transition: "all 0.15s",
    flexShrink: 0
  },
  headerBtnSpinning: {
    fontSize: F.lg,
    cursor: "pointer",
    background: "none",
    border: "none",
    color: C.primary,
    padding: "4px 6px",
    borderRadius: 8,
    flexShrink: 0,
    animation: "cfire-spin 0.6s ease-in-out",
    transform: "rotate(0deg)"
  },
  // 刷新按钮旋转动画：点击时 ↻ 快速旋转一圈再恢复
  // 注意：keyframes 定义字符串单独导出，不放入 styles（CSSProperties）中
}

export const refreshKeyframes = `
  @keyframes cfire-spin {
    0%   { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`

// 样式对象保持单一 styles，避免 popup.tsx 大量改动
Object.assign(styles, {
  // ---- 通用按钮 ----
  btn: {
    fontSize: F.sm,
    padding: "3px 8px",
    cursor: "pointer",
    background: C.surface,
    color: C.textSub,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    transition: "all 0.15s",
    flexShrink: 0
  },
  btnPrimary: {
    fontSize: F.md,
    padding: "5px 12px",
    cursor: "pointer",
    background: C.primary,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontWeight: 600,
    boxShadow: "0 2px 6px rgba(255, 140, 66, 0.3)",
    transition: "all 0.15s",
    flexShrink: 0
  },
  btnPrimaryDisabled: {
    fontSize: F.md,
    padding: "5px 12px",
    cursor: "not-allowed",
    background: "#FFCBA8",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontWeight: 600,
    flexShrink: 0
  },
  btnSecondary: {
    fontSize: F.md,
    padding: "5px 12px",
    cursor: "pointer",
    background: "#fff",
    color: C.primary,
    border: `1.5px solid ${C.primary}`,
    borderRadius: 10,
    fontWeight: 600,
    transition: "all 0.15s",
    flexShrink: 0
  },

  // ---- 完整获取区域 ----
  scrollAction: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 10px",
    background: `linear-gradient(135deg, ${C.primaryLight} 0%, #FFE8D5 100%)`,
    borderRadius: 12,
    margin: "6px 0 10px",
    border: `1px solid ${C.accent}`,
    boxShadow: C.shadow
  },

  // ---- 搜索 ----
  searchWrap: { position: "relative", marginBottom: 8 },
  searchInput: {
    width: "100%",
    padding: "6px 26px 6px 24px",
    fontSize: F.md,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    boxSizing: "border-box",
    background: C.surface,
    color: C.text,
    transition: "border-color 0.15s"
  },
  searchIcon: { position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: C.textSub, fontSize: F.sm, pointerEvents: "none" },
  searchClear: { position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: C.textSub, fontSize: F.md, background: "none", border: "none", padding: "0 4px", borderRadius: 6 },

  // ---- 文件夹 ----
  saveDirRow: { display: "flex", alignItems: "center", gap: 5, marginBottom: 4 },
  saveDirLabel: { color: C.textSub, fontSize: F.sm, flexShrink: 0, fontWeight: 500 },
  saveDirInput: { flex: 1, padding: "4px 8px", fontSize: F.sm, borderRadius: 8, border: `1px solid ${C.border}`, boxSizing: "border-box", background: C.surface, color: C.text },
  saveDirHint: { color: C.accent, fontSize: F.sm, flexShrink: 0 },

  // ---- 标签 ----
  chipRow: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  chip: { fontSize: F.xs, padding: "2px 10px", cursor: "pointer", background: C.primaryLight, border: `1px solid ${C.accent}`, borderRadius: 12, color: C.primary, transition: "all 0.15s" },

  // ---- 工具栏 ----
  toolbar: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 },
  count: { flex: 1, color: C.textSub, fontSize: F.sm },
  meta: { color: C.textSub, fontSize: F.sm },

  // ---- 对话行 ----
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 6px",
    borderBottom: `1px solid ${C.borderLight}`,
    gap: 6,
    transition: "background 0.1s",
    borderRadius: 8
  },
  title: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  titleSite: {
    display: "inline-block",
    fontSize: F.xs,
    padding: "1px 5px",
    borderRadius: 5,
    background: C.primaryLight,
    color: C.primary,
    marginRight: 4,
    fontWeight: 600,
    textTransform: "uppercase"
  },
  expandBtn: { fontSize: F.xs, padding: "1px 6px", cursor: "pointer", background: C.primaryLight, border: `1px solid ${C.accent}`, borderRadius: 8, color: C.primary, flexShrink: 0, fontWeight: 600 },

  // ---- 图片行 ----
  detailPanel: { maxHeight: 220, overflowY: "auto", borderBottom: `1px solid ${C.borderLight}` },
  messageRow: { padding: "6px 10px 6px 22px", background: C.bg, borderBottom: `1px solid ${C.borderLight}` },
  messageHead: { color: C.primary, fontSize: F.xs, fontWeight: 700, marginBottom: 2 },
  messageContent: { color: C.textSub, fontSize: F.xs, lineHeight: 1.5, maxHeight: 42, overflow: "hidden" },
  imgRow: { display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 22px", borderBottom: `1px solid ${C.borderLight}` },
  imgThumb: { width: 40, height: 40, objectFit: "cover", borderRadius: 8, flexShrink: 0, background: C.primaryLight, border: `1px solid ${C.border}` },
  imgFallback: { width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontSize: F.xs, color: C.textSub, background: C.primaryLight, borderRadius: 8, flexShrink: 0, overflow: "hidden", padding: 2, textAlign: "center", border: `1px solid ${C.border}` },
  imgName: { flex: 1, fontSize: F.xs, color: C.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  checkbox: { cursor: "pointer", flexShrink: 0, accentColor: C.primary },

  // ---- 进度 ----
  progressWrap: { marginBottom: 8, padding: "6px 0" },
  progressText: { color: C.primary, fontSize: F.sm, marginBottom: 4, fontWeight: 500 },
  progressBar: { height: 6, background: C.borderLight, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", background: `linear-gradient(90deg, ${C.primary} 0%, ${C.accent} 100%)`, transition: "width 0.3s", borderRadius: 4 },
  progressSubText: { color: C.textSub, fontSize: F.sm, marginLeft: 4 },

  // ---- 空状态 ----
  empty: {
    textAlign: "center" as const,
    padding: "24px 12px",
    color: C.textSub,
    fontSize: F.md
  },
  emptyCat: { fontSize: 28, marginBottom: 8 },
  emptyGuideTitle: {
    color: C.text,
    fontSize: F.sm,
    fontWeight: 600,
    marginTop: 8,
    marginBottom: 4
  },
  emptyGuideText: {
    color: C.textSub,
    fontSize: F.sm,
    lineHeight: 1.7
  },
  emptyGuideLink: {
    color: C.primary,
    fontSize: F.sm,
    textDecoration: "underline",
    cursor: "pointer"
  },

  // ---- 模态 ----
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(61, 40, 23, 0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    backdropFilter: "blur(2px)"
  },
  modal: {
    background: C.surface,
    borderRadius: 16,
    padding: 20,
    width: 300,
    boxShadow: C.shadowMd,
    border: `1px solid ${C.border}`
  },
  modalTitle: {
    fontWeight: 700,
    marginBottom: 14,
    textAlign: "center",
    color: C.text,
    fontSize: F.lg
  },
  modalRow: { display: "flex", gap: 8, justifyContent: "center" },
  modalBtn: {
    flex: 1,
    padding: "9px 0",
    fontSize: F.md,
    cursor: "pointer",
    borderRadius: 10,
    border: `1px solid ${C.primary}`,
    background: C.primaryLight,
    color: C.primary,
    fontWeight: 600,
    transition: "all 0.15s"
  },
  modalCancel: {
    flex: 1,
    padding: "9px 0",
    fontSize: F.md,
    cursor: "pointer",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.borderLight,
    color: C.textSub
  }
})