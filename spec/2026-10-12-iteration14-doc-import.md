# 批量文档导入：txt/md 直读 + PDF/Word 走 MinerU，统一 Markdown 资料库

> 状态：done（PDF/Word 真实解析路径待用户配置 token 后人工验收）
> 创建：2026-10-12
> 关联：../reference.md 三节（MinerU、NotebookLM 行）、spec/2026-10-10-iteration9-web-search.md（同为外部事实来源注入）

## 背景

迭代 10 规划时用户提出"批量导入文档讲解"，当时以"打算引入 MinerU"延后。现在启动（用户原话：txt、md 本地，word、pdf 走 mineru；解析导出格式统一为 md 再做后续处理）。此前所有讲解的事实来源只有两个：LLM 自身知识与博查网络检索（迭代 9）——**用户自己的讲义/笔记/论文进不来**，而这恰是"输入任意概念"向"输入任意材料"的自然扩展，也是 NotebookLM 已验证的主流用户预期（reference.md 三节）。

用户未定的设计点是"拿到 md 内容后怎么处理交互"——已通过选项确认为**资料库 + 一键提炼讲解点**（见方案）。

## ★ User Stories

- 作为终端用户，我想一次选择多个 txt/md/pdf/doc/docx 文件导入，以便把我的学习材料变成讲解素材。
- 作为终端用户，我想看到每份资料的解析状态（解析中/就绪/失败与原因），以便知道何时可用。
- 作为终端用户，我想勾选 ≤3 份资料附加到生成请求，以便讲解以我的材料为事实依据。
- 作为终端用户，我想对一份资料"一键提炼讲解点"并点击概念直接生成，以便解决"导入后不知道讲什么"。
- 作为终端用户，我想概念留空直接生成（附加了资料时），以便最短路径把文档变成讲解。
- 作为终端用户，我想删除资料，以便清理资料库。
- 作为系统，我要把 PDF/Word 的异步解析结果最终取回（无需后台任务），以便解析完成后资料自动就绪。

## 目标 / 非目标

**目标**：批量导入 → 统一 md → 资料库（状态跟踪/删除）→ 附加注入生成 → 提炼讲解点一键生成。

**非目标**：逐章学习路线（方案 C，下一期候选）；URL 导入；图片/表格的原始资源引用（MinerU zip 内图片是死链，直接剔除）；提炼结果的手动编辑。

## ★ 方案

### 决策表

| 决策点 | 选择 | 理由 |
|---|---|---|
| MinerU 接入形态 | 服务端直调精准解析 API v4，不走其 MCP 端点 | `mcp.mineru.net/mcp` 面向 Cursor/Claude Desktop 等 Agent 客户端；服务端对服务端用 REST 更干净（免 MCP SDK 依赖，轮询/超时/重试自控）。token 同名 `MINERU_API_TOKEN` 放 .env.local |
| 模型档位 | `vlm` | 表格/公式识别更强，契合讲解里的 formula 块；额度 1000 页/天足够演示 |
| 批量方式 | `POST /api/v4/file-urls/batch` 一次申请全部上传链接（≤50 文件），PUT 二进制（**不带 Content-Type**，官方要求） | 官方批量本地上传流程；上传完成系统自动开始解析 |
| 结果取回 | **前端轮询驱动懒同步**：GET /api/sources 时服务端顺带向 MinerU 查批次结果，done 则下载 full_zip_url 解压入库 | 免后台任务/常驻进程；幂等更新（仅 parsing 行接受回填）天然容忍并发轮询 |
| ZIP → md | fflate（MIT，~8KB）`unzipSync` 取 `full.md`（兼容根/子目录两种条目路径），清洗掉指向 zip 内部的图片引用 | 零图片资源可引用，图片行是死链噪声 |
| txt/md 解析 | 服务端直读，UTF-8 优先、替换符占比 >0.1% 时回落 GBK 解码 | 中文 txt 常见 GBK；Node 全 ICU 带 GBK 解码器 |
| 交互模式 | **资料库 + 一键提炼讲解点**（用户三选一确认） | 每份资料一个"提炼讲解点"按钮：fast 模型抽 5~8 个概念**落库缓存**，点击概念 = 自动附加该资料 + 预填概念。对比"仅资料库"（导入大文档后无从下手）与"逐章学习路线"（工作量翻倍，留下一期） |
| 注入预算 | 单篇 1.6 万字符（超长头 8000+尾 8000 截取），总量 4 万字符按序分配、装不下整篇丢弃并标注 | 头部定义与尾部总结最有讲解价值；总预算防上下文爆炸 |
| 事实优先级 | 提示词新规则：有「源文档资料」时事实/公式/数值/例题优先取自资料，练习尽量改编自资料例题 | source grounding 与迭代 9 网络资料同构但优先级更高 |
| 概念留空 | 附加了资料时概念可空，服务端取第一份资料标题 | 最短动线：传 PDF→提炼→点概念→生成 |
| 存量兼容 | sources 新表独立，不触碰 docs/attempts | 零迁移风险 |

