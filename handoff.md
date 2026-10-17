# Handoff · 格物（Gewu）

> 生成式交互讲解工坊 —— 传智杯 Vibe Coding B 组作品。**省赛截止 2026-11-18**。
> 本文档为交接快照（2026-10-17），详细决策见 `spec/`（迭代 14-24 全部 done 含实测）。

## 运行

- `pnpm dev`（:3000，Turbopack）。数据：`data/gewu.db`（node:sqlite，WAL）。
- 密钥只在 `.env.local`（LLM / BOCHA / MINERU），不入库不进上下文。
- 验证脚本：`node scripts/fsrs-verify.mjs`（对照 ts-fsrs，需 `--env-file=.env.local` 不必）、`node scripts/destructive-api.mjs`（API 边界回归，SSE 命中即断开不烧 token）、`node --env-file=.env.local scripts/vision-smoke.mjs`（视觉能力）。
- ⚠️ 新增路由目录必须重启 dev server（Turbopack 不热注册，见 AGENTS.md）。

## 已完成（迭代 14-24 + 加固）

| 能力 | 要点 |
|---|---|
| 资料导入 | txt/md 直读、PDF/Word 走 MinerU v4 托管 API，统一 md |
| 知识空间 | 概念地图（状态机 new/explained/practiced/weak）、管理枢纽、考试倒计时、备注 |
| 生成/深化/追问 | 流式 DSL 讲解 + 自修复；点击概念即生成并滚动到讲解 |
| 交互 | 滑块/wavePlot/chart 六型（bar/line/area/pie/hbar/radar）；滑块必须被 $var 引用（schema 校验） |
| 学习路线 | LLM 依赖排序 3-8 站 + 白名单过滤 + 覆盖兜底（「查漏补缺」站） |
| 练习闭环 | 四类练习统计、弱项补练、综合测验（按概念出分） |
| 复习 | **FSRS-6**（替换 SM-2，与 ts-fsrs 逐位对照一致）、卡片手写/编辑/删除 |
| 多模态 | 追问带图（📷/粘贴/拖入 ≤2 张）、拍题生成（≤3 张概念可空） |
| 拖放 | 生成区整卡：图片→附图；txt/md/pdf/doc→导入并自动附加 |
| 加固 | 单飞门 409、同 tick 连击锁、取消不落库、伪日期 400、图片总量 ≤5MB |

## 待办

1. **比赛材料**（最优先，11 月）：README 10 分钟复现指南、5-8 分钟演示视频（≥2 分钟 AI 协同）、≤30 页 PDF、≥3 段 Prompt 链快照。
2. MinerU 图片进讲解：先实验 vlm 转写是否已够（spec/iteration24 的 Out of Scope）。
3. Backlog 候选：FSRS 参数个性化、按考试日期倒排每日计划、卡片批量导入。
4. **push 由用户自行执行**（本地提交未推）。

## 约定

- 规约流程见 `spec/spec模板.md`；改动触多模块/契约先写 spec。
- 破坏性测试只用一次性实体（历史教训：曾误改真实空间名/日期/路线，已恢复）。
- SSE 端点 200 ≠ 校验通过；generate 用例固定 `webSearch:false` 省搜索配额。
- UI 为「纸墨朱砂」主题（B 版陶土暖橙令牌在 globals.css 注释中，切主题改令牌即可）。
