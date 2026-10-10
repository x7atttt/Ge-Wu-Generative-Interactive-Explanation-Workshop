# 迭代 9：博查网络检索接地（生成前自动补充事实依据）

> 状态：done
> 创建：2026-10-10
> 关联：spec/2026-09-24-iteration2-streaming-interactivity.md（SSE 事件协议本迭代新增 info）

## 背景

LLM 自身知识对时效性主题（新闻、新版本技术、年度事件）与长尾事实不可靠或缺失，生成的讲解会过时或编造。实测动机：模型对「2025年诺贝尔物理学奖」无法可靠作答。根因：生成管线只有模型参数知识这一个事实来源，没有外部知识通道。

引入博查（Bocha）Web Search API 作为检索源（付费服务，密钥仅在 .env.local）。响应契约依据 2026-10-10 实测样本：Bing 风格 `data.webPages.value[]`，条目含 name/url/snippet/summary（summary:true 时为 AI 摘要）/siteName/datePublished。

## User Stories

- 作为终端用户，我想让时效性/长尾主题的讲解自动引用最新网络资料，以便内容不过时不编造。
- 作为终端用户，我想用生成框旁的开关控制是否联网检索（默认开），以便关心成本或想要纯净生成时可关闭。
- 作为终端用户，我想在构建面板看到"已检索 N 条网络资料"的阶段提示，以便知道检索接地已发生。
- 作为系统，我想让检索的任何失败（无 key/超时/非 200）静默降级为无检索生成，以便增强路径永不阻断主流程。

## 目标 / 非目标

**目标**：
1. 生成路由在 LLM 调用前检索概念，资料以编号列表注入用户消息（不带链接，防模型罗列网址）
2. 提示词规则：事实优先取自资料，资料无关/矛盾时以自身可靠知识为准，不编造
3. 混合开关：默认自动检索，前端开关可关（显式 `webSearch:false` 跳过）
4. 条数策略：请求 count=8，注入前 6 条；每站点（归一化 host，去 www./m. 前缀）最多 2 条；跨站同标题去重
5. SSE 新增 `info` 事件类型，构建面板显示检索提示

**非目标**：ask 追问与 refine 深化不接检索（追问保 fast 模型低延迟、深化指令通常基于已有内容）；检索结果的网页原文抓取与引用脚注 UI；LLM 自判是否检索（方案已否决，见决策表）。

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 触发模式 | 混合：默认自动 + 前端开关（默认开） | 三方案权衡：LLM 自判"知识不足"是自指问题（模型不知道自己不知道），且多一次判断往返；纯手动把元问题抛给用户；默认开保证时效主题零门槛，开关给可控性（Kimi/豆包等通行模式） |
| 检索位置 | 生成路由（编排层），结果作参数传入 generateDoc | 检索是编排关注点；generateDoc 保持"消息→文档"纯度；路由可发 info 事件 |
| 条数 | 请求 8、注入 6、每站 ≤2、同标题去重 | 前几条质量边际递减；实测存在同站重复（m./www. 同文）与跨站转载（同标题不同站）；博查按调用计费，count 不影响单价 |
| 失败语义 | 任何检索失败返回空数组继续生成 | 增强路径（optional feature）不允许成为主流程故障点；无 key = 功能关闭 |
| 资料格式 | 编号列表：标题（站点，日期）+ 摘要 320 字截断，不带 URL | 防模型在讲解文字中罗列链接；控制提示词体积（~2KB） |
| 超时 | 8s AbortController | 博查标称亚秒级，8s 是兜底上限 |

### 外部依赖

- 博查 Web Search API：`POST https://api.bocha.cn/v1/web-search`，Bearer 认证，body `{query, summary:true, freshness:"noLimit", count}`；响应结构以 2026-10-10 实测样本为准（Bing 风格 webPages）。开放平台 https://open.bochaai.com
- 环境变量：`BOCHA_API_KEY`（可选，空 = 功能关闭），模板见 .env.example

