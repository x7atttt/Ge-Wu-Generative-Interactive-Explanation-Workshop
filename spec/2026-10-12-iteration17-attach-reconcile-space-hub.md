# 附加资料态对账与持久化 + 空间管理枢纽

> 状态：done
> 创建：2026-10-12
> 关联：spec/2026-10-12-iteration16-knowledge-spaces.md（用户实测反馈的三处修复与增强）

## 背景

用户实测迭代 16 反馈三题：①删除资料后「资料 n」高亮不消失；②附加的资料应持久化（刷新即丢）；③带着失效附加生成直接报 400「有资料不存在或还未解析完成」；④知识空间只有工具行下拉一个入口，查看管理不便。根因：附加态（attachedSourceIds）是纯内存状态，与资料库的真实存在性从不对账，也无持久化；空间缺集中管理视图。

## ★ User Stories

- 作为终端用户，我删除资料后（无论从哪里删），附加高亮应自动摘除，别再挡生成。
- 作为终端用户，我刷新页面后附加的资料工作集应保留。
- 作为终端用户，我带着失效附加点生成时，应忽略失效资料并继续，而不是报错。
- 作为终端用户，我要有一个集中的空间管理入口：查看所有空间（含资料/讲解计数）、新建/重命名/删除、把资料在空间之间移动或移出。

## ★ 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 附加态对账 | SourcesPanel 挂载即拉列表（不再仅开面板时）；每次 refresh 后把 attachedIds 修剪到"仍存在且 ready"的集合 | 删除可能发生在任何路径（面板删除/空间清理/外部 API），列表是唯一可信源；attachedIds 变化 → refresh 重建 → 自动重取对账（收敛） |
| 附加态持久化 | localStorage `gewu-attached`；**写存储只发生在变更入口**（updateAttached/预填两函数内直写），恢复 effect 只读 | 实测踩坑：写回 effect 在 StrictMode 双挂载下用初始空态清掉存储（探针序列 `restore-read:[8] → write:[] → restore-read:[]`），首轮恢复即失效。变更入口直写无竞态，且修剪路径（onAttachChange）天然复用 |
| 生成宽容 | 服务端 sourceIds 中失效 id 静默剔除并发 info「已忽略 n 份失效资料」，不再 400 | 客户端对账已挡大部分场景；服务端兜底保证任何陈旧状态都不阻塞生成（双保险） |
| 空间管理枢纽 | SpacePicker 内置 🗂 浮层：空间一览（名称/资料数/讲解数/当前标记）、新建、内联重命名、删除（确认）、展开空间资料可移出、未分组资料下拉移入指定空间 | 下拉保留"快切"，枢纽承担"管理"，双入口满足"方便查看和管理空间和资料" |
| 空间计数 | GET /api/spaces 聚合子查询带出 sourceCount/docCount | 一次请求拿到枢纽全部数据，避免 N+1 |

## 边界 case

- (story 1) 解析中的资料不可附加（原约束），对账只认 ready
- (story 1) 全部附加失效被修剪后：概念空 + 无附加 → 生成按钮回到禁用（正确）
- (story 2) 恢复的 id 失效 → SourcesPanel 首次对账修剪并同步写回存储
- (story 3) sourceIds 全部失效且概念为空 → 走"请输入概念"原 400（此时确实没有可生成物）
- (story 4) 枢纽删除当前空间 → onSpacesChange 回拉 + 父级回落全局（迭代 16 既有逻辑）
- (story 4) 枢纽改名 → 确认/回车提交，Esc 取消；spaces 列表与切换下拉同步刷新

## 验证方案

- [x] 附加 temp 资料 → chip 资料 1；写存储 [id]
- [x] 重载页面 → chip 资料 1 恢复、存储保持、生成按钮激活（空概念+有附加）
- [x] 外部 API 删除该资料 → 打开面板刷新 → chip 清空、存储修剪 []、按钮禁用
- [x] sourceIds=[999]（不存在）生成 → 200 + info「已忽略 1 份…」（不再 400）
- [x] 枢纽：渲染空间行（计数）、内联改名（枢纽+下拉同步）
- [x] tsc --noEmit 全绿

## 不在本次范围

考试倒计时/SM-2（迭代 18 候选）、空间备注与考试日期编辑 UI（API 已支持）、枢纽内资料预览

## ★ 实测结果

### 改动清单

- `SourcesPanel.tsx`：挂载即加载 + refresh 对账修剪（attachedIds/onAttachChange 入依赖）；空间模式分区渲染不变
- `page.tsx`：localStorage 恢复（只读）；updateAttached 变更入口直写存储；pickSourceConcept/pickMapConcept 同步写；persona 持久化同构修复（updatePersona）
- `generate/route.ts`：失效 sourceIds 剔除 + info 提示；insert 存有效 id
- `db/spaces.ts` + `api/spaces` GET：sourceCount/docCount 聚合；`lib/api/spaces.ts` 类型 + renameSpace
- `SpacePicker.tsx`：重写为「下拉 + 🗂 枢纽」双入口，SpaceHub 浮层（新建/进入/改名/删除/展开移出/未分组移入）

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| 附加→存储→重载恢复 | ✅ chip 资料 1、stored [8]、生成激活 |
| 外部删除→面板对账 | ✅ chip 清空、stored []、按钮禁用 |
| 失效 sourceIds 生成 | ✅ HTTP 200，info「已忽略 1 份已删除或未解析的资料」，doc 41 正常产出 |
| 枢纽渲染/改名 | ✅ 「枢纽测试空间 1 资料·0 讲解」；改名后枢纽与下拉同步显示新名 |
| 计数 API | ✅ spaces 列表带 sourceCount/docCount |
| tsc | ✅ 0 错误 |

### 实施中发现的问题

1. **持久化写回 effect 的 StrictMode 竞态**（本轮核心踩坑）：恢复 effect 读到 [8] 后，同轮的写回 effect 用初始 [] 清掉存储，StrictMode 第二轮恢复读到 [] —— 探针日志 `restore-read:[8]|write:[]|restore-read:[]|write:[]` 实锤。教训：**localStorage 持久化不要用"state 变更 effect 写回"配"挂载恢复"的组合（dev StrictMode 必炸），改为变更入口直写**。persona 持久化是同构写法、同病（生产无 StrictMode 不发作），本轮顺手修复并实测（选"严谨学者"→重载→保留）。
2. 用户侧「排序」PDF 资料行在其复现删除 bug 期间被删（docs 37/38 讲解仍在）；引导重新导入即可。
