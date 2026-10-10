# 迭代 11：助手人设/语气

> 状态：done
> 创建：2026-10-10
> 关联：spec/2026-09-24-mvp-scope.md（提示词契约）、迭代 12（共用 personaStyle 管线）

## 背景

生成与追问的文字风格固定为单一"讲解设计师/助教"语气，用户无法按受众或场景调整（给小白讲、备考冲刺、轻松学）。所有者路线规划（2026-10-10 批准）将其列为迭代 11。

诚实定位（依据 reference.md 教学代理元分析条目）：pedagogical agent 整体小幅有益（Castro-Alonso et al. 2021），但 persona 本身对学习结果影响弱且不一致（Schroeder et al. 2014）——本功能定位 **UX/动机层亮点**，不作教学法核心主张。

## User Stories

- 作为终端用户，我想从几个预设人设中选择讲解与追问的语气（严谨学者/轻松伙伴/费曼·讲给小白/备考冲刺），以便匹配我的学习场景。
- 作为终端用户，我想用一句话自定义人设，以便表达预设外的需求。
- 作为终端用户，我想让人设选择被记住（localStorage），下次打开不用重设。
- 作为系统，人设只影响文字风格，不突破块结构约束（zod 校验兜底不变）。

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 状态归属 | 客户端 localStorage，随请求体发给服务端（无服务端会话） | 服务端保持无状态，可复现性好；切人设即时生效 |
| 注入位置 | 生成：通用要求追加"行文人设：…（块结构要求优先）"；追问：system 追加"回答语气：…" | 明确风格不越权结构 |
| 作用域 | 生成 + 追问；**refine 不接** | 深化要保持与原文档风格一致，中途换人设会撕裂文档 |
| 预设集 | 默认（不注入，保持既有行为）+ 4 预设 + 自定义（≤100 字） | 默认即关闭，零成本回落 |
| 输入信任 | personaStyle 服务端截断 100 字 | 本地个人工具，客户端文本按提示词输入对待 |

## 边界 case

- (story 3) localStorage 损坏 JSON → try/catch 忽略回落默认
- 自定义人设空文本 → resolvePersonaHint 返回 null（等同默认，不注入）
- SSR/客户端不一致 → localStorage 读取放 useEffect（挂载后），首帧均为默认值
- (story 4) 人设不影响结构校验路径——自修复与 zod 兜底不变

## 验证 seam

- **测试 seam**：提示词纯函数（node 直连 import）+ HTTP 层真实 E2E
- **复用入口**：dev server curl 冒烟
- **新建入口**：无

## 验证方案

- [x] 提示词变体 9 项（normal/practice/persona×generate/ask 注入与缺省不注入）
- [x] E2E 人设追问：小白+生活类比人设 → 回答用秋千/帧率类比、语气口语化，3.5s
- [x] E2E 人设生成：勾股定理 + 零基础人设 → 首段铺瓷砖类比开场，13.1s
- [x] `pnpm build` 通过
- [ ] 浏览器手动：选择器切换/自定义输入/localStorage 记忆（待所有者验收）

## 不在本次范围

refine 接人设、人设影响练习题措辞、多轮人设记忆。

## 实测结果

### 改动清单

- `src/lib/persona.ts`（新增）：预设/自定义/存储键/resolvePersonaHint
- `src/lib/llm/prompts.ts`：generateSystemPrompt 参数化（GeneratePromptOpts：personaStyle + practice）、askSystemPrompt(personaStyle)
- `src/lib/dsl/generate.ts`：generateDoc 改 extras 对象（refs/personaStyle/practiceLines）；askQuestion 增 personaStyle
- `src/lib/api/explanation.ts`：streamAsk 透传 personaStyle
- `src/app/api/generate|ask/route.ts`：读取 personaStyle（截断 100）注入
- `src/app/page.tsx`：人设状态 + localStorage 读写 + chips 行右组选择器（自定义输入框按需出现）
- `src/components/dsl/AskPanel.tsx`：personaStyle prop → streamAsk

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| 提示词 9 项变体 | 全 PASS |
| E2E 人设追问（doc28） | 类比与口语化明显，3.5s |
| E2E 人设生成（勾股定理） | 铺瓷砖类比开场，13.1s |
| build | 通过 |

### 实施中发现的问题

- 嵌套模板字面量闭合时误转义了本应关闭嵌套模板的反引号（practice 分支引入），Turbopack 报语法错——修复后以 node 直连 import 验证全部提示词变体，此法以后作为提示词改动的前置检查。
