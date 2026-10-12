# chart 语义纵轴 yLabels + 资料解析进度显示

> 状态：done
> 创建：2026-10-12
> 关联：spec/2026-10-12-iteration14-doc-import.md（chart 图例/进度均为其使用反馈）

## 背景

用户用真实 PDF（排序，20,730 字）生成讲解后提出两点：①复杂度量级对比图纵轴显示"数量级 4"这类数字，希望直接显示 O(n²) 记号；②资料解析期间只有静态"解析中…"，无进度感。

## ★ User Stories

- 作为终端用户，我想让数值纵轴显示语义标签（复杂度记号/等级），以便不看图例就懂刻度含义。
- 作为终端用户，我想在资料解析中看到进度（页数或耗时），以便确认没有卡死。

## ★ 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 纵轴语义化方式 | chart 块新增可选 `yLabels: Record<string,string>`（key=刻度数值），渲染层 `yAxis.axisLabel.formatter` 按 `String(value)` 替换，未命中回落数字 | 数值轴保序可比（排序/比较语义），只在显示层换文字；ECharts 原生支持 formatter。改类目轴（yAxis type category）会丢数值语义，不取 |
| 标签宽度 | 有 yLabels 时 grid.left 44→76 | "O(n·log n)" 等长标签防截断 |
| 提示词 | 生成/改造两处 chart 描述同步加 yLabels 用法与示例 | 文件头约定 schema 描述双处同步 |
| 进度数据源 | MinerU 轮询结果 `extract_progress{extracted_pages,total_pages}` → sources 新列 `progress`（如 "3/12 页"），懒同步时写入，终态清空 | 数据官方文档已列（iteration14 spec 外部依赖节），此前抓取后被丢弃 |
| 无页数进度兜底 | 面板由 createdAt 推算显示已耗时（随 4s 轮询刷新） | 实测小任务 MinerU 可能不报页数进度（直达 done），耗时让"解析中"有生命感 |
| 迁移 | getDb 幂等 `ALTER TABLE sources ADD COLUMN progress` + 对运行中实例直接在线补列 | 连接是 globalThis 单例，运行中的 dev server 不会重跑建表；WAL 允许跨进程 ALTER |

## 边界 case

- (story 1) yLabels 有值但刻度未命中 → 显示原数字（0/1 落空正常）
- (story 1) pie 图无纵轴 → yLabels 忽略（仅 bar/line 轴生效）
- (story 2) extract_progress 缺失/totalPages 为 0 → 不写 progress，仅耗时兜底
- (story 2) 终态（ready/error）写入时 progress 清空；并发轮询重复写 progress 无害（同值幂等且仅 parsing 行）

## 验证方案

- [x] 深化指令让 LLM 给复杂度图加 yLabels → 输出含 `{"2":"O(n)","3":"O(n·log n)","4":"O(n²)"}`，另一张真实数值图不加（判断正确）
- [x] 浏览器渲染：纵轴显示 O(n²)/O(n·log n)/O(n)，未映射刻度回落数字，无截断
- [x] 在线补列后运行中的 :3000 GET /api/sources 正常（progress 字段返回）
- [x] 真实 PDF（自造 8 页）导入 → parsing → 16s ready（806 字）；本例 MinerU 未报页数进度 → 耗时兜底路径生效
- [x] tsc --noEmit 全绿

## 不在本次范围

上传阶段（浏览器→本地服务）的分块进度（fetch 无 upload progress 事件，且本地传输秒级）；yLabels 用于横轴（横轴本就是类目文本）

## ★ 实测结果

### 改动清单

- `schema.ts` chart 块 +yLabels；`ChartView.tsx` yAxis formatter 与左边距；`prompts.ts` 生成/改造两处 chart 描述同步
- `db/index.ts` sources +progress 列（建表与幂等迁移）；`db/sources.ts` 摘要透出/终态清空/setSourceProgress；`api/sources/route.ts` 懒同步写页数进度；`lib/api/sources.ts` 类型；`SourcesPanel.tsx` 进度+耗时显示

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| doc 37 深化（指令：纵轴换复杂度记号） | ✅ doc 38 chart0 得 yLabels 三档映射，chart1（真实操作次数）未加 |
| IAB 截图目检 | ✅ 纵轴 O(n²)/O(n·log n)/O(n)/1/0（未命中回落），标签完整无截断 |
| 在线补列（node:sqlite 跨进程 ALTER） | ✅ 运行中 :3000 立即可用，无需重启 |
| 8 页自造 PDF 真实解析 | ✅ 16s ready 806 字；期间 MinerU 未报页数（progress 空），耗时兜底显示路径成立 |
| tsc | ✅ 0 错误 |

### 实施中发现的问题

1. **Next dev 同目录拒绝第二个实例**（"You can access the existing server at :3000"）：起 :3210 测试服务器失败 → 改为在线补列 + 直接对用户运行中的 :3000 验证（HMR 已加载新代码，仅 DB 连接单例缺新列，在线 ALTER 解决）。
2. MinerU `extract_progress` 并非必报：小任务轮询间隙直达 done。代码在有值时写页数，无值时前端耗时兜底，两条路径都已覆盖。
