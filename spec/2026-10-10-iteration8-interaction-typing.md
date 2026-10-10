# 迭代 8：交互选型策略 + 语言三件套练习块（fillBlank / match / sort）

> 状态：done
> 创建：2026-10-10
> 关联：spec/2026-09-24-dsl-schema-v0.md、spec/2026-09-28-iteration6-layout.md、spec/2026-09-28-iteration7-deepen-chain.md

## 背景

用户实测生成「英语的复数语法」，得到的是"物品数量 n"滑块（1~10）+ 柱状图"例句数量示意"——对语法主题而言语义空洞。根因有二：

1. 生成提示词硬性规定文档结构「核心公式(formula) → 交互探索(slider × 1~3 + wavePlot 或 chart) → 自测题」，所有主题被迫数值化；
2. 7 种块中非数值交互只有 quiz（再认式），语法/词汇/分类主题没有合适的交互形态可用。

教学法依据（详见 reference.md 三节新登记条目）：ICAP 框架（Chi & Wylie 2014）与检索练习研究（Franzoi et al. 2025）均支持"生成式回忆 > 再认式 > 被动重读"——完形填空、配对、分类正是语言类主题等价于滑块的交互形态。

## User Stories

- 作为终端用户，我想让语法/词汇类主题得到与其匹配的练习型交互（而非生造的数值滑块），以便真正动手练。
- 作为终端用户，我想在配对练习中点击左列再点右列完成配对并获得即时反馈，以便记忆术语对应关系。
- 作为终端用户，我想在分类练习中把条目归入类别并检查对错，以便掌握分类判断标准。
- 作为终端用户，我想在完形填空中先自己选再判分并看到错空解析，以便在语境中回忆知识点。
- 作为终端用户，我想数学/量化主题的滑块+图表体验不因本次改动退化。
- 作为系统，我想让 LLM 生成的不合法练习块（空位数不符、类别非法、配对值重复）被 schema 拦截并走自修复，以便渲染层永远拿到结构自洽的文档。

## 目标 / 非目标

**目标**：
1. 生成提示词按主题域选交互类型，允许零参数交互文档，禁止无语义数值参数
2. DSL 新增 fillBlank / match / sort 三种练习块（zod 校验 + 渲染组件 + 流式骨架 + 构建面板标签）
3. 旧文档（7 种块）与新块在同一次渲染中共存

**非目标**：compare 对比表、steps 时间线（下一期候选）、states 枚举参数、flashcard、dialog 分支情景、音频、URL 分享（backlog 登记，不在任何 story 内）。

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 选型策略位置 | 生成提示词内"主题域→块类型"映射表 | 选型是语义判断，交给 LLM；代码层不硬编码主题分类 |
| fillBlank 形态 | text 内 `___` 占位 + 每空选项数组，先选后判 | 生成式回忆（先回忆再反馈）；与 quiz 同构降低提示词学习成本 |
| match 判定 | 按内容配对，schema 强制两列各自不重复 | 重复值会让"点哪个都算对/错"不可判定；唯一性是交互正确性的前置条件 |
| sort 题面顺序 | 内容哈希的确定性洗牌（match 右列同） | 随机洗牌 SSR/客户端不一致会 hydration 报错；哈希顺序确定且与内容绑定 |
| 新块与参数台 | 完全解耦：不产生滑块变量、不进参数台 | 练习块无需参数联动；无滑块文档已是单栏布局（迭代 6 边界） |
| 反馈交互语言 | 沿用 quiz 的配色（emerald 正确 / red 错误 / indigo 选中）+ 检查/重做按钮 | 视觉一致性；离散状态切换才用动效（错配 shake） |

### 外部依赖

- ICAP 框架（Chi & Wylie 2014，Educational Psychologist）、检索练习研究（Franzoi et al. 2025）：教学法依据，链接见 reference.md 三节
- zod 4 discriminatedUnion 扩张：新增成员后 exhaustive switch（BlockRenderer）编译期强制注册，无运行时遗漏风险

## 边界 case

