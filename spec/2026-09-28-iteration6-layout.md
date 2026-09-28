# 迭代 6：文档排版重构（双栏参数台 + 深化分组 + heading 块 + 底部对话面板）

> 状态：implementing（2026-09-28 所有者批准：排版方向经相似产品调研定为双栏 sticky；深化分组用 diff+指令标题）
> 创建：2026-09-28
> 关联：`2026-09-28-iteration5-streaming-ux.md`

## 背景

所有者实测反馈：① 「继续深化」追加内容与原始讲解在同一线性流中无结构区分，多轮深化后成为"一长串墙"；② 讲解/交互/自测/深化/追问的排布缺乏搭配。技术事实：滑块与图通过 VarContext 变量绑定而非位置关联，控件可脱离内容流单独安放。

## 调研依据（登记于 ../reference.md 设计参考条目）

PhET 访谈研究（控制面板右侧惯例、仿真区视觉主导）+ Distill 交互文章模式（单栏正文 + 侧边 sticky 交互）+ scrollytelling 成熟模式（sticky figure）→ 收敛于**主栏阅读流 + 右栏 sticky 参数台**。

## 方案决策表

| 决策点 | 选择 | 理由 |
|---|---|---|
| 主结构 | 主栏阅读流（文字/公式/图/quiz/heading）+ 右栏 sticky 参数台（全部滑块，`hidden lg:block`，sticky top-6） | 调研共识；阅读滚动时控件常驻 |
| 窄屏回落 | 滑块双渲染：主栏内联组 `lg:hidden`（置于首个 wavePlot/chart 前）与右栏共享 VarContext，受控同步 | 纯 CSS 断点，无 JS 判断 |
| 深化分组 | 与父版本逐块 JSON 相等求**最长公共前缀**，其后全部进「深化 · {refine 指令}」分组卡（浅 indigo 底） | 所有者批准 diff+指令标题；无法区分"修改/新增"，前缀后统一分组（v1 决策）；公共前缀为 0（全文重写）→ 不分组 |
| 指令持久化 | docs 表新增 `instruction` 列（ALTER TABLE 幂等迁移，旧行 NULL → 不分组，行为同现状） | 分组标题数据源；refine 场景父版本在客户端闭包，历史恢复走 API 返回 parentBlocks |
| heading 块 | `{"type":"heading","text","level":2\|3 默认 3}` | 长文档分节；refine 新增内容以 heading 开头 |
| 底部对话面板 | 「深化讲解｜追问细节」双 tab 合一（tab 态随文档卡 key 重置） | 替代两个堆叠输入区 |
| 文案措辞 | prompt 全部消除"下方/上方"位置指代 | 双栏/移动端位置无关 |
| 容器宽度 | 文档存在时 max-w-5xl，无文档时保持 max-w-2xl | 双栏需要横向空间 |

## 改动清单

1. schema：heading 块入判别联合；HeadingBlockView + BlockRenderer 注册
2. db：SCHEMA 含 instruction 列 + 幂等 ALTER 迁移；insertDoc/getDoc 扩展
3. API：refine 落库存指令；`/api/docs/[id]` 返回 `instruction` + `parentBlocks`
4. `src/lib/dsl/deepen.ts`：computeDeepen 纯函数
5. ExplainDocView：双栏 grid、参数台 aside、主栏内联滑块组、深化分组卡、skeletonTail 兼容
6. AskPanel：嵌入模式（去自带 border-t/标题，语境由 tab 提供）
7. page：容器宽度自适应、底部双 tab、deepen 接线（refine 闭包父版本 / loadDoc parentBlocks）、StreamingDoc 双栏
8. prompts：heading 规则、位置无关措辞、refine 追加带 heading 开头且原块逐字保持（利于 diff）

## 边界 case

老库迁移跑多次幂等；refine 全文重写不分组；无滑块文档单栏；深化段全为滑块时分组卡内主栏内容为空（滑块仍进参数台，罕见可接受）；双份滑块受控同步；流式期参数台随首个滑块渐次挂载。

## 验证方案

- [ ] build 通过；node 验证：迁移跑两次不报错 + computeDeepen 三形态（追加/前缀 0/无变化）
- [ ] 生成 → 深化一轮：新增块进「深化 · 指令」分组卡，原文档排布不变
- [ ] 滚动阅读时右栏参数台 sticky 可拖，图/公式实时响应
- [ ] 窄窗口（<lg）滑块内联出现在首个图前
- [ ] 恢复含深化的历史讲解，分组与标题保留
- [ ] 底部双 tab 切换正常，追问多轮/粘底无回归；长文档 heading 层级正确

## 不在本次范围

scrollytelling 步进触发、版本树 UI、移动端手势抽屉、quiz 折叠收集。

## 实测结果

### 改动清单

- schema：heading 块；HeadingBlockView + BlockRenderer 注册
- db：instruction 列（建表 + 幂等 ALTER 迁移）；insertDoc/getDoc 扩展；refine 落库存指令；`/api/docs/[id]` 返回 instruction + parentBlocks
- `src/lib/dsl/deepen.ts`：computeDeepen（最长公共前缀 diff）
- ExplainDocView：双栏 grid + sticky 参数台 + 主栏内联滑块组（lg:hidden）+ 深化分组卡 + skeletonTail 兼容
- AskPanel：嵌入模式；page：容器宽度自适应、底部「深化讲解｜追问细节」双 tab（hidden 切换保会话态）、deepen 接线（refine 闭包父版本 / loadDoc parentBlocks）
- prompts：七种块、heading 规则、位置无关措辞、refine 原块逐字保持（利于 diff）

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| pnpm build | ✅（修复一处重复 import） |
| 老库迁移幂等（node 直跑真实 data/gewu.db） | ✅ 第 1 次 ALTER 成功补列，第 2 次 duplicate column 被忽略 |
| computeDeepen 纯函数 | ✅ 追加(fromIndex=3)/全文重写(null)/无新增(null)/中段修改(前缀后全部分组, fromIndex=1)/无元数据(null) 五形态符合预期 |
| 浏览器验收（参数台 sticky、双栏/窄屏、深化分组卡、双 tab、历史恢复） | 待所有者验收 |

### 实施中发现的问题

- deepen.ts 仅含 type-only 相对导入，node 类型剥离后无运行时依赖，可直接 node 验证（区别于 schema.ts 的 zod 运行时依赖）
- 双 tab 用 hidden 切换而非条件渲染：条件卸载会丢 AskPanel 本地问答会话态
