<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 格物（Gewu）项目协作规范

> **格物 —— 生成式交互讲解工坊**：输入任意抽象概念，AI 现场生成带滑块/拖拽的交互式可视化讲解，且支持生成后对话式改造。
> 赛道：传智杯 AI 创新应用挑战赛（Vibe Coding）· B 组 · 个人赛。**省赛提交截止 2026-11-18。**
> 参考资料与外部依赖统一登记在仓库外层 `../reference.md`（新增任何参考/依赖必须登记并注明"参考了什么"）。

## 技术栈（已锁定，勿擅自升级）

| 层 | 选型 | 锁定版本 |
|---|---|---|
| 框架 | Next.js（App Router，Turbopack） | 16.3.6 |
| UI 运行时 | react / react-dom | 19.3.0 |
| 语言 | TypeScript | ~5.9（暂不升 7.x，周边生态未跟上） |
| 样式 | tailwindcss + @tailwindcss/postcss | 4.3.3 |
| 动效 | motion | 13.4.1 |
| 数学可视化 | mafs | 0.21.0 |
| 沙箱 | @codesandbox/sandpack-react（仅高级模式页动态 import） | 2.20.0 |
| 公式 | katex（自研薄封装，**禁用 react-katex**） | 0.18.9 |
| 图表 | echarts/core 按需注册（自研 hook 封装，**禁用 echarts-for-react**） | 6.1.0 |

包管理器 pnpm（10.x）。Node >=20.9（本机 24 LTS）。新增依赖前必须核对 peer 依赖与 React 19.3 兼容，并在 `../reference.md` 登记。

## 常用命令

```shell
pnpm dev      # 开发
pnpm build    # 生产构建（含类型检查），提交前必跑
pnpm lint     # ESLint
```

## 开发准则

1. **编码前先思考**：动手前把需求复述为一句最小验收标准；显式陈述假设，不确定就问；存在多种解读时摆出来，不要静默选择。
2. **简洁优先**：用最少代码解决问题。不做投机性设计，不为一次性代码造抽象，不做未要求的"灵活性"。自问："资深工程师会说这过度复杂吗？"
3. **外科手术式改动**：只动必须动的地方。不顺手改邻近代码/注释/格式，不重构没坏的东西，匹配既有风格。发现无关死代码提一句但不删。判据：每行改动都能追溯到需求。
4. **目标驱动执行**：任务先转成可验证目标（"修 bug"→"写复现测试再让它通过"）。多步任务给计划：`步骤 → 验证：检查点`。

## 开发与调试工作流

1. 开发完成后按改动范围执行 **检查 → 测试 → Lint**：`pnpm build`（含类型检查）必跑；涉及 API 路由时补跑接口级验证；测试框架（计划 Vitest）引入后，相关测试必跑且提交前全绿。
2. 测试统一放 `test/` 目录。框架未引入前，不得以"已测试"表述未验证的代码。
3. **禁止用过度防御/回退掩盖设计缺陷**：软件应在预设条件下运行，其余情况及时暴露错误并修复，不加冗余兜底。

### 需求沟通规范

需求不明确时主动对齐验收标准、优先级和范围。改动较大的功能，先在 `spec/` 目录创建带日期的文档（目标、需求细节、验收标准、简要 checklist），**入库并随实现更新**——比赛评审要看到过程链路，与通用项目把 spec gitignore 的做法相反。

## Git 与比赛合规（硬性）

- **细粒度提交**：每个功能模块 / 每次核心 AI 对话迭代对应一次 commit，禁止"一次性提交全部功能"（比赛明令，违规直接扣可复现性分）。
- Commit message 用 conventional 前缀 + 中文描述（如 `feat: DSL 渲染器首版`）。
- **核心 Prompt 链归档**：重要迭代的 Prompt→AI 修改→引导修复过程，沉淀到 `spec/prompt-chains/`，供演示视频与技术文档引用。
- **禁止包装开源项目**：bolt.diy 等只允许借鉴架构思路，不 fork、不搬运代码。自研核心 = DSL schema + 生成流水线 + 质检门 + 对话式改造循环。
- README 目标：**新环境 10 分钟可复现**（环境配置、依赖清单、`.env.example` 模板）。

## 目录结构规划

```
src/
  app/            # 路由与页面（API 路由在 src/app/api/）
  components/
    dsl/          # 自研 DSL 渲染组件（核心资产，逐个实现）
    ui/           # 通用 UI 组件
  lib/
    api/          # 前端 API 调用集中定义
    dsl/          # DSL schema 定义与校验（核心资产）
    audio/        # Web Audio 封装（音效方案已定案、暂缓实施）
spec/             # 需求文档 + prompt 链归档（入库）
test/             # 测试（框架引入后）
```

## 前端开发规范

- 所有 API 调用集中在 `src/lib/api/` 定义，不在组件里散落 fetch。
- **动效原则**：直接操作（拖滑块）必须 1:1 即时跟手，不加动画；motion 的 spring 只用于离散状态切换、组件进出、步骤编排。
- Mafs 需引入 `mafs/core.css`；注意 Tailwind v4 preflight 不覆盖 Mafs 的 SVG 样式。
- echarts 用 `echarts/core` 按需注册，控制包体积；Sandpack 只在高级模式页动态 import，不进首屏 bundle。
- 音效（UI 反馈音 + 数据可听化两档）为已定案设计、暂缓实施：DSL schema 设计时预留 `AudioOscillator` / `AudioMixer` 组件位，但不实现。
- 拆函数必须服务于复用、隔离副作用或降低认知负担；遵循向下规则：公开的高层方法在文件顶部，细节逐层下沉。

## 环境与安全

- 密钥（LLM API key 等）只放 `.env.local`，禁止入库、禁止出现在回复、日志、测试或注释中。
- 注释与代码同入库：不得在注释里暴露密钥，不得引用 gitignore 文件的内容。

## 代码注释规范

- 注释解释**为什么**而非"做了什么"——只补代码看不出的设计意图、踩坑点、约束边界。
- 不复述代码；一句话能说清不写三句；改了行为同步改注释，过时注释比没注释更坑。
- 包/函数/行内注释分层，高层次意图放上层。

## 代码 Review 顺序

1. 先确认基本功能可用、主路径与关键场景验证清楚；
2. 再看方案是否是当前上下文最优解；有更简但改动面更大的方案时，先说明取舍再动手；
3. 检查过度设计（无关功能）、过度防御（兜底掩盖设计问题）、过度嵌套（helper 过多、调用链绕）；
4. 评估测试价值：只"给出靶子后评估靶子"的低价值测试建议清理，保留验证真实行为与回归风险的。