### 外部依赖（已查证）

- MinerU 精准解析 API v4 官方文档 <https://mineru.net/apiManage/docs>（2026-10-12 拉取全文核对）：
  - `POST /api/v4/file-urls/batch`，body `{files:[{name,data_id}], model_version:"vlm"}` → `{data:{batch_id, file_urls[]}}`；单次 ≤50 文件，上传链接 24h 有效
  - 上传：`PUT` 预签名 URL，**不设 Content-Type**，body 为文件二进制；上传后系统自动提交解析
  - `GET /api/v4/extract-results/batch/{batch_id}` → `extract_result[]`：`{file_name, state(done/running/failed…), err_msg, full_zip_url, extract_progress{extracted_pages,total_pages}}`
  - 限制：单文件 ≤200MB/≤200 页；每账号每天 1000 页最高优先级；国外 URL（github/aws）会超时
  - **结果按 file_name 对回**（extract_result 不含 data_id，GitHub issue #4264 佐证）→ 同批重名文件由客户端改名去重后提交
- fflate 0.8.3 <https://github.com/101arrowz/fflate>：MIT，`unzipSync`/`strFromU8` 已本机验证
- MCP 端点情报（佐证"不用 MCP"决策）：MinerU 生态页 <https://mineru.net> 将 MCP Server 定位为接入 Cursor/Claude Desktop/Windsurf

## 边界 case

- (story 1) 不支持的扩展名（如 .xyz）→ 400，报出文件名与支持列表
- (story 1) 单文件 >50MB → 400（收紧于官方 200MB，防占住服务）
- (story 1) >50 个文件 → 400（官方上限）
- (story 1) 未配置 MINERU_API_TOKEN 却传了 pdf/word → 400 明确提示配置方法（txt/md 不受影响）
- (story 2) 同批重名文件 → 提交前改名（`a.pdf`→`a-2.pdf`），行存提交名以对回结果
- (story 2) 单文件 PUT 失败 → 该行落 error（其余继续）；全部 PUT 失败 → 整批 error 行
- (story 2) MinerU 状态 failed → 行落 error 带 err_msg；中间态（waiting-file/running）→ 保持 parsing 下轮再查
- (story 2) 轮询期间网络抖动 → 本轮跳过不落错，下轮重试；结果下载失败同理（completeSource 幂等防半写）
- (story 3) sourceIds >3 → 400；含不存在/未就绪 id → 400（补练模式除外不受影响）
- (story 5) 概念空 + 附加资料 → 用第一份资料标题；概念空且无资料 → 400（原行为）
- (story 6) 删除已附加的资料 → 同步从附加列表移除
- (story 7) 并发 GET 触发重复同步 → UPDATE 带 `AND status='parsing'` 守卫，后写者不生效

## ★ 验证 seam

- **测试 seam**：HTTP 接口层（curl 直打 /api/sources、/api/sources/[id]、/api/sources/[id]/concepts、/api/generate）+ 浏览器 IAB 自动化（面板交互）
- **复用入口**：curl + node 解析（同迭代 9/10/12 做法）；无单测框架（Vitest 未引入，DB 层 node 原生 ESM 无法 resolve TS 相对导入，见迭代 12 记录）
- **新建入口**：无

## 验证方案

