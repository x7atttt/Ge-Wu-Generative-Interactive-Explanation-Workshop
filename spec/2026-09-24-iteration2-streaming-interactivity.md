# 迭代 2：流式生成体验 + 交互能力扩展（chart/quiz/追问）

> 状态：implementing（2026-09-24 与所有者对齐范围：A+B 全做，流式展示用构建流面板）
> 创建：2026-09-24
> 关联：`2026-09-24-mvp-scope.md`、`2026-09-24-dsl-schema-v0.md`

## 背景

MVP 实测（正弦波/傅里叶概念生成正常）暴露四个问题，均有实测依据：
1. 生成超 60 秒：非流式架构下用户全程盯空白等待；校验失败触发自修复使耗时翻倍；120s 整体超时过紧
2. refine 的参数级指令（"把振幅固定为 2"）无价值——拖滑块即可达成，且改造同样慢
3. 输入"柱状图是什么"超时：DSL v0 仅有波形图，非波形概念导致模型反复失败修复直至超时（echarts 已安装但未启用）
4. 表现力平：视觉与交互形态单一，缺少"记忆点"

## User Stories

- 作为学生，我想点生成后 3 秒内看到 AI 的构建过程在滚动，以便不再对着空白等待
- 作为学生，我想随时取消一次生成/改造
- 作为学生，我想拖滑块时公式里的数字同步变化，以便把参数与公式符号对应起来
- 作为学生，我想让非波形概念（柱状图、统计）也能生成交互讲解，以便工具覆盖更多学科
- 作为学生，我想在讲解尾部做交互自测题，以便检验是否真的理解
- 作为学生，我想针对当前讲解追问（"为什么振幅按 1/n 衰减"），以便深入理解而不重生成整篇
- 作为系统，我要让追问/改造走更快的模型，以便轻量操作不被慢模型拖累

## 目标 / 非目标

**目标**：SSE 流式三端点（generate/refine/ask）、双模型回落（LLM_MODEL_FAST）、提示词瘦身、wavePlot live 公式、chart 块（bar/line/pie）、quiz 块、追问面板、refine 示例重定位、视觉打磨。

**非目标**：scatter 图（数据为坐标对时 LLM 生成错误率高，待有真实概念需求再加）、音效（已定案暂缓）、持久化/分享、多轮 refine 上下文记忆（每次仍基于当前文档）。

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 流式协议 | SSE，事件 `{type:"delta"\|"done"\|"error"}`，`data:` 行 | 浏览器原生支持，fetch reader 解析简单；校验错误(400)仍走普通 JSON 响应，前端按 res.ok 分流 |
| 超时策略 | 流式路径用**空闲 60s** 计时器（每个 chunk 重置），不再整体超时 | 整体超时与流式矛盾；空闲检测防挂死 |
| 校验时机 | 流完再走原有 提取→校验→自修复；自修复调用保持非流式 | JSON 必须完整才能校验；修复是罕见路径不值得流式复杂度 |
| 双模型 | `LLM_MODEL_FAST` 可选环境变量，未配置回落 `LLM_MODEL`；refine/ask 用 fast，generate 用主模型 | 轻量操作延迟敏感；回落保证零配置可用 |
| live 公式 | 渲染层由 terms+当前值拼 LaTeX（`y = 1.00\sin(2\pi\cdot 2.30x + 0.00)`），KaTeX 重渲 | 纯确定性渲染，零提示词风险，schema 不动 |
| chart 块 | `chartType: bar\|line\|pie`，`series[].data` 为数值槽数组（可绑滑块）；echarts/core 按需注册 | 覆盖非波形概念；数据绑滑块保留"可玩"性 |
| quiz 块 | 单选 + answer 下标 + explanation；top-level superRefine 校验 `answer < options.length` | discriminatedUnion 成员自带 refine 不便，统一放顶层 |
| 追问 | `/api/ask` 独立端点，纯文本流式回答，不入 DSL、不改变文档 | 问题（"是什么"）与概念（"生成讲解"）分流；会话态仅存前端 |

