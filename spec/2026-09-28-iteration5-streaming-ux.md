# 迭代 5：流式体验优化（8 项，零新依赖）

> 状态：implementing（2026-09-28 所有者批准，含修订：不引用外部本地路径，所有技术点自包含描述）
> 创建：2026-09-28
> 关联：`2026-09-27-iteration3-ux-polish.md`、`2026-09-24-iteration2-streaming-interactivity.md`

## 背景

所有者提出 8 项体验优化（P0 平滑流式/数学渲染/粘底，P1 DSL 块流式上屏/markdown 补齐，P2 伪标签防御/状态下沉）。核心痛点：SSE delta 突发成块上屏不流畅；追问回答含 LaTeX 定界符未渲染；长问答无粘底；生成过程只有骨架没有"真身渐次上屏"的叙事闭环。

## 方案（自包含技术描述）

### 1. useSmoothStreamText（`src/hooks/useSmoothStreamText.ts`）

target ref 即时累积为唯一真值；rAF 循环每帧显示 `display.slice(0, display.length + max(1, ceil((target.length - display.length) / 6)))`（指数追赶，先快后慢）；显示追平即停帧。对外 `{ display, append, setTarget, reset }`。

### 2. AskBubble memo 化

单条问答拆出 `memo` 组件；`isStreaming={asking && i === asks.length - 1}` 只有活动气泡为真并接收新 props；历史气泡 props 不变即不重渲染、不重解析 markdown。活动气泡内部用 hook 1 平滑显示。

### 3. 数学渲染（零插件，`src/lib/markdown/preprocess.ts`）

`preprocessMath()` 只处理**已闭合**定界符（流式安全：半截公式原样显示，闭合即转），处理顺序与规则：

1. 块级 `$$…$$`（闭合对）与 `\[…\]`（闭合对）→ ```` ```math\n表达式\n``` ```` 围栏块（前后补换行独立成段）；转换结果先掩码保护，防止后续行内规则误伤表达式内部的 `$`
2. 行内 `\(…\)`（闭合对）→ `` `math:表达式` ``（两侧补空格，表达式内反引号替换为单引号）
3. 保守闭合 `$…$`：正则 `/\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$/g`（开定界符后非空白非 `$`、内容无换行、闭定界符前非空白——货币金额不误伤）→ 同上
4. 还原掩码

`hasMath()` 单向探测：`\(` / `\[` / `$$` 任一出现即 true——流式追加只会使探测从 false 变 true，不会反向，杜绝两档渲染器间闪烁。

MarkdownView 自定义 `code` 组件：`language-math`（围栏）或 `math:` 前缀（行内）→ `katex.renderToString`（displayMode 按块/行内；`throwOnError:false`，失败降级原文）。复用既有 katex 依赖，不引 remark-math/rehype-katex。

### 4. 追问粘底（`src/hooks/useAskAutoScroll.ts`）

问答区容器：`max-h-80 overflow-y-auto` + **`overflow-anchor: none`**（禁浏览器原生滚动锚定，否则与 pin 冲突）。四机制：

- useLayoutEffect 内直接赋值 `scrollTop = scrollHeight`（同步于布局生效，防闪烁）
- 流式期 rAF 循环 pin + `lastPinned` 哨兵：`scrollTop < lastPinned - 4` 判定用户上移 → 置 released。哨兵是关键：逐帧 pin 下读到的 scrollTop 恒为底部，无哨兵则永远检测不到用户上移
- 手势主动释放：wheel `deltaY < 0`；touchstart 记 y，touchmove `y - touchY > 4` 下拉释放
- 重新吸附：scroll 事件中距底 `scrollHeight - scrollTop - clientHeight < 80` 时恢复 pinned

### 5. DSL 块流式上屏（`src/lib/dsl/partial.ts` + `src/hooks/usePartialDoc.ts`）

容错增量解析器，输入累计原始流文本：

- title：完整闭合正则 `/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/`
- blocks：定位 `"blocks"` 后首个 `[`，从其后逐字符扫描：字符串内（含转义）跳过；`{`/`[` 深度 +1，`}`/`]` 深度 -1；深度由 0→1 记起始，由 1→0 且闭符为 `}` 时切出该顶层元素
- 每个切出元素：`JSON.parse` → `blockSchema.safeParse`，合法则收集；无论合法与否用 `/"type"\s*:\s*"(\w+)"/` 提取类型，非法的进 `pending`（等待终态修复）
- 产出 `{ title, blocks, pending, lastType }`。**正确性责任在 done 事件的全量校验文档**，容错解析仅服务过程展示

渲染：page 生成期构造 `streamDoc = { version:1, title: partial.title ?? 概念, blocks: partial.blocks }` 传 ExplainDocView；`skeletonTail = [...pending, lastType ?? "text"]` 渲染尾部骨架。**AnimatePresence mode="wait" 移除**：refine 期间旧文档保留至 done 才换新键，避免空白期。

### 6. MarkdownView 组件映射补齐

