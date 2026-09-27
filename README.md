# 格物 Gewu —— 生成式交互讲解工坊

输入任意抽象概念，AI 现场生成一篇**带滑块交互的可视化讲解**，并支持生成后用一句话继续改造。

> 传智杯 AI 创新应用挑战赛（Vibe Coding）· B 组作品

## 本地运行

要求：Node >= 20.9、pnpm 10.x

```shell
pnpm install
cp .env.example .env.local   # 填入你的 LLM 服务配置（OpenAI 兼容协议）
pnpm dev                     # http://localhost:3000
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` | OpenAI 兼容服务地址（如 GLM / DeepSeek / OpenAI） |
| `LLM_API_KEY` | 对应服务的 API Key |
| `LLM_MODEL` | 模型名（以账号可用列表为准） |
| `LLM_MODEL_FAST` | 可选；改造/追问等轻量操作用的快速模型，未配置回落 `LLM_MODEL` |

## 数据存储

讲解文档、refine 版本链与追问历史存于本地 SQLite 文件 `data/gewu.db`（Node 24 内置 `node:sqlite`，首次访问自动创建，已被 gitignore）。注意：serverless 平台（如 Vercel）文件系统不持久，正式演示请使用本地或自托管部署。

## 目录速览

- `src/lib/dsl/` DSL schema 与生成管线（核心资产）
- `src/lib/llm/` OpenAI 兼容客户端与提示词
- `src/components/dsl/` DSL 渲染组件（注册表模式扩展）
- `spec/` 功能规约与设计决策记录
