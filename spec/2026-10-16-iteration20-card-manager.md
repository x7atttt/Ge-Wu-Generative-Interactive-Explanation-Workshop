# 迭代20：卡片手写/编辑/删除与空间备注——复习卡从"只读提取"变"可运营的题库"

> 状态：done
> 创建：2026-10-16
> 关联：2026-10-16-iteration19-mock-exam.md（测验消耗同一卡池，卡池质量直接影响测验价值）

## 背景

迭代18 的卡只能由讲解机械提取（quiz/填空），两个缺口：讲义上有但讲解没出题的要点、用户自己的错题，都进不了卡池；提取的卡偶有题面/答案瑕疵，只能整空间清空重提，无法单张修正。另外 spaces.note 字段与 PATCH 契约都已存在，但没有任何编辑入口，多空间时无法记录"这是哪门考试的什么范围"。根因：卡片缺 CRUD 写路径、备注缺 UI。

## ★ User Stories

- 作为备考用户，我想手写补充卡片（题面/答案/可选概念归属），以便错题和讲义要点也进复习与测验。
- 作为备考用户，我想单张编辑卡片的题面、答案、概念归属，以便修正提取瑕疵、调整测验分项口径。
- 作为备考用户，我想删除不需要的卡片，以便控制复习队列质量（而不是整空间清空）。
- 作为备考用户，我想查看空间全部卡片（不只到期），以便了解题库全貌。
- 作为备考用户，我想给空间写备注（科目/范围），并在地图上看到，以便多空间快速识别。
- 作为系统，手写卡不属于任何讲解（doc_id 为空），讲解删除的级联清理不应波及手写卡。

## 目标 / 非目标

**目标**：卡片 CRUD API 与全量列表、卡片管理面板（列表/行内编辑/删除/新增表单）、空间备注行内编辑与地图展示。

**非目标**：不做批量导入卡（Excel/Anki 包）、不做卡片移动跨空间、不做富文本；概念归属只做文本 + datalist 建议，不做概念选择器组件。

## ★ 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 手写卡调度初值 | 与提取卡一致：ease 2.5 / rep 0 / due=今日 | 新知识立即进入复习节奏，无需另设"手写缓冲" |
| 手写去重 | 不去重（同空间同题面允许并存） | 用户手写是有意为之，静默吞掉会显得"添加失败"；列表可见可删 |
| 编辑范围 | front / back / origin_concept 三字段 | 概念归属可改意味着测验分项口径用户可调（如把口诀归到某概念） |
| 全量列表入口 | 复用 `GET /api/cards`，加 `all=1` 参数 | 到期队列与全量同形同端点，少一个路由 |
| 管理面板形态 | 模态浮层（同 Review/Exam 形态），概念分组折叠为按概念排序平铺 | 与既有浮层交互一致；分组折叠在小数据量下是过度设计 |
| 新增表单概念输入 | 文本输入 + `<datalist>`（现有概念做候选） | 复用 HTML 原生能力，零依赖 |
| 备注编辑 | 枢纽行内「备注」按钮 → 展开式 textarea（复用 PATCH note，已有契约） | 行内空间拥挤，展开式不打断布局 |
| 备注展示 | 概念地图头部 note 非空时作副行小字 | 备注写了就要有回显，否则是死数据 |

### 外部依赖

无新外部依赖。`PATCH /api/spaces/[id]` 已接受 `note`（字符串，trim 后截 200，db 层 `updateSpace` 已实现）。

## 边界 case

- (story 1) POST：front/back 去 whitespace 后为空 → 400；spaceId 非法 → 400；concept 可空 → origin_concept 存 NULL。
- (story 2) PATCH：id 不存在 → 404；传空 front/back → 400（拒绝把卡改成空）；不传的字段不动。
- (story 3) DELETE：id 不存在 → 404（与删除讲解口径一致，重复删可感知）。
- (story 4) `all=1` 与无参并存：无参保持到期队列语义不变（向后兼容）。
- (story 6) 讲解级联删除（deleteDocTree）按 doc_id 清卡 → 手写卡 doc_id 为 NULL 不受影响。
- 管理面板与复习/测验并发：编辑保存后刷新本地列表即可，卡片调度状态在会话开启时已快照。

