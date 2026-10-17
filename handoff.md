# Handoff · 格物（Gewu）

> 生成式交互讲解工坊 —— 传智杯 Vibe Coding B 组作品。**省赛截止 2026-11-18**。
> 交接快照（2026-10-17 晚），详细决策见 `spec/`（迭代 14-24 全部 done 含实测）与 `docs/`。

## 运行

- `pnpm dev`（:3000，Turbopack）。数据：`data/gewu.db`（node:sqlite，WAL，自动建库）。
- 密钥只在 `.env.local`（LLM / BOCHA / MINERU），不入库不进上下文；模板见 `.env.example`。
- 验证脚本（`scripts/`，均可复跑）：
  - `fsrs-verify.mjs` —— FSRS-6 与 ts-fsrs 逐序列对照（无需 env）；
  - `destructive-api.mjs` —— API 边界轰炸回归（SSE 命中即断开、变更型用例走一次性空间，不烧 token 不碰真实数据）；
  - `vision-smoke.mjs` —— 多模态能力冒烟（需 `--env-file=.env.local`）。
- ⚠️ 新增路由目录必须重启 dev server（Turbopack 不热注册，见 AGENTS.md）。

## 已完成（迭代 14-25 概览）

| 能力 | 要点 |
|---|---|
| 资料导入 | txt/md 直读、PDF/Word 走 MinerU v4（vlm），统一 md |
| 知识空间 | 概念地图（new/explained/practiced/weak）、管理枢纽、考试倒计时、备注；**深删**（连资料/讲解/练习/卡级联，两段确认） |
| 生成/深化/追问 | 流式 DSL + 自修复；点击概念即生成并滚动；讲解视图随空间走 |
| 交互 | 滑块/wavePlot/chart 六型（bar/line/area/pie/hbar/radar）；滑块必须被 $var 引用（schema 校验+自修复） |
| 学习路线与计划 | LLM 依赖排序 + 白名单 + 覆盖兜底；**考前每日计划**（站分桶到学习日 + 考前一日测验/复习冲刺，确定性派生） |
| 练习闭环 | 四类练习统计、弱项补练、综合测验（按概念出分） |
| 复习 | **FSRS-6**（与 ts-fsrs 逐位一致；SM-2 已替换，存量自动迁移）；卡片手写/**批量导入**（行式 `题面\|答案\|概念`）/编辑/删除 |
| 多模态 | 追问带图（📷/粘贴/拖入 ≤2 张）、拍题生成（≤3 张概念可空） |
| 拖放 | 生成区整卡：图片→附图；txt/md/pdf/doc→导入资料并自动附加；越区拦截 |
| 历史管理 | 行内删除 + **批量删除**（勾选/搜索过滤内批量） |
| 加固（破坏性测试产出） | 服务端单飞门 409、同 tick 连击锁、取消断连不落库、伪日期 400、stats 非法 spaceId 400、图片总量 ≤5MB |

专项结论（`docs/`）：MinerU 图片进讲解**维持现状**（表格/公式转写够用，数值图丢失，`mineru-vlm-experiment.md`）；FSRS 参数个性化**暂缓**（数据不足 + 缺 review log，可行替代=空间级记忆率偏好，`fsrs-personalization.md`）；Prompt 链快照 4 段（`prompts.md`）。

## 待办

1. **比赛材料**（用户暂缓中，11 月 deadline）：5-8 分钟演示视频（≥2 分钟 AI 协同，需本人配音）、≤30 页 PDF。README 复现指南已完成（`README.md`）。
2. **push 由用户自行执行**（本地提交未推）。
3. 可选打磨：空间级 request_retention 偏好（约半天）、路线重生成时保留人工调整。

## 约定

- 规约流程见 `spec/spec模板.md`；跨模块/契约改动先写 spec。
- 破坏性测试只用一次性实体（曾两次误改真实空间名——脚本已根治）。
- SSE 端点 200 ≠ 校验通过；generate 用例固定 `webSearch:false` 省搜索配额。
- UI 为「纸墨朱砂」主题（B 版陶土暖橙令牌在 globals.css 注释中，切主题改令牌即可）。
- 当前数据现状：「测试空间」资料已清空（应用户要求），路线为快照残留、卡池 7 张；重置体验重新拖资料即可。
