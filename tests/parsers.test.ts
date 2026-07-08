// 离线测试：用真实/合成 payload 跑 parsers
// 运行：npx tsx tests/parsers.test.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { parseEvent, buildFromDom } from "../src/lib/parsers"
import { isDoubaoGeneratedImage, filterDoubaoGeneratedImages, stripDoubaoNonGenImageMarkdown } from "../src/lib/images"
import type { IngestEvent } from "../src/lib/types"

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++
    console.log("  PASS", name)
  } else {
    fail++
    console.log("  FAIL", name, extra ?? "")
  }
}

// --- ChatGPT: mapping JSON ---
{
  const body = JSON.stringify({
    title: "Demo CGPT",
    mapping: {
      n1: {
        message: {
          id: "m1",
          author: { role: "user" },
          content: { parts: ["你好"] },
          create_time: 1700000000
        }
      },
      n2: {
        message: {
          id: "m2",
          author: { role: "assistant" },
          content: { parts: ["你好，我是 ChatGPT"] },
          create_time: 1700000001
        }
      }
    }
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "chatgpt",
    url: "https://chatgpt.com/backend-api/conversation/abc-123",
    status: 200,
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[ChatGPT mapping]")
  assert("解析成功", !!r)
  assert("conversationId=abc-123", r?.conversation.conversationId === "abc-123")
  assert("title=Demo CGPT", r?.conversation.title === "Demo CGPT")
  assert("2 条消息", r?.messages.length === 2)
  assert("user/assistant", r?.messages[0].role === "user" && r?.messages[1].role === "assistant")
  assert("replace=true（完整快照）", r?.replace === true)
}

{
  const body = JSON.stringify({
    title: "Shared CGPT",
    current_node: "n4",
    mapping: {
      n4: {
        parent: "n3",
        message: {
          id: "m3",
          author: { role: "assistant" },
          content: { parts: ["第三条"] },
          create_time: 1700000003
        }
      },
      n1: {
        parent: "root",
        message: {
          id: "hidden-system",
          author: { role: "system" },
          content: { parts: [""] },
          metadata: { is_visually_hidden_from_conversation: true }
        }
      },
      n3: {
        parent: "n2",
        message: {
          id: "m2",
          author: { role: "user" },
          content: { parts: ["第二条"] },
          create_time: 1700000002
        }
      },
      root: { children: ["n1"] },
      n2: {
        parent: "n1",
        message: {
          id: "m1",
          author: { role: "assistant" },
          content: { parts: ["第一条"] },
          create_time: 1700000001
        }
      }
    }
  })
  const ev: IngestEvent = {
    source: "dom",
    site: "chatgpt",
    url: "https://chatgpt.com/share/share-123",
    status: 200,
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[ChatGPT share mapping]")
  assert("按 current_node 链路排序", r?.messages.map((m) => m.content).join(",") === "第一条,第二条,第三条")
  assert("过滤隐藏 system", r?.messages.every((m) => m.role !== "system") === true)
  assert("turnId 不重复", new Set(r?.messages.map((m) => m.turnId)).size === r?.messages.length)
}

// --- ChatGPT: SSE 流（增量） ---
{
  const sse = [
    `data: ${JSON.stringify({ v: "Hello" })}`,
    `data: ${JSON.stringify({ v: " world" })}`,
    `data: ${JSON.stringify({ message: { id: "msg-x" } })}`,
    `data: [DONE]`
  ].join("\n\n")
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "chatgpt",
    url: "https://chatgpt.com/backend-api/conversation",
    body: sse,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[ChatGPT SSE]")
  assert("解析出 1 条", r?.messages.length === 1)
  assert("内容=Hello world", r?.messages[0].content === "Hello world")
  assert("turnId=msg-x", r?.messages[0].turnId === "msg-x")
  assert("replace=false（流式增量）", r?.replace !== true)
}

// --- DeepSeek: 真实分享接口（含 fragments） ---
{
  const sharePath = path.join(
    __dirname,
    "_api-https___chat_deepseek_com_api_v0_share_content_share_id_pekx.json"
  )
  if (fs.existsSync(sharePath)) {
    const body = fs.readFileSync(sharePath, "utf8")
    const ev: IngestEvent = {
      source: "fetch-hook",
      site: "deepseek",
      url: "https://chat.deepseek.com/api/v0/share/content?share_id=pekxlh4u5sph5ihc7h",
      body,
      capturedAt: Date.now()
    }
    const r = parseEvent(ev)
    console.log("[DeepSeek 真实分享 API]")
    assert("解析成功", !!r)
    assert("convId=pekxlh4u5sph5ihc7h", r?.conversation.conversationId === "pekxlh4u5sph5ihc7h")
    assert("6 条消息（实测）", r?.messages.length === 6)
    assert("user/assistant 交替", r?.messages
      ?.map((m) => m.role)
      .join(",") === "user,assistant,user,assistant,user,assistant")
    assert("含用户首问", (r?.messages[0].content ?? "").includes("张一鸣"))
    assert("含助手长文", (r?.messages[1].content ?? "").length > 1000)
    assert("turnId 稳定（不依赖文本 hash）",
      r?.messages.every((m) => /^\d+$/.test(m.turnId)) === true)
    assert("replace=true", r?.replace === true)
    assert("title=Shared Conversation",
      r?.conversation.title === "Shared Conversation")

    // 流式抖动测试：模拟同一接口被多次回放，messages 数量应稳定（turnId 一致 → upsert 同 row）
    const r2 = parseEvent(ev)!
    const r3 = parseEvent(ev)!
    const ids = new Set([
      ...r2.messages.map((m) => m.turnId),
      ...r3.messages.map((m) => m.turnId)
    ])
    assert("重放多次 turnId 不增加",
      ids.size === r2.messages.length)
  } else {
    console.log("[DeepSeek 真实分享 API] (skip：固件不存在)")
  }
}

// --- DeepSeek: 旧 chat_messages ---
{
  const body = JSON.stringify({
    data: {
      biz_data: {
        chat_messages: [
          { message_id: 1, role: "user", content: "讲个笑话", inserted_at: 1700000000 },
          { message_id: 2, role: "assistant", content: "好的……", inserted_at: 1700000001 }
        ]
      }
    }
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "deepseek",
    url: "https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=sess-1",
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[DeepSeek legacy chat_messages]")
  assert("2 条消息", r?.messages.length === 2)
  assert("convId=sess-1", r?.conversation.conversationId === "sess-1")
  assert("replace=true", r?.replace === true)
}

// --- DeepSeek: TIP fragment 应被丢弃 ---
{
  const body = JSON.stringify({
    data: {
      biz_data: {
        title: "X",
        messages: [
          {
            message_id: 1,
            role: "USER",
            inserted_at: 1700000000,
            fragments: [{ id: 1, type: "REQUEST", content: "问" }]
          },
          {
            message_id: 2,
            role: "ASSISTANT",
            inserted_at: 1700000001,
            fragments: [
              { id: 2, type: "RESPONSE", content: "答" },
              { id: 3, type: "TIP", content: "This response is AI-generated" }
            ]
          }
        ]
      }
    }
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "deepseek",
    url: "https://chat.deepseek.com/api/v0/share/content?share_id=tip-test",
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[DeepSeek TIP 过滤]")
  assert("助手内容只含 RESPONSE，不含 TIP",
    r?.messages[1].content === "答")
}

// --- 豆包: 真实 /im/chain/single 响应 ---
{
  const fixturePath = path.join(
    __dirname,
    "_api-doubao-im-chain-single.json"
  )
  if (fs.existsSync(fixturePath)) {
    const body = fs.readFileSync(fixturePath, "utf8")
    const ev: IngestEvent = {
      source: "fetch-hook",
      site: "doubao",
      url: "https://www.doubao.com/im/chain/single?version_code=20800&device_id=7657219659410097704",
      body,
      capturedAt: Date.now()
    }
    const r = parseEvent(ev)
    console.log("[豆包 /im/chain/single]")
    assert("解析成功", !!r)
    assert("convId=38429368140957954", r?.conversation.conversationId === "38429368140957954")
    assert("4 条消息", r?.messages.length === 4)
    assert("user/assistant 交替",
      r?.messages.map((m) => m.role).join(",") === "user,assistant,user,assistant")
    // 第 1 条 user：顶层 text_block
    assert("user 正文", (r?.messages[0].content ?? "").includes("字节跳动的创始人"))
    // 第 2 条 assistant：只取顶层 text_block，丢弃思考子块
    assert("assistant 正文含正式回答", (r?.messages[1].content ?? "").includes("你好，我是张一鸣"))
    assert("assistant 丢弃思考子块", !(r?.messages[1].content ?? "").includes("思考过程"))
    assert("assistant 丢弃链接块", !(r?.messages[1].content ?? "").includes("已阅读内容"))
    assert("turnId=稳定 message_id",
      r?.messages.every((m) => /^\d+$/.test(m.turnId)) === true)
    assert("replace 未设（增量合并，非完整快照）", r?.replace !== true)
  } else {
    console.log("[豆包 /im/chain/single] (skip：固件不存在)")
  }
}

// --- 豆包: 分页响应增量合并（长对话滚动加载场景）---
// 模拟两次 /im/chain/single 响应：第二批与第一批有重叠 message_id，
// 验证 replace 为 falsy（让 DB put 天然 upsert 去重，而非 clearMessages 互覆盖）
{
  function makeDoubaoBody(msgs: Array<{ id: string; ut: number; text: string; idx: string }>) {
    return JSON.stringify({
      downlink_body: {
        pull_singe_chain_downlink_body: {
          messages: msgs.map((m) => ({
            conversation_id: "38427006775604738",
            message_id: m.id,
            user_type: m.ut,
            create_time: "1781420000",
            index_in_conv: m.idx,
            content_block: [
              {
                block_type: 10000,
                block_id: `b-${m.id}`,
                parent_id: "",
                content: { text_block: { text: m.text } },
                is_finish: true
              }
            ]
          }))
        }
      },
      status_code: 0
    })
  }
  // 第一批：index 97-100（最新 4 条）
  const ev1: IngestEvent = {
    source: "fetch-hook",
    site: "doubao",
    url: "https://www.doubao.com/im/chain/single?version_code=20800",
    body: makeDoubaoBody([
      { id: "97", ut: 1, text: "Q97", idx: "97" },
      { id: "98", ut: 2, text: "A98", idx: "98" },
      { id: "99", ut: 1, text: "Q99", idx: "99" },
      { id: "100", ut: 2, text: "A100", idx: "100" }
    ]),
    capturedAt: Date.now()
  }
  // 第二批：index 93-98（滚动后加载更早 6 条，98/97 与第一批重叠）
  const ev2: IngestEvent = {
    source: "fetch-hook",
    site: "doubao",
    url: "https://www.doubao.com/im/chain/single?version_code=20800",
    body: makeDoubaoBody([
      { id: "93", ut: 1, text: "Q93", idx: "93" },
      { id: "94", ut: 2, text: "A94", idx: "94" },
      { id: "95", ut: 1, text: "Q95", idx: "95" },
      { id: "96", ut: 2, text: "A96", idx: "96" },
      { id: "97", ut: 1, text: "Q97", idx: "97" },
      { id: "98", ut: 2, text: "A98", idx: "98" }
    ]),
    capturedAt: Date.now()
  }
  const r1 = parseEvent(ev1)!
  const r2 = parseEvent(ev2)!
  console.log("[豆包 分页增量合并]")
  assert("第一批 4 条", r1.messages.length === 4)
  assert("第二批 6 条", r2.messages.length === 6)
  assert("第一批 replace falsy", r1.replace !== true)
  assert("第二批 replace falsy", r2.replace !== true)
  // 重叠 message_id（97/98）在两批中都出现 → DB put() 会 upsert 同 row，不重复
  const ids1 = new Set(r1.messages.map((m) => m.turnId))
  const ids2 = new Set(r2.messages.map((m) => m.turnId))
  const overlap = [...ids1].filter((id) => ids2.has(id))
  assert("两批有重叠 message_id", overlap.length === 2)
  // 合并后唯一 message_id 总数 = 4 + 6 - 2 = 8
  const unique = new Set([...ids1, ...ids2])
  assert("合并去重后 8 条唯一消息", unique.size === 8)
}

// --- DOM 兜底：稳定 turnId / replace ---
{
  const r = buildFromDom(
    "deepseek",
    "share-x",
    "https://chat.deepseek.com/share/share-x",
    [
      { role: "user", text: "提问" },
      { role: "assistant", text: "回答" }
    ]
  )
  console.log("[DOM 兜底]")
  assert("2 条", r?.messages.length === 2)
  assert("turnId 稳定 dom-0/dom-1",
    r?.messages.map((m) => m.turnId).join(",") === "dom-0,dom-1")
  assert("replace=true", r?.replace === true)
  assert("isShare=true", r?.conversation.isShare === true)
}

// --- 豆包: AI 生成图片块提取 ---
// 模拟助手消息含 image_block（block_type 不固定）+ text_block 的场景
// 验证：1) 图片 URL 被提取到 images 字段；2) 图片 markdown 出现在 content；
//       3) 只有图片块无文本块的消息不被跳过；4) link_reader_block 的 url 不被误收
{
  const body = JSON.stringify({
    downlink_body: {
      pull_singe_chain_downlink_body: {
        messages: [
          {
            conversation_id: "38427006775604738",
            message_id: "msg-img-1",
            user_type: 1,
            create_time: "1781420300",
            content_block: [
              {
                block_type: 10000,
                block_id: "q1",
                parent_id: "",
                content: { text_block: { text: "帮我画一只猫" } }
              }
            ]
          },
          {
            conversation_id: "38427006775604738",
            message_id: "msg-img-2",
            user_type: 2,
            create_time: "1781420310",
            content_block: [
              {
                block_type: 10040,
                block_id: "think-img",
                parent_id: "",
                content: { thinking_block: { finish_title: "生成猫咪图片" } }
              },
              {
                block_type: 10000,
                block_id: "answer-img",
                parent_id: "",
                content: { text_block: { text: "好的，这是为你生成的猫咪图片：" } }
              },
              {
                // image_block：block_type 未知，字段名模拟豆包常见结构
                block_type: 10050,
                block_id: "img-1",
                parent_id: "",
                content: {
                  image_block: {
                    image_url: {
                      url: "https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/fc1c8f5fc6134e4a8bdfa0295a0b4620.png"
                    },
                    prompt: "一只可爱的橘猫"
                  }
                }
              },
              {
                // gallery_block：多图组
                block_type: 10051,
                block_id: "img-gallery",
                parent_id: "",
                content: {
                  gallery_block: {
                    images: [
                      { image_url: { url: "https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.jpg" } },
                      { image_url: { url: "https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7.webp" } }
                    ]
                  }
                }
              },
              {
                // link_reader_block：其 url 不应被误收为图片
                block_type: 10006,
                block_id: "link-img",
                parent_id: "",
                content: {
                  link_reader_block: {
                    summary: "已阅读内容: https://example.com/article",
                    url: "https://example.com/article"
                  }
                }
              }
            ]
          },
          {
            // 只有图片块、无文本块的消息：不应被跳过
            conversation_id: "38427006775604738",
            message_id: "msg-img-3",
            user_type: 2,
            create_time: "1781420320",
            content_block: [
              {
                block_type: 10050,
                block_id: "img-only",
                parent_id: "",
                content: {
                  image_block: {
                    image_url: "https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8.png"
                  }
                }
              }
            ]
          }
        ]
      }
    },
    status_code: 0
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "doubao",
    url: "https://www.doubao.com/im/chain/single?version_code=20800",
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[豆包 AI 生成图片块提取]")
  assert("解析成功", !!r)
  assert("3 条消息（含只有图片的消息）", r?.messages.length === 3)
  // 第 2 条助手消息：文本 + 3 张图片
  const assistantMsg = r?.messages[1]
  assert("助手正文保留", (assistantMsg?.content ?? "").includes("这是为你生成的猫咪图片"))
  assert("助手提取 3 张图片",
    (assistantMsg?.images?.length ?? 0) === 3)
  assert("图片 URL 含 cat-001",
    assistantMsg?.images?.some((i) => i.url.includes("fc1c8f5f")) === true)
  assert("图片 URL 含 cat-002",
    assistantMsg?.images?.some((i) => i.url.includes("a1b2c3d4")) === true)
  assert("图片 URL 含 cat-003",
    assistantMsg?.images?.some((i) => i.url.includes("b2c3d4e5")) === true)
  assert("content 含图片 markdown",
    (assistantMsg?.content ?? "").includes("![image](https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/fc1c8f5fc6134e4a8bdfa0295a0b4620.png)"))
  assert("link_reader url 不被误收为图片",
    assistantMsg?.images?.every((i) => !i.url.includes("example.com/article")) === true)
  // 第 3 条只有图片的消息：不被跳过
  const imgOnlyMsg = r?.messages[2]
  assert("只有图片的消息不被跳过", !!imgOnlyMsg)
  assert("只有图片的消息含 1 张图",
    (imgOnlyMsg?.images?.length ?? 0) === 1)
  assert("只有图片的消息 content 为图片 markdown",
    (imgOnlyMsg?.content ?? "").includes("![image](https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8.png)"))
}

// --- 豆包: 生成图片过滤函数 ---
{
  const gen1 = "https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/fc1c8f5fc6134e4a8bdfa0295a0b4620.png"
  const gen2 = "https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.jpg"
  const tool1 = "https://lf3-static.bytednsdoc.com/obj/static/image/Deep_Think.png"
  const tool2 = "https://lf3-static.bytednsdoc.com/obj/static/image/Search.png"
  const fallback = "https://www.doubao.com/static/doc-canvas-card-fallback-light.png"

  console.log("[豆包图片过滤]")
  assert("生成图 URL 命中", isDoubaoGeneratedImage(gen1) === true)
  assert("生成图 URL 命中 2", isDoubaoGeneratedImage(gen2) === true)
  assert("工具图标 URL 不命中", isDoubaoGeneratedImage(tool1) === false)
  assert("Search 图标 URL 不命中", isDoubaoGeneratedImage(tool2) === false)
  assert("兜底图 URL 不命中", isDoubaoGeneratedImage(fallback) === false)

  const filtered = filterDoubaoGeneratedImages([
    { url: gen1 }, { url: tool1 }, { url: gen2 }, { url: tool2 }, { url: fallback }
  ])
  assert("过滤后仅保留 2 张生成图", filtered.length === 2)
  assert("保留 gen1", filtered[0].url === gen1)
  assert("保留 gen2", filtered[1].url === gen2)

  const text = `这是正文。\n\n![Deep_Think](${tool1})\n\n这是生成图：\n\n![image](${gen1})\n\n继续。`
  const stripped = stripDoubaoNonGenImageMarkdown(text)
  assert("剥离后保留生成图 markdown", stripped.includes(`![image](${gen1})`))
  assert("剥离后不含工具图标 markdown", !stripped.includes(tool1))
  assert("剥离后保留正文", stripped.includes("这是正文"))
  assert("剥离后保留生成图上下文", stripped.includes("这是生成图"))
}

// --- ChatGPT: image_asset_pointer 无 image_url.url，仅 file_id ---
// 模拟 DALL·E 生成图：parts 中 image_asset_pointer 只有 file_id 和 asset_pointer
{
  const body = JSON.stringify({
    title: "Image Test",
    mapping: {
      n1: {
        message: {
          id: "m1",
          author: { role: "user" },
          content: { parts: ["画一只猫"] },
          create_time: 1700000000
        }
      },
      n2: {
        message: {
          id: "m2",
          author: { role: "assistant" },
          content: {
            content_type: "multimodal_text",
            parts: [
              "好的，这是为你画的猫：",
              {
                content_type: "image_asset_pointer",
                image_asset: { file_id: "file-abc123", mime_type: "image/png" },
                asset_pointer: "file-service://file-abc123"
              }
            ]
          },
          create_time: 1700000001
        }
      }
    }
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "chatgpt",
    url: "https://chatgpt.com/backend-api/conversation/img-test",
    status: 200,
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[ChatGPT file_id 回退]")
  assert("解析成功", !!r)
  assert("2 条消息", r?.messages.length === 2)
  const assistantMsg = r?.messages[1]
  assert("助手消息含图片", (assistantMsg?.images?.length ?? 0) === 1)
  assert("图片 URL 为 download 接口",
    assistantMsg?.images?.[0].url === "https://chatgpt.com/backend-api/files/file-abc123/download")
  assert("content 含图片 markdown",
    (assistantMsg?.content ?? "").includes("![file-abc123](https://chatgpt.com/backend-api/files/file-abc123/download)"))
}

// --- ChatGPT: attachments 图片附件 ---
{
  const body = JSON.stringify({
    mapping: {
      n1: {
        message: {
          id: "m1",
          author: { role: "user" },
          content: { parts: ["这张图是什么？"] },
          attachments: [
            { id: "file-img-upload", mimeType: "image/jpeg", name: "photo.jpg", size: 12345 }
          ],
          create_time: 1700000000
        }
      }
    }
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "chatgpt",
    url: "https://chatgpt.com/backend-api/conversation/att-test",
    status: 200,
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[ChatGPT attachments 图片]")
  assert("解析成功", !!r)
  const userMsg = r?.messages[0]
  assert("用户消息含附件图片", (userMsg?.images?.length ?? 0) === 1)
  assert("附件图片 URL 为 download 接口",
    userMsg?.images?.[0].url === "https://chatgpt.com/backend-api/files/file-img-upload/download")
}

// --- 豆包: 同一图片的 URL 变体按 hex 去重 ---
// 同一张生成图在 image_block 中有 thumb_url / origin_url / download_url 三个变体
{
  const hex = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
  const thumbUrl = `https://p9-flow-imagex-sign.byteimg.com/o/thumbnail/rc_gen_image/${hex}.png`
  const originUrl = `https://p9-flow-imagex-sign.byteimg.com/o/origin/rc_gen_image/${hex}.png`
  const downloadUrl = `https://p9-flow-imagex-sign.byteimg.com/o/download/rc_gen_image/${hex}.png`
  const body = JSON.stringify({
    downlink_body: {
      pull_singe_chain_downlink_body: {
        messages: [
          {
            conversation_id: "dedup-test",
            message_id: "msg-dedup",
            user_type: 2,
            create_time: "1781420400",
            content_block: [
              {
                block_type: 10050,
                block_id: "img-dedup",
                parent_id: "",
                content: {
                  image_block: {
                    image_url: { url: originUrl },
                    thumb_url: { url: thumbUrl },
                    download_url: { url: downloadUrl }
                  }
                }
              }
            ]
          }
        ]
      }
    }
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "doubao",
    url: "https://www.doubao.com/im/chain/single?version_code=20800",
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[豆包 URL 变体去重]")
  assert("解析成功", !!r)
  const msg = r?.messages[0]
  assert("3 个 URL 变体仅保留 1 张图", (msg?.images?.length ?? 0) === 1)
  assert("保留首次出现的 URL", msg?.images?.[0].url === originUrl)
  assert("content 中图片 markdown 仅出现 1 次",
    (msg?.content ?? "").split("rc_gen_image").length === 2)
}

// --- 豆包: 文本含生成图 markdown + block 含同图 → 不重复 ---
{
  const hex = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7"
  const imgUrl = `https://p9-flow-imagex-sign.byteimg.com/rc_gen_image/${hex}.jpg`
  const body = JSON.stringify({
    downlink_body: {
      pull_singe_chain_downlink_body: {
        messages: [
          {
            conversation_id: "text-dedup-test",
            message_id: "msg-text-dedup",
            user_type: 2,
            create_time: "1781420500",
            content_block: [
              {
                block_type: 10000,
                block_id: "answer-dedup",
                parent_id: "",
                content: {
                  text_block: {
                    text: `这是生成的图片：\n\n![image](${imgUrl})`
                  }
                }
              },
              {
                block_type: 10050,
                block_id: "img-block-dedup",
                parent_id: "",
                content: {
                  image_block: { image_url: { url: imgUrl } }
                }
              }
            ]
          }
        ]
      }
    }
  })
  const ev: IngestEvent = {
    source: "fetch-hook",
    site: "doubao",
    url: "https://www.doubao.com/im/chain/single?version_code=20800",
    body,
    capturedAt: Date.now()
  }
  const r = parseEvent(ev)
  console.log("[豆包 文本+块图片去重]")
  assert("解析成功", !!r)
  const msg = r?.messages[0]
  assert("文本和块同一图片仅保留 1 张", (msg?.images?.length ?? 0) === 1)
  assert("content 中图片 markdown 仅出现 1 次",
    (msg?.content ?? "").split("rc_gen_image").length === 2)
  assert("content 保留正文文本", (msg?.content ?? "").includes("这是生成的图片"))
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`)
if (fail > 0) process.exit(1)
