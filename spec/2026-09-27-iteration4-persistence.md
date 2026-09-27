# 迭代 4：SQLite 持久化 + 追问多轮记忆

> 状态：implementing（2026-09-27 所有者批准："直接上适合的持久化数据库，考虑是否把完整历史提问也保存"）
> 创建：2026-09-27
> 关联：`2026-09-27-iteration3-ux-polish.md`（AskPanel 现状：无记忆、纯前端会话态）

## 背景

迭代 2/3 实测后所有者确认两个诉求：
1. 追问需要多轮对话记忆（当前每次追问只带"文档 + 当前问题"，指代此前回答的追问必然失败）
2. 直接引入持久化数据库（而非仅内存记忆），并评估是否保存完整历史提问

## User Stories

- 作为学生，我想连续追问且第二问能指代第一问的答案，以便层层深入
- 作为学生，我想刷新/重开页面后能从"最近讲解"恢复此前生成的讲解与问答，继续追问
- 作为系统，我要把生成的讲解、每次 refine 的版本链、全部问答落库，以便过程可追溯（比赛"演进链路"证据）

## 目标 / 非目标

**目标**：SQLite（node:sqlite 零依赖）落库 docs/asks；ask 改多轮（服务端组装最近 6 轮）；generate/refine 返回 docId 并串联 refine 版本链；"最近讲解"下拉恢复会话。

**非目标**：版本树/演进链 UI、账号与多用户隔离（单机单用户假设）、导出、Postgres 迁移（schema 保持可迁移形态）、UI 美化超出现有风格。

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 数据库 | SQLite，Node 24 内置 `node:sqlite`（已验证 DatabaseSync 可用） | 零第三方依赖/零运维；单文件 `data/gewu.db` 契合比赛 10 分钟复现（无需 Docker/云）；回退预案 better-sqlite3 不启用 |
| 存储位置 | `app/data/gewu.db`，gitignore `/data`，首次访问自动建库 | 数据与代码隔离，不入库 |
| 连接管理 | globalThis 单例 + WAL | 防 dev 热重载重复开库；WAL 提升读写并发 |
| 历史提问 | **全部保存**；LLM 上下文只取最近 6 轮（12 条） | 保存成本低、复盘/续问/过程证据价值高；截断防 token 膨胀拖慢响应 |
| refine 链 | `docs.parent_id` 串联 | 演进链路存证；本轮不做 UI |
| 持久化时机 | 问答对在**回答流式完成后**一并落库 | 失败的问答不进历史，避免悬空 user 消息污染下轮上下文 |
| 上下文组装 | system + 首条 user 带文档全文 + 最近 6 轮交替 + 新问 | 文档是主角每次全量；历史截断在服务端 |

### Schema

```sql
docs(id INTEGER PK AUTOINCREMENT, parent_id INTEGER REFERENCES docs(id) NULL,
     title TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))
asks(id INTEGER PK AUTOINCREMENT, doc_id INTEGER NOT NULL REFERENCES docs(id),
     role TEXT NOT NULL CHECK(role IN ('user','assistant')),
     content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))
```

### 外部依赖

- `node:sqlite`（Node 24.18 实测可用，零新增 npm 依赖）

## 边界 case

- 读出的 doc 行 JSON 损坏/不过 zod → 跳过该行不炸列表
- ask 引用不存在 docId → 404；问题超 300 字 → 400（沿用）
- refine 请求缺 docId（异常路径）→ parent_id 落 null，不中断主流程
- LLM 回答失败 → 该轮问答整体不入库，前端提示可重试
- serverless 平台（如 Vercel）文件系统不持久 → README 注明演示以本地/自托管为准

## 验证 seam

`pnpm build` + 含真实 LLM 调用的 E2E（生成→重启 dev→恢复→指代式追问）+ 404/400 路径。

## 验证方案

- [ ] build 通过
- [ ] 生成 → 重启 dev server → `GET /api/docs` 仍列出该讲解 → 打开恢复
- [ ] 连问两轮，第二问指代第一问答案（如"把刚才第一点展开"）回答正确
- [ ] refine 后新版本入库（parent_id 指向旧版），追问上下文切换为新版且历史隔离
- [ ] ask 不存在 docId → 404
- [ ] 刷新页面后从下拉恢复讲解与问答

## 实测结果

### 改动清单

- `src/lib/db/`（新增）：node:sqlite 单例连接（WAL）+ docs/asks 访问层（问答成对事务写入，读出过 zod 防御）
- `src/app/api/`：generate/refine 落库并返回 docId（refine 以 parent_id 串联版本链）；ask 改 `{docId, question}` 多轮（服务端组装最近 6 轮）；新增 `GET /api/docs`、`GET /api/docs/[id]`
- `src/lib/dsl/generate.ts`：askQuestion 接收历史轮次
- 前端：docId 贯通，"最近讲解"下拉恢复文档与问答；AskPanel 改 docId 驱动（refine 后重挂载隔离历史）
- 配套：@types/node 升 24（node:sqlite 类型）、/data gitignore、README 数据说明

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| pnpm build | ✅（@types/node 20 缺 node:sqlite 类型，升 24 后通过；另修 node:sqlite 无 .transaction() 与查询结果需过 unknown 断言两处 API 差异） |
| 真实生成「多普勒效应」 | ✅ 125.7s，docId=1，blocks: text,formula,text,slider×2,wavePlot,text,quiz×2；落库 |
| 多轮记忆 | ✅ 问1"最关键的参数"→ 答声源速度 v_s；问2"把刚才你说的那个参数展开"→ 正确解析指代并展开 v_s（5.0s / 10.2s） |
| 恢复接口 | ✅ GET /api/docs/1 返回文档 + 4 条问答（user,assistant×2 对） |
| ask 不存在 docId | ✅ 404 |
| 跨进程持久 | ✅ 独立 node 进程只读打开 data/gewu.db：docs=1, asks=4（WAL 文件正常） |
| 刷新恢复/下拉交互 | 待所有者浏览器验收 |

### 实施中发现的问题

- 生成端主模型单次 125.7s，比追问（fast 回落仍 ~10s）慢一个量级：主模型选型对生成体验影响大，建议所有者评测账号内更快模型（已在对话中建议）
