# SM-2 复习卡与考试倒计时：记忆闭环收口

> 状态：done
> 创建：2026-10-12
> 关联：spec/2026-10-12-iteration16-knowledge-spaces.md（空间=复习战役容器）、../reference.md 三节「间隔重复算法」（设计依据，本轮落地）

## 背景

学习闭环「讲解→练习→统计→补练」缺最后一块：**记忆保持**。讲过的概念隔周就忘，而产品的空间容器恰好是复习战役的自然单元。既有依据：SM-2 成熟（reference.md 三节登记）、spaces 表迭代 16 已预留 exam_date 列、讲解里的 quiz/填空块是被练习验证过的优质题源。

## ★ User Stories

- 作为终端用户，我想把一篇讲解的自测题/填空一键制成复习卡，以便不再手动整理题库。
- 作为终端用户，我想在空间里按 SM-2 节奏复习到期卡片（看题→翻面→三档评分），以便考前高效保持记忆。
- 作为终端用户，我想给空间设考试日期并在概念地图看到倒计时，以便感知复习紧迫度。
- 作为系统，复习评分要按遗忘曲线调度：忘记当天再来，记得间隔拉长。

## ★ 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 卡片来源 | 讲解的 quiz + fillBlank 块**机械提取**（front=题面，back=答案+解析），零 LLM | 内容已被练习验证、与讲解/练习闭环同源；LLM 生成卡有幻觉与成本，机械转换确定性强 |
| 提取时机 | 讲解底部显式「🔖 制成复习卡」按钮（仅空间归属的讲解显示） | 不自动生成避免噪音；深化链的新题再点一次即增量入组（按 doc+题面去重） |
| 调度算法 | SM-2 日粒度（lib/srs.ts 纯函数）：三档评分 again(q1)/fuzzy(q3)/easy(q5)；q≥3 时 rep1→1d、rep2→6d、repn→round(prev×EF)；EF=EF+(0.1−(5−q)(0.08+(5−q)0.02)) 下限 1.3；again 重置 rep 且 due=今日 | 经典算法（Wozniak 1990），reference.md 已登记 FSRS 对比（SM-2 胜在简单可解释，MVP 合适） |
| 复习会话 | 空间概念地图头部「🔖 复习 n」入口 → 居中会话浮层：翻面（空格）→三档（1/2/3，配迭代 13 音效）→again 追加队尾当场再过；结束屏统计 | 会话是独立专注活动，浮层隔离干扰；键盘流提升速度 |
| 到期口径 | due ≤ 今日（本地时区），队列按 due 升序 | 日粒度，今日内不分先后 |
| 倒计时 | 概念地图头部「⏰ 距考试 n 天」（examDate 经 spaces 列表传入，枢纽改日期即时生效）；枢纽行内 date 输入编辑 | 与复习入口同屏形成"还剩几天+今天该复习什么"的战役视图 |
| 卡组归属 | cards.space_id 跟随讲解的 spaceId（新卡 due=今日立即入列） | 复习属于空间战役；全局讲解暂不制卡（无复习入口） |

### 外部依赖（查证）

- SM-2 算法公式：SuperMemo 官方算法描述（Wozniak 1990），已登记 ../reference.md 三节「间隔重复算法」行；实现在 lib/srs.ts 并以 API E2E 数值验证（见下）

## 边界 case

- (story 1) 讲解无 quiz/填空 → 400「没有可提取的自测题/填空」
- (story 1) 重复制卡 → 同 doc 同题面跳过，返回 added/skipped
- (story 1) 讲解不属于空间 → 按钮不显示（无复习入口的卡组无意义）
- (story 2) 无到期卡 → 会话显示空态与制卡引导
- (story 2) 最后一卡评 again → 追加队尾，会话不结束（当场再过）
- (story 2) grade 非法 → 400；卡片不存在 → 404
- (story 3) examDate 过期 → 「考试已过 n 天」；今天 → 「今天开考」
- (story 3) 清空卡组 → DELETE /api/cards?spaceId（演示重置用）

## ★ 验证 seam

- HTTP 接口层（curl）+ 浏览器 IAB 动线；SM-2 数值经 API 评分序列验证（无单测框架，见迭代 12 记录）

## 验证方案

- [x] 制卡：doc 39（3 quiz）→ added 3；重复 → skipped 3
- [x] 深化版 doc 40（4 quiz）制卡 → added 4（深化链新题入组）
- [x] SM-2 数值：easy×3 → 1d/6d/17d、EF 2.5→2.8；again → rep0 due今日 EF−0.54；fuzzy → rep1 1d EF−0.14
- [x] 地图卡数 {total, due} 与到期队列一致
- [x] 倒计时：examDate=2026-10-20 → 「⏰ 距考试 6 天」
- [x] 浏览器复习会话：入口 n=2 → 翻面（含答案+解析+出身概念标签）→ 键盘 3 评分 → 2/2 → 结束屏统计 → 完成后地图刷新为「已清」
- [x] tsc --noEmit 全绿

## 不在本次范围

FSRS 调度、卡片手写/编辑、跨空间卡组、复习提醒（通知）、卡片与练习统计互通（attempts 与 cards 各自独立）

## ★ 实测结果

### 改动清单

- `lib/srs.ts`（新增）：SM-2 纯函数 + localDay/addDays；`db/index.ts` cards 表；`db/cards.ts`（新增）：提取/去重、到期队列、计数、评分写回、清空
- `db/spaces.ts` 地图带 cards 计数；API：`/api/cards`（GET 队列/DELETE 清空）、`/api/cards/from-doc`、`/api/cards/[id]/review`；`/api/docs/[id]` 响应带 spaceId
- UI：`ReviewPanel.tsx`（新增，会话+键盘+音效）、`SpaceMapPanel`（倒计时+复习入口+浮层）、`page.tsx`（docSpaceId/制卡按钮/cardsNote）、`SpacePicker` 枢纽日期行内编辑；`lib/api/cards.ts`（新增）、`lib/api/spaces.ts` setSpaceExamDate、`lib/api/explanation.ts` loadDoc 带 spaceId

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| 制卡/去重/深化增量 | ✅ 3→skip 3→4 |
| SM-2 评分序列 | ✅ easy×3: interval 1/6/17、ease 2.60/2.70/2.80；again: rep0 due 10-14 ease 2.26；fuzzy: rep1 1d ease 2.12（与公式逐位一致） |
| 倒计时 | ✅ 「⏰ 距考试 6 天」 |
| 复习会话全流程 | ✅ 1/2→翻面（死锁题含解析与「隔离性」出身标签）→键盘3→2/2→翻面→记得→「本轮过完 记得2·模糊0·忘记0」→完成后入口转「复习·已清」 |
| 制卡按钮（UI） | ✅ doc 40 底部按钮 → 「已新增 4 张复习卡…」提示 |
| 清理 | ✅ 清卡+删空间 200；docs 39/40 回落未分组；cards=0 |

### 实施中发现的问题

1. **Turbopack 幽灵 404 第二次出现且更诡异**：本轮新增 cards 路由目录后，**既有**的 `/api/spaces/[id]` 也被挤掉（GET/DELETE 404，重启恢复）。教训升级：**新增任何路由目录后统一重启 dev server 再验证**（迭代 16 是新目录自身不注册，本轮是殃及既有动态路由）。AGENTS 已更新。
2. 复习卡的题源质量直接继承讲解生成质量——doc 40 的死锁题（"InnoDB 回滚代价较小的事务"）在会话里表现为一张高质量卡片，机械提取路线得到实证。