- `pre` 透传（子 code 负责整体样式）；多行/带语言 code → `bg-zinc-900` 圆角横向滚动块（`text-zinc-100`，无语法高亮库）；行内 code 浅底
- table：外层 `overflow-x-auto rounded-lg border` 容器；`table min-w-full divide-y text-sm`；thead 浅底、td 常规内边距
- `a`：http(s) 外链自动 `target="_blank" rel="noopener noreferrer"`，indigo 下划线

### 7. 伪标签防御（preprocess.ts `escapeUnknownTags`）

流程：掩码保护行内码 `` `…` `` 与围栏码 ```` ```…``` ```` → 白名单 `b/i/em/strong/code/br` 之外的 `<tag…>` 形态 token（正则 `/<\/?([A-Za-z][A-Za-z0-9_-]*)\b[^<>]*?\/?>/g`）包成行内码 → 还原掩码。观感防御（react-markdown 默认转义 raw HTML，无安全风险）。

### 8. buildText 下沉

BuildProgressPanel 改收 raw 字符串、内部 useSmoothStreamText 自理显示；page 流式路径只剩"累积 raw + usePartialDoc 派生"。面板骨架区移除（职责移交文档区流式上屏），保留状态行/块清单/原始流开关。

## 边界 case

- 半截 `\[` / `$$` / `\( / `$` → 不转换，原样显示；闭合后转（正则天然保证）
- 数学表达式内含 `$` 或反引号 → 掩码保护/剔除，不产生嵌套损坏
- 容错解析器遇到非 JSON 前导文本 → blocks 空，文档区不显示，仅面板状态
- 非法块（校验失败）→ 骨架保留至终态替换，不闪坏内容
- `<think>` 等伪标签 → 行内码显示；代码 span 内的 `<tag>` → 保护不处理
- 用户上滚期间新内容到达 → 不强制拉底；回到底部 80px 内恢复吸附

## 验证 seam

`pnpm build` + 纯函数 node 快测（preprocess.ts 无依赖可直接跑；partial 解析算法用等价脚本验证）+ 浏览器手动验收。

## 验证方案

- [ ] build 通过
- [ ] preprocessMath：`\)` `\]` `$$` `$` 混合用例转换正确；未闭合原样保留；`$100` 货币不误伤
- [ ] parsePartialDoc 算法：闭合块数/顺序正确、字符串内括号不干扰、半截块不产出
- [ ] 追问回答逐字平滑上屏、历史气泡不重渲染
- [ ] 问答区粘底/上滚释放/回底 80px 重吸
- [ ] 生成时真块替换骨架渐次上屏；refine 无空白期交接
- [ ] 追问含公式/表格/代码块/`<think>` 的渲染正确

## 不在本次范围

remark-math/rehype-katex、语法高亮库、DSL text 块内数学、mermaid/引用角标映射。

## 实测结果

### 改动清单

- `src/hooks/`（新增 3 个）：useSmoothStreamText（rAF 指数追赶平滑）、useAskAutoScroll（哨兵释放粘底）、usePartialDoc
- `src/lib/markdown/preprocess.ts`（新增）：数学定界符归一（掩码保护 + 三段转换）+ 伪标签防御 + 单向探测
- `src/lib/dsl/partial.ts`（新增）：括号深度 + 字符串感知的容错增量解析器
- `src/components/dsl/MarkdownView.tsx`：math 围栏/行内码渲染（katex 直调）+ pre/table/a/code 全套映射
- `src/components/dsl/ExplainDocView.tsx`：skeletonTail 尾骨架支持
- `src/components/dsl/BlockSkeleton.tsx`（新增）：骨架形状共享
- `src/components/dsl/AskPanel.tsx`：AskBubble memo 化 + 活动气泡平滑 + 粘底滚动容器
- `src/components/BuildProgressPanel.tsx`：改收 raw、内部平滑、骨架区移交文档区
- `src/app/page.tsx`：流式上屏接线（streamDoc + skeletonTail）、AnimatePresence mode="wait" 移除（refine 无空白期交接）

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| pnpm build | ✅ |
| preprocessMath 纯函数（node 直跑） | ✅ `\(...\)`→`math:` 行内码、`\[...\]`/`$$...$$`→```math 围栏、块内 `$` 不被行内规则误伤（掩码生效）、未闭合保持原样、`$100` 货币不转 |
| escapeUnknownTags | ✅ `<think>` 包行内码、`<b>` 白名单保留、代码 span 内 `<x>` 保护不动 |
| hasMath 单向探测 | ✅ |
| parsePartialDoc 算法（等价脚本） | ✅ 5 块按 text→formula→slider→wavePlot→quiz 顺序渐次闭合产出；字符串内嵌引号/花括号/方括号不干扰深度计数；title 在前 103 字符即提取 |
| 浏览器验收（平滑/粘底/流式上屏/refine 交接/公式表格渲染） | 待所有者验收 |

### 实施中发现的问题

- Git Bash heredoc 的反斜杠转义不可靠，首次纯函数测试的 `\(` `\[` 用例实际未进入输入——测试脚本一律用文件写入而非 heredoc 内联
- node 无独立 esbuild（Next 内置打包器不含 CLI），partial.ts 的 zod 依赖无法直接 node 导入，采用算法等价脚本验证 + build 类型检查覆盖；真实 zod 路径由 E2E（done 事件全量校验）兜底
