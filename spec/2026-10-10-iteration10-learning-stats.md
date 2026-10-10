# 迭代 10：学习历程埋点 + 统计仪表盘

> 状态：done
> 创建：2026-10-10
> 关联：spec/2026-09-28-iteration8-interaction-typing.md（练习块——本迭代的数据来源）、spec/2026-09-27-iteration4-persistence.md（DB 惯例）

## 背景

产品主线已闭环到"讲解 → 练习（quiz/填空/配对/分类）"，但练习判定是纯客户端状态，检查后即丢弃——用户学完即走，没有记录、没有复盘，"学习纵深"缺失（所有者原话："当前应用内容单薄"）。根因：练习行为不落库，统计无从谈起。

路线定位（所有者已批准）：从「一次性生成工具」升级为「学习闭环系统」——讲解 → 练习 → **记录 → 复盘** → 再生成（迭代 12 补练收口）。

## User Stories

- 作为终端用户，我想看到累计学习概念数、练习次数、总正确率、连续学习天数，以便掌握自己的学习全貌。
- 作为终端用户，我想看到近 14 天练习量与正确率趋势、按题型的正确率，以便发现薄弱题型。
- 作为终端用户，我想看到正确率低于 60% 的弱项概念清单，以便决定复习什么（迭代 12「针对性补练」的入口铺垫）。
- 作为系统，我想在练习判定时静默记录（docId/题型/对错/时间），且上报失败绝不打断练习交互。
- 作为终端用户，我在流式生成期和未落库文档里的练习不应产生记录（无归属文档）。

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 记录粒度 | 每次"检查/判定"一条（含重做），correct = 本次判定全对/选对/一次通过 | 反映真实使用频率；正确率按次；避免逐空细粒度的表膨胀 |
| 埋点通道 | React Context（page 提供 docId + report）+ fire-and-forget fetch | 组件不逐层传 prop；Provider 缺失（流式期/未落库）天然不上报；上报失败静默 |
| 时间口径 | attempts.created_at 用 `datetime('now','localtime')`（库内其余表沿用 UTC） | 统计按"天"聚合，本地日界才正确；仅此表面向按日分组，不动既有表 |
| 聚合位置 | 服务端 SQL 聚合（GET /api/stats 一次返回全部） | 仪表盘打开即取即渲染；14 天序列空日在服务端补齐 |
| streak 口径 | 从今天（或昨天）向前数有记录的连续天；今天未练不打断 | 与习惯类产品一致，避免"今天还没练就清零"的挫败感 |
| 弱项阈值 | 正确率 <60% 且样本 ≥3 | 单次对错不构成"弱项"结论，防噪声 |
| 图表渲染 | 复用讲解图表的 ECharts 按需注册（useEChart 抽为共享 hook） | 用产品自己的图表能力渲染自己的学习数据——演示自证点；零新增依赖 |

### 外部依赖

无新依赖。教学依据（登记 reference.md）：学习分析仪表盘研究——Ramaswami et al. 2023（仪表盘显著提升参与，96+ 引）；Duan et al.（可行动反馈促进自主调节学习）。

## 边界 case

- (story 4) 上报 fetch 失败/路由 400 → catch 静默，练习交互不受影响
- (story 5) 流式生成期（streamDoc 视图）与 docId 为 null → Provider 不提供，组件 `attempt?.` 短路
- (story 1) 库无任何记录 → 空态文案引导（不渲染图表）；correctRate 为 null
- 迁移：attempts 为新表，CREATE IF NOT EXISTS 幂等；**运行中的 dev 服务器需重启才会建表**（globalThis 单例缓存旧连接——实测踩坑，见下）
- 14 天窗口内跨月/跨年 → 日序列由 JS Date 推导，无 SQL 日期边界问题

## 验证 seam

- **测试 seam**：HTTP 层（dev server API 真实 E2E：上报 → 聚合）
- **复用入口**：dev server curl 冒烟惯例
- **新建入口**：无

## 验证方案

- [x] POST /api/attempts 非法参数（blockType 越界）→ 400
- [x] 上报 3 条（quiz 对/错、fillBlank 对）→ 聚合全对：练习数 3、正确率 66.7%、今天 3 条 2 对、streak=1、byType 分型正确、概念聚合 join 出 doc 标题
- [x] 空库空态：attemptCount=0 / correctRate=null / byType 空 / daily 仍为 14 天零值序列
- [x] `pnpm build` 通过
- [ ] 浏览器手动：右上角「学习统计」面板打开/关闭/Escape；四类练习各做一次后统计即时反映（待所有者验收）

## 不在本次范围

针对性补练入口（迭代 12）、人设（迭代 11）、复习卡（backlog）、attempts 删除/导出。

## 实测结果

### 改动清单

- `src/lib/db/index.ts`：SCHEMA 增 attempts 表（含双索引）与 localtime 注释
- `src/lib/db/attempts.ts`（新增）：insertAttempt + getStats（KPI/14 天序列/按题型/按概念/streak）
- `src/app/api/attempts/route.ts`、`src/app/api/stats/route.ts`（新增）：上报与聚合路由
- `src/components/dsl/attempt-context.tsx`（新增）：AttemptContext + postAttempt（fire-and-forget）
- 四练习组件（QuizView/FillBlankView/MatchView/SortView）：判定时机上报（选对/检查全对/一次通过/检查全对）
- `src/app/page.tsx`：顶层 useMemo 构造 Provider 值（条件内调 hook 违规，已规避）、文档区包裹 Provider、右上角标签组（统计+历史）
- `src/components/useEChart.ts`（新增，自 ChartView 抽出）：echarts 按需注册 + hook 共享
- `src/components/StatsPanel.tsx`（新增）：KPI + 双轴图 + 题型横条 + 弱项清单 + 空态
- `src/components/DocHistoryButton.tsx`：根元素改 relative（fixed 定位移交页面标签组容器）

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| POST 非法参数 | 400 `{"error":"参数非法"}` |
| 上报 3 条 + 聚合 | 6/6 全 PASS（66.7%、streak=1、概念 join 出"多普勒效应"） |
| 空态 | 14 天零值序列 + null 正确率 |
| `pnpm build` | 通过 |

测试行已清理（DELETE FROM attempts，剩余 0），库还给所有者干净状态。

### 实施中发现的问题

- **运行中 dev 服务器不建新表**：getDb 是 globalThis 单例，SCHEMA 只在首次开库执行——schema 变更后必须重启 dev 服务器，否则 /api/stats 500（no such table）。用户自己的服务器重启一次即可。
- 原型把 useMemo 写进条件渲染 JSX（Hooks 规则违规），改为组件顶层无条件计算。
- node 原生 ESM 无法解析项目内无扩展名相对导入（"./index"），scratch 单测方案放弃，改走 API 全链路 E2E（覆盖面反而更全）。
