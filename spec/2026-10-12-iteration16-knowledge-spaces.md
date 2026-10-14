# 知识空间：复习战役容器与概念地图驾驶舱

> 状态：done
> 创建：2026-10-12
> 关联：spec/2026-10-12-iteration14-doc-import.md（资料库）、spec/2026-10-10-iteration10-learning-stats.md（统计口径）、../reference.md 三节（Gemini Notebook/国内知识库对比）

## 背景

迭代 14 落地的资料库是"散装"的：资料、讲解、练习统计彼此无关联，用户备考场景（"导入一份考试资料专攻复习"）缺一个"为什么学、学到哪了"的容器。查证现有方案（详见 reference.md）：Gemini Notebook（原 NotebookLM，2026-07 更名）的空间=资料集合，产出止于静态读物；国内助手知识库止于 RAG 问答；刷题 App 有题集闭环但装的是"题"不是"理解"。格物已有的交互讲解+练习闭环正好缺战役容器——**空间定位为复习指挥部，不是又一个知识库**。用户三选一确认 MVP 做全量概念地图驾驶舱。

## ★ User Stories

- 作为终端用户，我想创建/删除"空间"（如 期末·操作系统），把一场考试的资料圈在一起。
- 作为终端用户，我想把资料导入到空间（或把未分组资料一键移入），空间模式下只看本空间内容。
- 作为终端用户，我想看到空间的**概念地图**：各资料提炼概念聚合成一张地图，每个概念标状态（未学/已讲解/已练习/薄弱）。
- 作为终端用户，我想在地图上一键分派：未学→生成讲解（自动附加来源资料）、已讲→打开讲解、薄弱→针对性补练。
- 作为终端用户，我想让历史讲解与学习统计按空间过滤，看到"这场战役"的独立进度。
- 作为终端用户，我想深化讲解不丢归属（refine 子版本继承空间与出身概念）。
- 作为系统，删除空间时学习资产不丢（资料与讲解移回未分组）。

## ★ 方案

### 决策表

| 决策点 | 选择 | 理由 |
|---|---|---|
| 空间定位 | 复习战役容器（资料+讲解+统计归属层），**不做 RAG 问答** | 与 Gemini Notebook/国内知识库差异化：他们止于"读/问"，格物的闭环是可操作讲解+练习；RAG 聊天会稀释主线 |
| 数据模型 | `spaces` 表；`sources.space_id`/`docs.space_id` 归属（NULL=未分组）；`docs.origin_concept`（出身概念）+ `docs.source_ids`（生成时附加的资料） | 归属用可空外键而非关联表（单用户单归属，简单直接）；出身概念是地图对齐的锚——比标题模糊匹配可靠 |
| 概念地图聚合 | 就绪资料的提炼概念（跨资料同名合并）× docs.origin_concept 精确匹配 × attempts 合并统计；状态机 new→explained（有讲解）→practiced（有练习且不弱）/weak（<60% 且 ≥3 次，与统计面板弱项阈值一致） | 聚合纯服务端一条 GET；排序薄弱优先→未学→已练→已讲 |
| 点击分派 | new→生成（附加来源资料+记录出身）；explained/practiced→打开最近讲解；weak→补练（最近 docId 的统计） | 每个状态一个最自然动作，hint 悬浮说明 |
| refine 继承 | 子版本复制父版本 space_id/origin_concept/source_ids | 地图状态不被深化链打散 |
| 手动输入概念 | 空间内生成时 originConcept 缺省=概念文本（若恰与提炼概念同名则自动对齐）；用户改写概念文本后清空出身 | 出身对齐是精确匹配，改写即失效符合直觉 |
| 过滤实现 | `?spaceId=` 查询参数贯通 /api/docs、/api/stats、/api/sources（GET/POST）；getStats 增加 doc_id IN 子查询 | 单一参数约定，全局面板不传即全局 |
| 删除语义 | 资料与讲解 space_id 置 NULL，不删任何学习资产 | 误删可恢复；与"资料库删除"（真删）区分 |
| 空间选择持久化 | localStorage `gewu-space`，不存在回落全局 | 跨会话恢复战役现场 |
| UI 落位 | SpacePicker（工具行，全局↔空间下拉+内联新建/删除）；地图作为主栏卡片仅在空间模式出现 | 全局单概念动线零改动（空间是可选层） |

### 外部依赖（查证）

- Gemini Notebook（原 NotebookLM）官方页 <https://notebooklm.google>（2026-10-12 检索确认 2026-07 更名，笔记本=资料空间+学习指南/闪卡/测验产出）——空间形态参照与差异化依据
- 国内助手知识库（Kimi/豆包/元宝）形态对比来源见 ../reference.md 三节相关行

## 边界 case