- (story 6) LLM 生成 `___` 数与 blanks 不符 / answer 越界 / sort category 非法 / match 值重复 → superRefine 报错 → 既有 1x 自修复重试
- (story 6) match 仅 1 对 / sort 仅 1 类 → schema min(2) 拒绝
- (story 5) 无滑块文档 → 单栏布局，参数台不挂载（既有行为回归）
- (story 2/3) 流式生成期新块 → partial.ts 增量解析与块类型无关，pending 骨架自动兜底
- (story 1) 深化追加练习块 → deepen diff 按 JSON 相等分组，类型无关

## 验证 seam

- **测试 seam**：schema 校验层（validateDoc 纯函数）+ HTTP 层（dev server SSE 真实 E2E）
- **复用入口**：既有 dev server（:3000）curl SSE 冒烟方式
- **新建入口**：无（scratch 脚本跑完即删，沿用既有惯例）

## 验证方案

- [x] schema 边界：8 用例（合法 fillBlank 双空 / ___ 数不符 / answer 越界 / 合法 match+sort / right 重复 / 单对拒绝 / category 非法 / 旧 7 块文档回归）
- [x] `pnpm build` 通过
- [x] E2E「英语的复数语法」重测：期望练习块替代数值滑块
- [x] E2E「正弦波的频率」回归：期望 slider+wavePlot 不退化
- [x] E2E 深化抽查：语言文档 refine 追加新块、原块逐字保持

## 不在本次范围

compare/steps 结构两件套（已与所有者确认为下一期候选）、states 枚举参数、flashcard、dialog 分支情景、音效两档、URL hash 分享。

## 实测结果

### 改动清单

- `src/lib/dsl/schema.ts`：fillBlank/match/sort 三块 schema、superRefine 校验（___ 计数、下标越界、配对值唯一、类别合法）、类型导出
- `src/lib/dsl/order.ts`（新增）：hashOrder 内容哈希确定性排序下标
- `src/components/dsl/FillBlankView.tsx`、`MatchView.tsx`、`SortView.tsx`（新增）：三个练习组件
- `src/components/dsl/BlockRenderer.tsx`、`BlockSkeleton.tsx`：三 case 注册与骨架形状
- `src/components/BuildProgressPanel.tsx`：块清单标签与点亮正则补齐（含迭代 6 遗漏的 heading）
- `src/lib/llm/prompts.ts`：十种块描述 + 交互选型映射表 + 双域示例（量化/语言）；refine 块清单与练习选型指引

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| schema 8 用例（node scratch） | 全部 PASS（含旧文档回归） |
| `pnpm build` | 通过（首次两处 `(number\|null)[]` reduce 累加器 TS18047，加 `reduce<number>` 修复） |
| E2E 英语的复数语法（16.8s，doc 14） | 块序列 text>heading>text>fillBlank>heading>text>match>fillBlank>sort>heading>text>quiz>quiz>text；**无 slider/chart/formula**；match 4 对（child/foot/mouse/sheep）、sort 分类自洽 |
| E2E 正弦波的频率（16.7s） | formula>slider×2(f,A)>wavePlot×2>quiz×2，量化选型无退化 |
| E2E 深化（doc 14，"再出两道句子语境完形填空"，17.2s） | 追加 heading+fillBlank×2，原 14 块 JSON 逐字相等 |

延迟：两次生成 16.8s/16.7s，与既有 low-effort 基线（~15.5s）相当，提示词加长无显著回退。

### 实施中发现的问题

- 计划原定 schema 与组件分两个提交，但 discriminatedUnion 扩张会使 BlockRenderer 的 exhaustive switch 编译失败，两者必须同提交落地——合并为一个 feat 提交。
- BuildProgressPanel 的块标签表自迭代 6 起就漏了 heading（有 `?? type` 兜底所以未暴露），本次顺手补齐。
- LLM 生成 sort 时可能把语义相近的类别合并（如"不规则/同形"作为一个类别名），schema 合法且内容自洽，属内容质量而非结构问题，不干预。
