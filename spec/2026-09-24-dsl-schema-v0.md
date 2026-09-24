# DSL Schema v0：ExplainDoc 数据契约

> 状态：implementing
> 创建：2026-09-24
> 关联：`2026-09-24-mvp-scope.md`、`../reference.md`（依赖登记）

## 背景

DSL 是生成层（LLM）与渲染层（React 组件）之间的唯一契约。契约不稳定，两边无法并行演进；契约不设防，渲染层会收到坏数据。v0 用最小组件集跑通链路，但版本字段与注册表模式从第一天就位，保证后续只增不改。

## 方案

### 决策表

| 决策点 | 选择 | 理由 |
|---|---|---|
| 顶层结构 | `{ version: 1, title, blocks: Block[] }` | version 字段是向前兼容的锚点：未来新字段/新块类型靠它路由解析策略 |
| 块类型 | 判别联合（discriminated union on `type`） | zod 与 TS 双侧自动窄化；新增类型不破坏旧分支 |
| 参数绑定 | 数值槽 `number \| { $var: string }`，`$var` 必须指向某个 slider 块定义的变量 | 声明式绑定，无表达式求值 → 无注入面；渲染层 O(1) 解析 |
| 波形语义 | `y = Σ term_i`，每项 `amp · fn(2π·freq·x + phase)`，`fn ∈ {sin, cos}` | 覆盖频率/振幅/相位/傅里叶叠加全部 MVP 演示场景 |
| 变量唯一性 | slider 的 `var` 全文档唯一，由 superRefine 全局校验 | 防止 LLM 生成同名滑块互相覆盖 |
| 引用完整性 | 所有 `$var` 引用必须存在已定义变量（superRefine） | 把"运行时 undefined"消灭在校验层 |
| 容错默认值 | term 的 amp/freq/phase 带默认值（1/1/0） | LLM 省略字段时 lenient 收敛而非硬拒 |
| LaTeX 失败降级 | 渲染层 `throwOnError:false`，失败显示原始串 | 单块渲染失败不拖垮整篇文档 |

### Schema 片段（决策密集处，实现以 `src/lib/dsl/schema.ts` 为准）

```ts
VarRef    = { $var: string }
NumberSlot = number | VarRef

Block =
  | { type: "text",     content: string }
  | { type: "formula",  latex: string, caption?: string }
  | { type: "slider",   var: string, label: string,
      min: number, max: number, step: number, initial: number }
  | { type: "wavePlot", title?: string, xLabel?: string, yLabel?: string,
      terms: { fn: "sin"|"cos", amp?: NumberSlot,
               freq?: NumberSlot, phase?: NumberSlot }[] }

ExplainDoc = { version: 1, title: string, blocks: Block[] }
```

### 扩展点（后续演进路径，均不动核心）

- 新块类型（echarts 图、音频组件 `AudioOscillator`/`AudioMixer` 已预留位）：schema 加联合分支 + 注册表加一项 + 实现组件
- `wavePlot` 求值器如需表达力扩展（如多项式项），新增 term 形态而非引入自由表达式解析
- LLM 输出质量升级：prompt 中 schema 描述与 zod schema 单点同步（prompts.ts 引用 schema 生成的说明，不手抄两份）

## 边界 case

- slider `min >= max` → 校验拒绝（信息含变量名）
- VarRef 指向不存在的变量 → 校验拒绝（信息含引用位置）
- 滑块变量重名 → 校验拒绝
- `initial` 越界 → 不拒，渲染层浏览器 range 语义夹紧（与 MVP spec 一致）
- blocks 为空 / title 为空 → 校验拒绝

## 验证方案

- [ ] schema 单元行为随 `pnpm build` 类型检查 + 生成管线实测覆盖（测试框架引入后补正式用例）
- [ ] 手动：构造非法文档（未定义变量/重名/空 blocks）经 `/api/refine` 提交 → 400 且错误信息含具体字段

## 不在本次范围

自由表达式求值器、多变量（x 之外的自变量）、动画编排进 DSL、块间条件显隐。

## 实测结果

（done 时填写）