- (story 1) 删除当前空间 → 前端列表回落全局、localStorage 失效值回落
- (story 2) 空间模式下面板分区：本空间资料 + 「未分组资料（移入）」折叠区；全局模式显示全部
- (story 3) 资料未提炼 → 地图空态引导「提炼讲解点」；无资料 → 引导导入
- (story 3) 多资料提炼同名概念 → 合并为一条，来源资料并集，点击生成时附加（≤3 截断）
- (story 4) weak 概念的讲解链全被删（未来支持删讲解时）→ 回落 new 动作（打开讲解兜底为生成）
- (story 5) 空间无任何练习 → 面板空态（沿用统计面板现有空态）
- (story 6) 全局生成的讲解 → space_id NULL，不进任何空间地图，但出现在全局历史/统计
- (story 7) origin_concept 只做精确匹配（trim 后）；用户改写概念文本即视为新概念

## ★ 验证 seam

- **测试 seam**：HTTP 接口层（curl 全流程）+ IAB 浏览器动线；复用迭代 14/15 的验证方式，无新建入口

## 验证方案

- [x] 建空间→导入资料(spaceId)→提炼→初始地图 8 概念全 new
- [x] 带 originConcept 生成 → 地图该概念 explained
- [x] 1 次正确 → practiced；累计 3 次 33% → weak 且排序首位
- [x] refine 子版本继承 space_id + origin_concept
- [x] /api/docs?spaceId 与 /api/stats?spaceId 只含本空间；全局不受影响
- [x] PATCH /api/sources/[id] 移入空间；删除空间 → 资料/讲解回落未分组、map 404
- [x] 浏览器：切空间→地图渲染（图例/汇总/8 chips）→点未学概念→预填+自动附加+生成按钮激活；截图目检无布局问题
- [x] tsc --noEmit 全绿

## 不在本次范围

考试日期倒计时与 SM-2 复习计划（迭代 17 候选）、跨概念综合测验卷、空间重命名/编辑 UI（API 已支持）、空间导出分享、多用户隔离

## ★ 实测结果

### 改动清单

- `db/index.ts`：spaces 表 + sources.space_id/docs.space_id/origin_concept/source_ids 幂等迁移；`db/spaces.ts`（新增）：CRUD + getSpaceMap 聚合 + 删除回落
- `db/sources.ts` spaceId 透出/setSourceSpace；`db/docs.ts` 出身字段/insertDoc origin/listDocsBySpace/listDocs(spaceId)；`db/attempts.ts` getStats(spaceId?) 全口径过滤
- API：`/api/spaces`（GET/POST）、`[id]`（GET/PATCH/DELETE）、`[id]/map`（GET）；sources GET?spaceId/POST spaceId/`[id]` PATCH；docs/stats ?spaceId；generate 记录 spaceId+originConcept+sourceIds；refine 继承父版本出身
- UI：`SpacePicker`（切换/内联新建/删除确认）、`SpaceMapPanel`（地图卡片：汇总+图例+状态分派点击）、SourcesPanel 空间分区+移入、StatsPanel spaceId、page.tsx 接线（localStorage 恢复/出身概念/地图刷新信号）；`lib/api/spaces.ts`

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| 空间+资料+提炼+初始地图 | ✅ 空间1/资料7 就绪，8 概念全 new，summary {sources:1, explained:0} |
| 生成（originConcept=隔离性） | ✅ doc 39《事务的隔离性》13 块；地图 explained |
| 状态流转 | ✅ 1 正确→practiced{1/1}；3 次 33%→weak 且 concepts[0] |
| refine 继承 | ✅ doc 40: space=1 origin=隔离性 |
| 空间过滤 | ✅ 空间 docs=[39]、stats docCount=1 attempts=3 rate=33.3；全局 docCount=39 attempts=8 |
| PATCH 移入 + 删除空间 | ✅ 移入 200；删除后 source spaceId=null（含用户的排序资料回落）、map 404 |
| IAB 动线 | ✅ 切空间→地图卡片（图例四色/8 chips/汇总）→点「隔离性」→输入框预填+「资料 1」+生成激活；截图目检无重叠截断 |
| tsc | ✅ 0 错误 |

### 实施中发现的问题

1. **Turbopack 不注册新建的嵌套路由目录**：`api/spaces/[id]/map` 文件已存在但 404（同构的 `sources/[id]/concepts` 正常，因为其目录树在服务器启动前已存在）——重启 dev server 解决。已沉淀到 AGENTS.md。
2. 用户 dev server 中途停止，测试改为自起服务器 + 在线迁移脚本（同迭代 15 手法），全程无需用户介入。
3. 地图概念排序首轮实现即定稿：薄弱→未学→已练→已讲，弱项置顶符合"专攻复习"心智。
