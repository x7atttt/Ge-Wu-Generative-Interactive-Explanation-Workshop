# 迭代23：讲解跳转、滑块"必须有感"校验、图表类型扩展与不强制生图

> 状态：done
> 创建：2026-10-17
> 关联：2026-10-16-iteration22-roadmap.md（点击分派链路）；2026-10-15 chart yType（同一渲染层）

## 背景

用户实测三条反馈：
1. 点击已讲解概念只加载文档，**不滚动到下方讲解**，感知仍是"没反应"；也没有独立的快捷入口跳到讲解。
2. **参数台"有时候没作用"**：DSL 允许滑块不被任何 `$var` 槽引用（如快排讲解的"划分比例"滑块只驱动公式文字、chart 是静态对比表），拖动在图表上看不到任何变化。
3. **图表太局限**：chartType 只有 bar/line/pie，模型大量产出柱状图；有些概念并不适合图表却也被塞了图。

根因分别：loadDoc 无滚动锚点；schema 只校验"$var 引用已定义滑块"而不校验反向"滑块被引用"；chart 契约类型面窄 + prompt 未给"不生图"的许可。

## ★ User Stories

- 作为学习者，我想点击已讲解概念后页面平滑滚到讲解，并有一个独立快捷按钮随时跳回讲解，以便长页面上不迷失。
- 作为学习者，我想每个滑块拖动都有可见效果，以便参数台值得交互。
- 作为学习者，我想图表类型匹配数据形态（趋势/构成/多维对比/长标签排名），以便图比文字更直观。
- 作为学习者，纯概念/语言类讲解不要硬塞图表，以便阅读节奏紧凑。

## ★ 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 跳转实现 | page 持 `docAnchorRef` 包住讲解区；`loadDoc` 完成后与 `runGenerate` 启动后 smooth 滚动 | 生成/打开/补练三条路径全覆盖；refine 在页底无需滚 |
| 快捷入口 | 概念地图头部加「⤓ 讲解」按钮（仅当前有已加载讲解时显示） | 独立于概念点击的回看入口，满足"另外的快捷按钮" |
| 滑块有感 | schema superRefine 新规则：每个滑块 var 必须被 ≥1 个 `$var` 槽（wavePlot terms / chart data）引用，否则报 issue | 走既有自修复管线（dsl/generate.ts 校验失败带错误重试一次），模型被强制绑定或删滑块 |
| 图表类型 | chartType 扩 `area`（面积趋势）/ `hbar`（条形：长标签/排名）/ `radar`（雷达：3~8 维综合对比） | 三者都复用 categories+数值槽结构，$var 绑定与 yLabels/log 语义大部分沿用；scatter 需改数据形状（x,y 对），本次不做 |
| 不强制生图 | prompt 明确"图表只在离散数据对比/规律可视化有益时使用；纯概念/语言/流程主题不硬造图" + 新 chartType 选型行 | 从源头减少无意义柱状图 |
| radar 轴 | indicator 取 categories，max 取各系列该维解析值最大值×1.2（下限 1） | 无显式 max 时 echarts 默认轴不随数据自适应可比性 |
| hbar 轴 | x/y 互换（类目轴在 y），值轴沿用 yType/log 与 yLabels | 长类目名横排可读；语义标签贴值轴 |

### 外部依赖

echarts 按需注册需补 `RadarChart`（echarts/charts）+ `RadarComponent`（echarts/components）；area 复用 LineChart+areaStyle、hbar 复用 BarChart。无新 npm 依赖。

## 边界 case

- (story 2) 补练模式 prompt 本就"除非概念必需不用滑块"，新校验对补练同样生效（有滑块就必须有绑定）。
- (story 3) radar 数据含 0/负值：max 计算 ×1.2 下限 1，不适用 log/yLabels（渲染层忽略）；prompt 注明 radar 用于非负指标。
- (story 1) 生成启动即滚：构建面板挂载有时差，滚动延迟 ~80ms 等 React 提交。
- hbar 多系列仍可用（分组条形）；pie/area/radar 沿用图例与 tooltip 既有配置。

## ★ 验证 seam

- **测试 seam**：单元（schema 校验规则）+ 浏览器渲染（合成文档直插 DB 逐类型目检）+ `tsc`。
- **复用入口**：`validateDoc` 直接 node 冒烟；既有 dev server + 浏览器。
- **新建入口**：无（合成文档插库是一次性验证脚本，跑完清理）。

## 验证方案

- [x] 合成文档：孤儿滑块（无任何 $var 引用）→ validateDoc 报"未被引用"issue；绑定后通过
- [x] 合成文档含 area/hbar/radar 各一（radar 四维全绑 $var）→ schema 通过；浏览器渲染三图正常、拖滑块 k=5→9 雷达"算法A"多边形撑到外圈
- [x] 点击已讲解概念「进程三态与PCB」→ 讲解加载且 scrollY 0→1171 平滑滚到位；地图头部「⤓ 讲解」按钮点击同样滚到讲解区
- [x] prompt 更新生效性（新生成讲解不再硬塞图表）——交用户后续生成抽查
- [x] `pnpm exec tsc --noEmit` 通过

## ★ 实测结果

### 改动清单

- `lib/dsl/schema.ts`：chartType 扩 area/hbar/radar；superRefine 增"滑块必须被 ≥1 个 $var 槽引用"（收集 referenced 集合，违规报 issue 走既有自修复）
- `components/dsl/ChartView.tsx`：radar 分支（indicator=categories、max=各系列解析值×1.2 下限 1）；bar/line/area/hbar 共用笛卡尔轴（area=line+areaStyle 0.16；hbar 轴向互换+标签限宽 118 换行不截断）；图例配置提取复用
- `components/useEChart.ts`：补 RadarChart/RadarComponent 按需注册
- `lib/llm/prompts.ts`：chartType 六型选型指引；"图表不是必需品"选型规则；滑块必须被引用（生成与 refine 双侧）
- `app/page.tsx`：docAnchorRef 锚点包裹讲解区；runGenerate 启动与 loadDoc 完成后 smooth 滚动；SpaceMapPanel 传 hasDoc/onJumpToDoc
- `components/SpaceMapPanel.tsx`：头部「⤓ 讲解」快捷跳转按钮（有已加载讲解时显示）

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| schema 冒烟（孤儿滑块报错/绑定+三新类型通过/旧类型回归） | PASS ×3（node --experimental-strip-types 直跑 validateDoc） |
| 合成文档渲染（视觉模型目检截图） | area 填充/图例 ✓；hbar 首版标签截断→改 118 换行后两行完整 ✓；radar 蛛网/双多边形/图例 ✓ |
| 滑块联动（k=5→9） | 雷达算法A四维撑满外圈、参数台显示 9.0 ✓ |
| 跳转（概念点击/⤓ 讲解按钮） | scrollY 0→1171 双路径生效 ✓ |
| tsc | 通过 |

### 实施中发现的问题

- hbar 长中文标签首版 width 96+truncate 会截断成省略号——改 width 118 + overflow "break"（两行换行）+ interval 0，视觉复核完整可读。
- 移动端参数台（lg:hidden）与桌面侧栏滑块同时在 DOM，测试定位需按可见性过滤——产品本身无碍。
- 合成验证文档（doc 51）验证完已从库中删除。

## 不在本次范围（Out of Scope）

- scatter（需 x,y 对数据形状）、热力图、3D
- 地图概念点击后的面包屑/返回顶部