## 边界 case

- (story 4) 无 BOCHA_API_KEY → webSearch 返回 []，无 info 事件，生成不受影响
- (story 4) 检索超时/非 200/网络错误 → console.warn + 空数组降级
- (story 4) 响应缺 webPages 或 value 非数组 → toRefs 返回 []
- (story 2) 开关关闭（webSearch:false）→ 跳过检索，无 info 事件
- (story 1) 资料与主题无关 → 提示词要求以自身知识为准，不编造不罗列链接

## 验证 seam

- **测试 seam**：解析纯函数 toRefs（用真实响应结构样本）+ HTTP 层（dev server SSE 真实 E2E）
- **复用入口**：dev server curl SSE 冒烟（既有惯例）；node --env-file 加载密钥跑真实检索
- **新建入口**：无

## 验证方案

- [x] toRefs 回归：字段清洗、空响应、host 归一化、同站 ≤2、同标题去重、9→6 截断
- [x] 真实检索：≤6 条且每站 ≤2（实测"大模型 上下文窗口"6 条，csdn 2 条封顶）
- [x] 无 key 降级静默跳过
- [x] `pnpm build`
- [x] E2E 开关开：info 事件"已检索 6 条网络资料"，时效主题（2025诺奖）内容接地准确
- [x] E2E 开关关（webSearch:false）：无 info 事件，生成正常

## 不在本次范围

ask/refine 接检索、网页原文抓取、引用脚注 UI、检索结果缓存、多引擎备选。

## 实测结果

### 改动清单

- `src/lib/search/bocha.ts`（新增）：webSearch（检索 + 8s 超时 + 降级）、toRefs（字段清洗 + 去重 + 上限纯函数）、SearchRef 类型
- `src/lib/dsl/generate.ts`：generateDoc 增加 refs 参数，参考资料编号列表注入用户消息
- `src/lib/llm/prompts.ts`：参考资料使用规则（优先采信、矛盾时以自身知识为准、不罗列链接）
- `src/app/api/generate/route.ts`：生成前检索、webSearch 开关参数、info 事件
- `src/lib/api/explanation.ts`：SSEEvent 增加 info 变体、StreamHandlers.onInfo 透传
- `src/app/page.tsx`：联网检索开关（默认开，chips 行右侧 pill）、onInfo → searchNote
- `src/components/BuildProgressPanel.tsx`：note 属性显示"🌐 已检索 N 条"
- `.env.example`：BOCHA_API_KEY 模板

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| toRefs 管线回归（9→6、去重两类、空响应） | 全 PASS |
| 真实检索（--env-file 加载 key） | 6 条，每站 ≤2，首条带站点/日期 |
| 无 key 降级 | 静默返回 [] |
| `pnpm build` | 通过 |
| E2E「2025年诺贝尔物理学奖」开检索 | info"已检索 8 条"（上限改 6 前），26.7s；内容准确含三位得主、日期、奖金细节——**接地有效性的决定性证据** |
| E2E「MCP 协议」开检索 | info"已检索 6 条"，16.1s |
| E2E「傅里叶级数」关检索 | 无 info 事件，19.6s 正常生成 |

### 实施中发现的问题

- 跨站同文转载（不同站点相同标题）在真实检索中出现两次（"斯坦福：大模型卷错方向"），host 去重拦不住，补了精确标题去重。
- 首版去重逻辑放在 webSearch 内部导致纯函数 toRefs 测不到，重构为 toRefs 完整管线（清洗+去重+上限），单一导出更简单。
- 检索开启的延迟增加主要来自输入变长与输出变长，而非检索本身（博查 ~1s）；实测开检索的"MCP 协议"16.1s 反而快于关检索的"傅里叶级数"19.6s（主题相关，检索非主导因素）。
- Windows 下 node scratch 退出时 libuv Assertion（keep-alive 连接清理噪音），不影响测试结论。
