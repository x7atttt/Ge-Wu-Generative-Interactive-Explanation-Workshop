# 迭代24：图片识别接入——追问带图与拍题生成（多模态）

> 状态：done
> 创建：2026-10-17
> 关联：2026-09-28-iteration7-deepen-chain.md（追问管线）；评估结论（本对话）：MinerU 已是 vlm 解析、图内文字已进 md，"文档图片进讲解"缓做

## 背景

备考高频场景"拍错题问为什么 / 拍题直接生成讲解"当前无法表达——LLM 客户端 `ChatMessage.content` 只支持字符串。前置 smoke 已验证：配置的模型（glm-5.3-flash）接受 OpenAI 兼容 content 数组（text + image_url data URL）且能正确识图；`response_format: json_object` 与图片输入共存（生成路径依赖成立）。根因：协议层与三条链路（客户端压缩/上传、ask 与 generate 路由、消息拼装）均无图片通路。

## ★ User Stories

- 作为备考用户，我想在追问时附 1~2 张图（错题照片/截图），以便"这题为什么选 B"式提问。
- 作为备考用户，我想粘贴或拖入图片到追问框，以便截图工作流不中断。
- 作为备考用户，我想在生成入口附 1~3 张图并留空概念，以便拍题直接生成讲解（错题直拍→讲解→制卡→FSRS 闭环）。
- 作为系统，我要图片体积与数量受控（前端压缩 + 服务端上限），以便视觉 token 与请求体成本可控。
- 作为系统，图片只在当次 LLM 调用中消费，不落库不落盘（讲解产物是文本 DSL）。

## 目标 / 非目标

**目标**：LLM 客户端多模态类型、前端压缩工具、追问带图（含粘贴）、生成带图（概念可空+图）、对应提示词与校验。

**非目标**：图片持久化/回显历史原图（asks 存 `[图片]` 占位）；MinerU 文档图片进讲解（缓做，先实验 vlm 转写是否已够）；图片结果产物（讲解仍是文本 DSL，不含图）。

## ★ 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 协议 | `content: string \| ContentPart[]`（text / image_url data URL），OpenAI 兼容 | smoke 实测通过；请求体 JSON.stringify 天然兼容 |
| 传输形态 | data URL 端到端（不落盘/对象存储） | 图片是单次消费的上下文，持久化无消费方 |
| 前端压缩 | canvas 长边 ≤1280、jpeg 0.82（PNG 透明图兜底保 PNG） | 单图 200KB 级，视觉 token 与载荷可控 |
| 数量/大小上限 | 追问 ≤2 张、生成 ≤3 张；单条 data URL ≤2.5MB（服务端拒绝） | 成本护栏；前端压缩后远低于上限 |
| 图片位置 | 拼在**最后一条 user 消息**的 parts 尾部（text 在前） | 与既有 sections 拼装兼容；追问历史轮不重发图（省钱，当前轮够用） |
| 概念可空 | 有图且无概念时放行（handleGenerate 与 route 同步放宽） | 拍题生成的核心入口 |
| asks 入库 | user 侧 content 存 `问题文本\n[图片]` | 历史上下文与回显可见性，不存 base64 |
| 提示词 | generate/ask 各加一句"用户可能附图片（拍的题目/教材/截图），围绕图片内容展开" | 不改变既有 DSL 契约与语气设定 |

### 外部依赖

glm-5.3-flash 多模态与 jsonMode+图共存——scripts/vision-smoke.mjs 实测 PASS（①识色"深红色"；②`{"color":"红色"}`）。注意推理型输出：max_tokens 过小（100）会被思考耗尽致 content 空，冒烟脚本已放宽。

## 边界 case

