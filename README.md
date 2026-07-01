# CFire Chat Keeper

<div align="center">

**守护创作者与 AI 交流的回忆和数据 🐾**

[English](./README_EN.md) | 中文

</div>

---

## 📖 简介

CFire Chat Keeper 是一款 Chrome 扩展程序，帮助你批量提取并保存与 DeepSeek、ChatGPT、豆包等 AI 助手的对话记录。无论是灵感迸发的创意对话，还是精心调教的 Prompt 工程，都能一键保存到本地，永久守护。

## ✨ 核心功能

### 🌐 多平台支持

支持主流 AI 对话平台的对话提取：

| 平台 | 支持状态 | 演示 |
|------|---------|------|
| DeepSeek | ✅ 完整支持 | ![DeepSeek 演示](./demo/deepseek-demo.jpg) |
| ChatGPT | ✅ 完整支持 | ![ChatGPT 演示](./demo/chatgpt-demo.jpg) |
| 豆包 | ✅ 完整支持 | ![豆包 演示](./demo/doubao-demo.jpg) |

### 📥 批量导出

- **Markdown 格式**：适合阅读和二次编辑
- **JSON 格式**：适合程序化处理和数据备份
- **批量下载**：一键导出所有对话，支持自定义保存路径

### 🖼️ 图片提取

自动识别对话中的图片内容，支持选择性下载：

![豆包图片选择](./demo/doubao-image-select.png)

- 展开对话即可查看所有图片
- 勾选需要保存的图片
- 图片保存在对话文件夹下的 `images` 子目录

### 🔍 智能筛选

- 实时搜索对话标题和内容
- 快速定位历史对话
- 支持关键词过滤

### 📁 灵活存储

- 自定义保存路径（相对于 Downloads 目录）
- 历史记录功能，快速切换常用目录
- 自动创建文件夹结构

### 🔄 完整历史获取

针对豆包等平台的长对话，提供"滚动获取"功能：

- 自动滚动页面加载完整历史
- 确保不遗漏任何对话内容
- 实时显示获取进度

## 🚀 安装方法

### 方法一：从 Release 安装（推荐）

1. 从 [Releases](./release/) 下载最新版本的 `CFire-Chat-Keeper-v0.2.0-chrome.zip`
2. 解压到任意目录
3. 打开 Chrome 浏览器，访问 `chrome://extensions/`
4. 开启右上角的"开发者模式"
5. 点击"加载已解压的扩展程序"
6. 选择解压后的文件夹

### 方法二：从源码构建

```bash
# 克隆项目
git clone <repository-url>
cd ai-chat-keeper

# 安装依赖
npm install

# 开发模式
npm run dev

# 生产构建
npm run build
```

构建完成后，在 `build/chrome-mv3-prod` 目录加载扩展。

## 📖 使用指南

### 基本使用

1. **安装扩展**：按照上述方法安装 CFire Chat Keeper
2. **打开对话页面**：访问 DeepSeek、ChatGPT 或豆包的对话页面
3. **自动采集**：扩展会自动捕获对话内容
4. **查看对话**：点击扩展图标，查看所有已采集的对话
5. **导出对话**：点击 MD 或 JSON 按钮导出单个对话

### 批量导出

1. 在扩展弹窗中点击"批量下载"按钮
2. 选择导出格式（Markdown 或 JSON）
3. 等待下载完成，进度条实时显示

### 自定义保存路径

1. 在"文件夹名称"输入框中输入路径（如 `ai-chats/2026`）
2. 路径相对于 Downloads 目录
3. 常用路径会自动记录，可通过快捷按钮快速切换

### 豆包长对话处理

对于豆包平台的长对话：

1. 打开豆包对话页面
2. 点击扩展中的"完整获取"按钮
3. 扩展会自动滚动页面加载完整历史
4. 滚动完成后刷新对话列表

## 🎨 界面预览

### 主界面

- **品牌标识**：CFire Chat Keeper Logo 和标语
- **刷新按钮**：手动刷新对话列表
- **保存路径**：自定义导出目录
- **搜索框**：实时筛选对话
- **对话列表**：显示所有已采集的对话
- **批量下载**：一键导出所有对话

### 对话项

每个对话项显示：

- 🏷️ 平台标识（DeepSeek / ChatGPT / 豆包）
- 📝 对话标题
- 📊 消息数量
- 🕒 更新时间
- 🖼️ 图片数量（如有）
- 📥 导出按钮（MD / JSON）
- 🗑️ 删除按钮

## 🔧 技术栈

- **框架**：Plasmo (Chrome Extension Framework)
- **语言**：TypeScript
- **UI**：React 18
- **构建工具**：Plasmo Build System
- **Manifest**：Chrome Extension Manifest V3

## 📂 项目结构

```
ai-chat-keeper/
├── src/
│   ├── popup.tsx           # 弹窗主界面
│   ├── background.ts       # 后台服务
│   ├── contents/           # 内容脚本
│   │   ├── collector.ts    # 对话采集器
│   │   └── main-world-hook.ts
│   └── lib/
│       ├── types.ts        # 类型定义
│       ├── parsers.ts      # 各平台解析器
│       ├── export.ts       # 导出逻辑
│       ├── batch.ts        # 批量下载
│       ├── images.ts       # 图片处理
│       ├── i18n.ts         # 国际化
│       ├── site-config.ts  # 站点配置
│       └── ...
├── build/
│   ├── chrome-mv3-dev/     # 开发构建
│   └── chrome-mv3-prod/    # 生产构建
├── release/                # 发布包
└── demo/                   # 演示图片
```

## 🌍 国际化支持

自动检测浏览器语言：

- 中文（简体/繁体）：显示中文界面
- 其他语言：显示英文界面

## 🐛 问题反馈

如果遇到问题或有功能建议：

1. **刷新扩展**：点击右上角 ↻ 按钮
2. **刷新页面**：重新加载对话页面
3. **邮件反馈**：dev@tokenspark.uno

## 📝 更新日志

### v0.2.0

- ✅ 支持 DeepSeek、ChatGPT、豆包三大平台
- ✅ 批量导出功能
- ✅ 图片识别与选择性下载
- ✅ 自定义保存路径
- ✅ 实时搜索筛选
- ✅ 豆包长对话完整获取
- ✅ 中英文双语支持

## 📄 许可证

本项目仅供学习和个人使用。

## 🙏 致谢

感谢所有 AI 平台提供的优秀服务，让创作者能够与 AI 进行精彩的对话。

---

<div align="center">

**CFire Chat Keeper - 陪你守护每一次 AI 对话** 🐾

[加入用户交流群](./demo/lark-user-group.png)

</div>