### 外部依赖

- OpenAI 兼容流式协议：`stream:true` + `data:` SSE 增量 + `[DONE]` 哨兵（各兼容厂商通用约定）
- echarts 6.1.0 `echarts/core` 按需注册（已安装）

## 边界 case

- (story 1) 厂商不支持 stream+json_object 组合 → 首调即报错：SSE error 事件透出信息并提示尝试关闭 json 模式或换模型（记录于错误信息，暂不做自动降级）
- (story 2) 前端取消：AbortController abort → reader cancel，服务端流随之中断
- (story 4) pie 图无坐标轴/categories → ChartView 按 chartType 分支构建 option；categories 与 series.data 长度不一致时按 echarts 默认行为（缺项为空）
- (story 5) quiz answer 越界 / options 少于 2 项 → 校验拒绝
- (story 6) 追问问题 >300 字 → 400；文档非法 → 400
- 流式中途连接断开 → 前端捕获异常展示"连接中断，可重试"

## 验证 seam

无测试框架，验证 = `pnpm build` + dev 冒烟（SSE 无 key 错误路径、400 路径）+ 下方手动验收清单。

## 验证方案

- [ ] build 通过
- [ ] 点生成 3 秒内构建流面板出现滚动内容；可折叠；取消按钮立即中断
- [ ] 拖滑块时 wavePlot 上方公式数字即时同步
- [ ] 输入「柱状图」→ 生成含 chart 块的讲解（不再超时）
- [ ] 生成「傅里叶级数」→ 尾部出现 quiz，点选有正误反馈与解答
- [ ] 追问「为什么振幅按 1/n 衰减」→ 流式短回答
- [ ] 未配 LLM_MODEL_FAST 时追问/改造自动回落主模型（日志可证）
- [ ] refine 示例 chips 为内容级操作

## 不在本次范围

scatter 图、音效、TTS、历史/分享、多轮上下文、移动端深度适配。

## 实测结果

### 改动清单

- `src/lib/llm/`：client 增加 streamChat（SSE 增量 + 空闲 60s 计时）、双模型回落；prompts 瘦身并新增 chart/quiz 规则与 ask 助教
- `src/lib/dsl/`：schema 新增 chart/quiz 块与全局校验；generate 管线支持流式回调与 askQuestion
- `src/app/api/`：generate/refine 改 SSE（delta/done/error 协议），新增 /api/ask
- `src/lib/api/`：SSE 服务端构造器 + 前端流式客户端（可中断）
- `src/components/dsl/`：ChartView（echarts 按需）、QuizView、WavePlot live 公式、AskPanel、BlockRenderer 注册
- `src/app/page.tsx`：构建流面板（可折叠/取消）、refine 重定位为内容级、视觉打磨

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| pnpm build | ✅ 通过（/ 静态 + 三动态路由） |
| GET / → 200 | ✅ |
| generate 空概念 → 400 | ✅ |
| ask 非法文档 → 400 | ✅ |
| E2E：概念「柱状图」（原超时场景） | ✅ HTTP 200，49.6s，593 个 SSE delta；产出 blocks：text, formula, slider×3, chart/bar, text, quiz×2 |
| E2E：ask 追问「饼图和柱状图分别适合什么场景」 | ✅ HTTP 200，9.8s，121 个 delta，回答引用文档图表数据（咖啡/奶茶/果汁） |
| 浏览器交互（面板 3 秒滚动感、取消、live 公式同步、quiz 点选） | 待所有者手动验收（服务端链路已全部验证） |

### 实施中发现的问题

- Git Bash 的 `/tmp` 与 Windows 原生 node 路径映射不一致，冒烟脚本临时文件改放项目目录后删除
- ask 未配 LLM_MODEL_FAST 时回落主模型，延迟仍可控（9.8s），因为输出为短回答而非整篇文档