- (story 3) 只附图不填概念、无附加资料 → 放行；概念名由模型从图定（originConcept 落库为 null，地图按空概念不对齐——可接受，讲解在历史可寻）。
- 非图片文件/坏 data URL → 前端 accept=image/* + 服务端 `^data:image/(jpeg|png|webp|gif);base64,` 校验 400。
- 压缩失败（坏文件解码失败）→ 前端报错不入队。
- 追问与生成共用压缩：超限张数时前端提示并忽略。
- (story 5) 生成中（busy）图片入口禁用，与既有 busy 门一致。

## ★ 验证 seam

- **测试 seam**：HTTP（带图 ask/generate 直打）+ 浏览器实测（DataTransfer 注入文件绕过 IAB 文件选择器限制）+ `tsc`。
- **复用入口**：dev server + 既有 SSE 消费。
- **新建入口**：无。

## 验证方案

- [x] ask 不带图回归（文本追问正常流式）
- [x] ask 带 1 张红/蓝双色图（curl 与浏览器 UI 双路径）→ 回答"上半部分是红色，下半部分是蓝色"；asks 入库含 `[图片]` 占位
- [x] generate 纯图（概念空/无资料/检索关，curl 直打）→ 生成《从一面红白蓝旗帜说起：法国三色旗》（模型识别出三色竖条）；结构校验通过 done
- [x] 超限（ask 3 张 / generate 4 张 / bmp 坏格式 / 概念空且无图无资料）→ 400 ×4
- [x] 前端：📷 选图出缩略图可删；提问气泡带 📷×n 徽标；生成按钮"仅图无概念"可点；UI 请求体实含 images（fetch 拦截确认）
- [x] `pnpm exec tsc --noEmit` 通过

## ★ 实测结果

### 改动清单

- `lib/llm/client.ts`：ChatContentPart 类型 + ChatMessage.content 放开为数组 + withImages 构造助手
- `lib/imageCompress.ts`（新，客户端）：canvas 长边 ≤1280、jpeg 0.82（PNG 透明保 PNG），解码失败友好报错
- `lib/dsl/generate.ts`：GenerateExtras.images；generateDoc 用户消息 parts 化；askQuestion 增 images 参数（仅当前轮发送）
- `app/api/ask/route.ts`：images 校验（≤2、data:image/(jpeg|png|webp|gif) ≤2.5MB）；入库 `[图片]` 占位
- `app/api/generate/route.ts`：images 校验（≤3）；概念空+图放行（默认"图片讲解"并跳过网络检索）；info 提示
- `lib/api/explanation.ts`：streamAsk 透传 images
- `components/dsl/AskPanel.tsx`：📷 按钮/缩略图/粘贴截图/移除；气泡 📷×n 徽标；仅图可发（默认"（看图回答）"）
- `app/page.tsx`：生成入口 📷（≤3 张缩略图可删）；handleGenerate 概念空+图放行；runGenerate images 参数（仅生成入口带，地图点击/补练不带）
- `scripts/vision-smoke.mjs`（新）：纯 node PNG 编码 + 直连 LLM 的能力冒烟

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| scripts/vision-smoke.mjs | ① 识色"深红色" ② jsonMode+图 `{"color":"红色"}` 双 PASS |
| ask 带图（curl PNG / 页面 fetch jpeg / 浏览器 UI 完整流程） | 三路径全部正确识别红/蓝 |
| asks 入库占位 | user 行含 `[图片]`，assistant 全文 |
| generate 纯图 | 标题《从一面红白蓝旗帜说起：法国三色旗》，颜色词命中 168 次 |
| UI 请求体（fetch 拦截） | `images: 2, concept: "", webSearch: false` 实证 |
| 护栏 400 ×4 | ask>2 张/坏格式、generate>3 张、概念空无图无资料 |
| tsc | 通过 |

### 实施中发现的问题

- **推理型模型 max_tokens 陷阱**：smoke 首跑 200 但 content 为空——100 token 上限被思考链耗尽，放宽后正常（后续真实链路无此问题，未设小上限）。
- **64×64 纯色小图的偶发"看不到"**：极小且无结构的图在视觉判断边界上抖动（同图后测即通过）；真实照片/截图不会如此退化。前端压缩 1280 上限进一步规避。
- **单条 info 提示互相覆盖**：图片与资料的 info 共用 searchNote 单槽，后者覆盖前者——纯展示问题，未修（生成结果不受影响）。
- **资料与图同挂时的主题竞争**：16k 字资料会压过与主题无关的附图（模型合理取舍）；纯拍题路径（无资料）已单独验证成立。
- 混淆测试产生的两篇重复 OS 讲解（doc 53/54）已清理；三色旗演示文档（doc 55）保留供验收。

## 不在本次范围（Out of Scope）

- 图片持久化、历史原图回显、讲解产物含图
- MinerU 文档图片进讲解（待"vlm 转写是否已够"实验）
- 图片裁剪/标注
