# 迭代 7：多轮深化链渲染 + 深化标题去重 + CJK 加粗修复

> 状态：implementing（2026-09-28，浏览器实测反馈三项问题）
> 创建：2026-09-28
> 关联：`2026-09-28-iteration6-layout.md`（单级深化分组的升级）

## 背景（实测证据）

1. **多轮深化后不协调**：只有最后一轮深化有分组卡；更早轮次的深化被后续版本吸收为"原文"，只剩裸 heading（带"深化："字样）混在正文流中，与卡片风格不一致
2. **双重"深化"标记**：分组卡 chip「深化 · {指令}」内又出现模型生成的「深化：xxx」heading，语义重复
3. **`**约瑟夫·傅里叶（…）**` 未渲染**：CommonMark 定界符侧性（flanking）规则在 CJK 场景失效——闭合 `**` 前邻全角标点 `）`（Unicode 标点）、后邻汉字时不构成右侧定界符，加粗不成立；同理开启 `**` 后邻全角标点也不构成左侧定界符

## 方案（自包含技术描述）

### 1. 深化链分段（computeDeepens）

- `/api/docs/[id]` 沿 parent_id 向上回溯（深度上限 20）返回 `versions: [{id, blocks, instruction}]`（根版本在前）
- `computeDeepens(versions)`：对每个 i≥1 的版本，与前一版本逐块 JSON 相等求最长公共前缀 prefix_i（沿用迭代 6 语义：prefix_i 为 0 视为该轮全文重写跳过、无新增跳过），产出 `{fromIndex: prefix_i, label: instruction_i}` 列表；fromIndex 基于最终版本 blocks 坐标，按 refine 追加语义单调递增
- 渲染：`deepens: DeepenInfo[]` 多段——`[0, d₁.from)` 为原文，之后每段各渲染一张深化卡（带各自指令标题）
- page 维护 versions 链状态：generate 置 `[当前]`、refine 追加、恢复历史取 API 全链

### 2. 深化标题去重

- prompt：refine 新增内容首块 heading **不带**「深化：」前缀，直接写主题（分组卡 chip 已表达"深化"语义）
- 渲染防御：深化卡内 heading 块文本剥离前导 `/^深化[：:—-]\s*/`（兼容既有数据）

### 3. CJK 加粗修复（repairCjkBold）

掩码保护行内码/围栏码后，对 `**` 定界符插入零宽空格（ZWSP, U+200B，非空白非标点）打断"标点-定界符"邻接：

- 前邻 CJK 标点 → 定界符前插 ZWSP（修复闭合侧性）：正则 `(?<=[\u3000-\u303F\uFF01-\uFF60\u2018\u2019\u201C\u201D\u2014\u2026])\*\*`
- 后邻 CJK 标点 → 定界符后插 ZWSP（修复开启侧性）：正则 `\*\*(?=[同上区间])`

接入 `preprocessMarkdown` 管线：escapeUnknownTags → repairCjkBold →（hasMath 时）preprocessMath。ZWSP 仅影响 CommonMark 定界符判定，视觉不可见；`**` 出现在 LaTeX 内属罕见（数学转换在其后，区间只匹配 CJK 标点）。已知局限：单星 `*` 斜体同规则问题不处理（出现率低）。

## 边界 case

- 版本链回溯超 20 层截断（防御环）
- 某轮 prefix=0（重写）：该轮跳过分段，后续轮仍按各自前缀计算
- 深化卡内首块为 heading 且已带前缀 → 剥离后显示；不带则原样
- `**` 紧邻半角标点/拉丁字母（健康对）→ 不插 ZWSP，不受影响

## 验证方案

- [ ] build 通过
- [ ] node：computeDeepens 两轮链分段正确（两卡 fromIndex 递增）；repairCjkBold 在 `）**` / `**（` 位置插入 ZWSP、健康对不插入
- [ ] 真实库 E2E：`/api/docs/{多次深化后的 id}` 返回 versions 链
- [ ] 浏览器：多轮深化各得一张卡；卡内 heading 无"深化："重复；追问回答中的 `**…（…）**` 正确加粗

## 不在本次范围

单星斜体修复、版本树 UI、深化卡折叠。

## 实测结果

### 改动清单

- `deepen.ts`：computeDeepens（版本链多段，替代单级 computeDeepen）
- `/api/docs/[id]`：parent_id 回溯（上限 20）返回 versions 链；loadDoc 同步改为 versions
- ExplainDocView：deepens[] 多卡渲染、深化段 heading 剥"深化："前缀、quiz 卡底色改白（深化卡内对比）
- preprocess：repairCjkBold（ZWSP 修复 CommonMark CJK 侧性失效）接入管线
- page：versions 链状态（generate 置初值 / refine 追加 / 恢复读 API）；prompts：refine heading 禁"深化："前缀

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| pnpm build | ✅（修一处 VersionPayload.id 可选） |
| computeDeepens 纯函数 | ✅ 两轮链 fromIndex=3/5 递增；含重写轮的链跳过重写、后续轮仍分段 |
| repairCjkBold 纯函数 | ✅ `）**` 前插 ZWSP、`**（` 后插 ZWSP、健康对不插入、代码 span 保护 |
| 真实库 E2E（#7 方波傅里叶） | ✅ 链 v0#5(12 块)→v1#6(20,"加一个对比演示")→v2#7(23,"出两道自测题")；分段 [{12,加一个对比演示},{20,出两道自测题}] 与浏览器实测文档一致 |
| 浏览器验收（两卡渲染/heading 去重/CJK 加粗） | 待所有者验收（dev server 已热加载，刷新即见） |

### 实施中发现的问题

- 初版 ExplainDocView 重写时遗留草稿残渣（语法错误），构建前自查发现并清理——大文件重写后应通读一遍 diff
