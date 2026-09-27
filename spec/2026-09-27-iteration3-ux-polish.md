# 迭代 3：构建过程体验友好化 + 追问 Markdown 渲染

> 状态：implementing（2026-09-27 所有者确认范围：原始流默认折叠保留；URL hash 分享延后）
> 创建：2026-09-27
> 关联：`2026-09-24-iteration2-streaming-interactivity.md`

## 背景

迭代 2 实测暴露两个体验问题：
1. 生成/改造等待期间展示原始 JSON 流，对普通用户是无意义噪音（所有者实测反馈"不友好"）
2. 追问面板回答含 markdown 语法（`**加粗**`、列表），AskPanel 以纯文本渲染未转译

## User Stories

- 作为学生，我想在等待时看到讲解被逐块"搭"起来（块清单点亮 + 骨架卡片），而非原始代码
- 作为评委/极客用户，我想在需要时展开原始构建流查看 AI 协同过程（默认折叠）
- 作为学生，我想追问回答里的加粗、列表、行内代码被正确渲染

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 进度感知形态 | 实时块清单 + 骨架屏（正则增量解析累计文本） | 解析成本 KB 级正则重扫，无性能问题；视觉上有"被搭建"的叙事感 |
| 块序列检测 | 匹配 `"type":"(text\|formula\|slider\|wavePlot\|chart\|quiz)"` | DSL 中 `"type"` 仅出现在块级；terms/series/VarRef 无该字段 |
| 标题检测 | 匹配完整闭合的 `"title":"…"`（含转义处理）后才显示 | 避免流式截断的乱码标题 |
| 原始流 | 保留，默认折叠为"查看原始构建流"开关 | 所有者决策：演示 AI 协同过程的评分素材 |
| Markdown 渲染 | react-markdown 10.1.0 + remark-gfm 4.0.1（无 peer 告警） | 生态标准、默认不执行 HTML 安全；手写 components 样式映射，不引 typography 插件 |
| 渲染降级方案 | 若与 React 19.3 冲突则自写 md-lite（加粗/列表/行内代码） | 已核验无冲突，此方案仅记录不启用 |

### 外部依赖

- react-markdown 10.1.0、remark-gfm 4.0.1（pnpm 安装无 peer 告警，2026-09-27）

## 边界 case

- 流式中途的半截块（`"type":"sl`）→ 正则只匹配完整字面量，未完成不点亮
- 回答为纯文本（无 md 语法）→ MarkdownView 正常渲染为段落
- 解析不到任何块（模型先输出思考文字）→ 清单为空，仅显示 spinner 与"正在构建"，骨架区不显示

## 验证 seam

纯前端改动，验证 = `pnpm build` + 浏览器手动验收（无需 LLM 冒烟调用，流式协议未变）。

## 验证方案

- [ ] build 通过
- [ ] 生成时：标题出现 → 块清单逐项点亮（最新项闪烁）→ 对应形状骨架卡片出现
- [ ] 「查看原始构建流」默认折叠，展开可滚动查看，可再收起
- [ ] 取消按钮可用（沿用）
- [ ] 追问回答中的加粗/列表/行内代码正确渲染

## 不在本次范围

URL hash 分享（延后）、音效、流式协议与后端改动。

## 实测结果

### 改动清单

- `src/components/BuildProgressPanel.tsx`（新增）：正则增量解析 + 块清单 + 骨架屏 + 折叠原始流
- `src/components/dsl/MarkdownView.tsx`（新增）：react-markdown 轻量样式映射
- `src/components/dsl/AskPanel.tsx`：回答气泡改用 MarkdownView
- `src/app/page.tsx`：移除内联旧面板，接入 BuildProgressPanel（generate/refine 两处）
- 依赖：react-markdown 10.1.0、remark-gfm 4.0.1（无 peer 告警，已登记 reference.md）

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| pnpm build | ✅ 通过 |
| 依赖 peer 兼容（React 19.3） | ✅ pnpm 安装无告警 |
| 浏览器验收（清单点亮/骨架/折叠原始流/markdown 渲染） | 待所有者验收（纯前端改动，流式协议未动，服务端冒烟不适用） |