## ★ 验证 seam

- **测试 seam**：HTTP API（curl 直打 CRUD 四个端点）+ `tsc --noEmit`。
- **复用入口**：既有 curl 冒烟方式。
- **新建入口**：无。UI 视觉验收按用户惯例由用户自查。

## 验证方案

- [ ] POST /api/cards {spaceId, front, back, concept} → 返回新卡（due=今日、repetitions=0、docId=null）
- [ ] POST 空 front / 非法 spaceId → 400
- [ ] GET /api/cards?spaceId&all=1 → 含手写卡与提取卡全量；无参仍是到期队列
- [ ] PATCH /api/cards/{id} 改 front/back/concept → 读回一致；PATCH 不存在 id → 404；空 front → 400
- [ ] DELETE /api/cards/{id} → 再 GET all 不含；重复 DELETE → 404
- [ ] 手写卡在讲解删除后仍存在（doc_id NULL 不进级联）
- [ ] PATCH /api/spaces/{id} {note} → 地图/枢纽读回一致（既有契约回归）
- [ ] `pnpm exec tsc --noEmit` 通过

## 不在本次范围（Out of Scope）

- 卡片批量导入/导出、跨空间移动、富文本、卡片统计视图
- FSRS 调度（backlog 后续）
- 逐章学习路线（方案C，backlog 后续）

## ★ 实测结果

> 状态：done（2026-10-16）

### 改动清单

- `lib/db/cards.ts`：`listAllCards` / `createManualCard` / `updateCard` / `deleteCard`
- `app/api/cards/route.ts`：GET 加 `all=1` 全量语义；POST 手写卡（201，front/back trim+截断、concept 截 120）
- `app/api/cards/[id]/route.ts`（新路由目录）：PATCH 三字段部分更新、DELETE 单删
- `lib/api/cards.ts`、`lib/api/spaces.ts`：`listAllCards/createCard/updateCard/deleteCard`、`setSpaceNote` 前端封装
- `components/CardManagerPanel.tsx`：管理面板（手写表单带概念 datalist、按概念分组列表、行内编辑、确认删除、调度状态小字）
- `components/SpaceMapPanel.tsx`：「🗂 卡片」入口（不依赖已有卡，空池也可手写）+ 备注副行展示（prop 优先、map 兜底）
- `components/SpacePicker.tsx`：枢纽「备注」行内编辑（有备注的按钮高亮）；`app/page.tsx` 传 `note` prop

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| POST 手写卡 → 201，docId=null/reps=0/due=今日 | PASS（id=11，due=2026-10-16） |
| POST 空 front / 非法 spaceId → 400 | PASS ×2 |
| GET all=1 全量、无参仍到期队列 | PASS（各 n=2） |
| PATCH 三字段改写 / 空 front→400 / 不存在→404 | PASS ×3 |
| DELETE 后列表不含、重复 DELETE → 404 | PASS ×2 |
| 讲解删除不波及手写卡 | 由 `deleteDocTree` 按 doc_id 清卡 + 手写卡 doc_id=NULL 保证（代码路径复核，未单测） |
| PATCH 空间 note → 地图读回一致 | PASS ×2（「期末·操作系统 考纲+真题」写入读回） |
| `pnpm exec tsc --noEmit` | PASS |

冒烟脚本 22 项 ALL PASS（node 一次性脚本，跑完即删；验证造的卡与备注已还原）。

### 实施中发现的问题

- 备注展示的数据流：地图头部 note 走 spaces 列表 prop（枢纽保存后即时生效），map 自带 note 兜底——与 examDate 同构，避免了"保存了但地图不刷新"的时差。