- [x] txt/md 批量导入（UTF-8 md + GBK txt 同批）→ 双双 ready，GBK 内容无乱码
- [x] 不支持扩展名 → 400 带文件名
- [x] 概念提炼 → 5~8 个具体概念；重复调用命中库内缓存（0.2s）
- [x] 附加资料 + 概念留空生成 → 标题取资料 H1，内容含资料特有数值（f=15.2、v=22.8）与口诀原文
- [x] sourceIds 超限/含无效 id → 400
- [x] 删除资料 → 列表移除
- [x] 浏览器：面板展开、概念 chips 点击 → 概念预填 + 资料自动附加（资料 1）+ 占位提示切换 + 生成按钮激活
- [ ] **PDF/Word 真实 MinerU 解析路径**：待 .env.local 填入真实 MINERU_API_TOKEN 后验收（导入→解析中→就绪→提炼→生成全链路）
- [x] tsc --noEmit 全绿

## 不在本次范围

逐章学习路线、URL 导入、MinerU lite 免登录 API（IP 限频风险）、资料重命名、提炼结果编辑、资料与补练模式的组合策略（当前正交并存）

## ★ 实测结果

### 改动清单

- `src/lib/db/index.ts` + `src/lib/db/sources.ts`：sources 表（title/kind/status/md_content/chars/concepts 缓存/error/batch_id/file_name）与数据访问（幂等回填、ready 批量取）
- `src/lib/mineru.ts`：v4 客户端（批量申请+PUT 上传/批次轮询/ZIP 提取清洗），MinerUError 统一错误
- `src/app/api/sources/route.ts`：POST FormData 导入（txt/md 直读+GBK 兜底；pdf/word 批量提交）、GET 列表+懒同步
- `src/app/api/sources/[id]/route.ts` 删除；`[id]/concepts/route.ts` 提炼（fast 模型，zod 校验，库缓存）
- `src/lib/dsl/generate.ts`：GenerateExtras.sources + formatSources（单篇 16k/总量 40k 截断）；`src/lib/llm/prompts.ts` 源资料事实优先规则；`src/app/api/generate/route.ts` sourceIds 校验与概念回退
- `src/lib/api/sources.ts` + `src/components/SourcesPanel.tsx` + `src/app/page.tsx`：资料库面板（导入/轮询/附加≤3/提炼/删除/概念预填）
- 依赖：+fflate 0.8.3；.env.example/.env.local 增 MINERU_API_TOKEN

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| lens.md(575B UTF-8) + gbk.txt(39B GBK) 同批导入 | ✅ 双 ready（296/26 字）；DB 直查 GBK 行内容正确无乱码 |
| bad.xyz 导入 | ✅ 400「不支持的文件类型：bad.xyz（支持 txt / md / pdf / doc / docx）」 |
| 概念提炼（source 1） | ✅ 7 个概念（凸透镜会聚作用/薄透镜成像公式/成像口诀…），二次调用 0.22s 缓存命中 |
| 空概念 + sourceIds[1] 生成（webSearch 关） | ✅ info「已附加 1 份资料（296 字）」；标题取资料 H1「凸透镜成像规律」14 块；f=15.2 / v=22.8 / 「一倍焦距分虚实」口诀全部来自资料 |
| sourceIds=[1,1,2,99]（去重后含无效） | ✅ 400「有资料不存在或还未解析完成」 |
| sourceIds 5 个 | ✅ 400「最多附加 3 份资料」 |
| DELETE /api/sources/2 | ✅ {ok:true}，列表仅剩 1 |
| IAB 浏览器动线 | ✅ 面板列出 lens 行（MD 徽标/296 字/7 概念 chips）；点「薄透镜成像公式」→ 输入框预填 + 「资料 1」chip + 占位提示切换 + 生成按钮激活；截图目检布局正常 |
| tsc --noEmit | ✅ 0 错误 |

### 实施中发现的问题

1. **failSource 与初始 error 态不匹配**：failSource 只更新 parsing 行，直接插 error 行再调它永远写不进错误信息——insertSource 增加 error 入参，error 行一步落库。
2. **批量结果按 file_name 对回的隐性歧义**：同批重名文件在 MinerU 侧无法区分（extract_result 无 data_id），提交前客户端改名去重，行存提交名。
3. TS 5.9 fetch `BodyInit` 要求 `Uint8Array<ArrayBuffer>` 而非 `ArrayBufferLike`——上传 buffer 类型显式收窄。
4. 交互确认前的三方案（仅资料库/资料库+提炼/逐章路线）由用户选定中间档：提炼按钮解决"导入后无从下手"，路线编排留下一期。
