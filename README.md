# 格物 Gewu · 生成式交互讲解工坊

> 输入一个概念，**玩着懂**。AI 现场生成带滑块与图表的交互讲解——拖动参数建立直觉，拍照提问，追问深入，复习卡按遗忘曲线回流。
>
> 传智杯 AI 创新应用挑战赛（Vibe Coding）· B 组作品

## 它能做什么

一场考试的完整学习闭环，全部由 AI 现场驱动：

**资料 → 概念 → 讲解 → 练习 → 弱项 → 复习 → 测验**

- **批量导入资料**：拖入 txt / md / pdf / doc / docx，PDF/Word 自动经 MinerU 解析为 Markdown；
- **知识空间**：把一场考试的资料圈进一个空间，概念地图实时显示每个概念的掌握状态（未学 / 已讲解 / 已练习 / 薄弱），考试倒计时常驻；
- **生成交互讲解**：输入概念或**直接拍题**（多模态识图），流式生成含公式、波形、六类图表、滑块参数台与四类练习（自测/填空/配对/分类）的讲解文档；
- **逐章学习路线**：AI 按依赖与难度把概念编排成攻克路径，当前站标记 + 完成度；
- **FSRS-6 间隔复习**：讲解题目一键制成复习卡，自研 FSRS-6 调度（与开源参考实现 ts-fsrs 逐位对照一致），支持手写补卡；
- **综合测验**：全空间卡池随机抽卷模拟考，按概念出分定位薄弱。

## 10 分钟复现

### 1. 环境要求（约 1 分钟确认）

- **Node.js ≥ 22.5**（使用内置 `node:sqlite`，实测 24.x）
- **pnpm ≥ 10**
- 一个 **OpenAI 兼容**的大模型服务（GLM / DeepSeek / OpenAI 等均可；建议多模态型号以启用拍题功能）

### 2. 安装（约 2 分钟）

```shell
pnpm install
cp .env.example .env.local
```

### 3. 配置密钥（约 1 分钟）

编辑 `.env.local`，**必填**三项：

```ini
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4   # 你的 OpenAI 兼容端点
LLM_API_KEY=你的密钥
LLM_MODEL=你的模型名                                  # 建议多模态型号
```

可选：`MINERU_API_TOKEN`（PDF/Word 解析，[mineru.net](https://mineru.net) API 管理页创建）、`BOCHA_API_KEY`（生成前联网检索补充事实依据）。留空不影响核心功能。

### 4. 启动（约 1 分钟）

```shell
pnpm dev
```

打开 <http://localhost:3000>。数据存于本地 `data/gewu.db`（SQLite，首次访问自动建库；注意 serverless 平台文件系统不持久，正式演示请本地或自托管部署）。

### 5. 体验路径（约 5 分钟）

1. **生成讲解**：输入"正弦波的频率"点生成，拖动参数台滑块看波形实时变化，做两道嵌入式练习；
2. **建空间**：右上"空间"下拉新建（如"期末·操作系统"），展开枢纽设置考试日期；
3. **导资料**：拖一份 PDF 或 txt 到顶部生成区——自动导入并附加，点资料的"提炼讲解点"；
4. **概念地图**：点任一"未学"概念即刻生成；点"🗺 生成学习路线"获得逐站攻克路径；
5. **闭环**：讲解底部"制成复习卡" → 地图"🔖 复习"（FSRS 排期）→ "📝 测验"抽一卷看分概念报告；
6. **拍题**：生成框 📷 附一张题目照片（概念留空）直接生成讲解；讲解内"追问细节"可粘贴截图提问。

## 环境变量速查

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 必填；任意 OpenAI 兼容服务 |
| `LLM_MODEL_FAST` | 可选；改造/追问的快速模型，未配置回落主模型 |
| `LLM_REASONING_EFFORT` | 可选；`low\|medium\|high`，生成偏慢时设 `low` |
| `BOCHA_API_KEY` | 可选；生成前联网检索补充事实 |
| `MINERU_API_TOKEN` | 可选；PDF/Word 解析为 Markdown |

## 常见问题

- **PDF 导入提示未配置 token**：填入 `MINERU_API_TOKEN` 后重启 `pnpm dev`；
- **生成偏慢**：设 `LLM_REASONING_EFFORT=low`，或配置 `LLM_MODEL_FAST`；
- **换模型**：改 `LLM_BASE_URL / LLM_MODEL` 即可，协议层只依赖 `/chat/completions` 一个端点；
- **重置数据**：删除 `data/gewu.db` 后刷新。

## 更多

- 架构与规范：`AGENTS.md`；功能规约与实测：`spec/`（迭代 14-24）
- 算法正确性：`node scripts/fsrs-verify.mjs`（FSRS-6 与 ts-fsrs 逐序列对照）
- 交接快照：`handoff.md`
