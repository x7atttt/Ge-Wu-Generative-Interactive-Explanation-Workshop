# 迭代21：FSRS-6 调度升级——替换 SM-2，存量卡状态迁移

> 状态：done
> 创建：2026-10-17
> 关联：2026-10-12-iteration18-srs-cards-countdown.md（SM-2 实现）；2026-10-16-iteration19/20（卡池消费方）

## 背景

迭代18 的 SM-2 已运行验证，但其固定 EF 递进（1d/6d/×EF）对难度不敏感：难卡与易卡同间隔增长，用户"模糊"多次后间隔仍机械拉长。FSRS（Free Spaced Repetition Scheduler）用遗忘曲线建模记忆状态（难度 D + 稳定度 S），按目标记忆率（90%）直接算间隔，社区大规模数据验证更高效。根因：SM-2 是 1990 年的无状态难度的启发式，升级为基于遗忘曲线的 FSRS-6。

## ★ User Stories

- 作为复习用户，我想间隔按我的真实记忆状态（难度/稳定度）计算，以便难卡更频繁回来、易卡更快拉长。
- 作为复习用户，我想旧卡无痛升级，以便已有复习进度不丢、今日队列不乱。
- 作为系统，我想调度纯函数可独立对照开源参考实现验证，以便算法正确性有据可查（比赛材料可引用）。
- 作为备考用户，我想在卡片管理里看到每张卡的稳定度，以便感知"这张卡还有多牢"。

## 目标 / 非目标

**目标**：`lib/fsrs.ts` 纯函数实现（FSRS-6 默认参数）、cards 表加 difficulty/stability/last_review 列并迁移存量、reviewCard 换引擎、对照 ts-fsrs 的逐序列数值验证。

**非目标**：不做参数个性化优化（FSRS optimizer 需要上万条复习记录）、不做分钟级 learning/relearning steps（产品是日粒度）、不保留 SM-2/FSRS 双引擎开关（单一事实来源）。

## ★ 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 版本 | FSRS-6（21 参数，decay=w₂₀ 参数化） | ts-fsrs 当前默认；与 FSRS-5 兼容（w₂₀=0.5 时退化） |
| 参数 | 官方默认 `w[0..20]`，逐项取自 ts-fsrs `constant.ts` | 无用户数据支撑个性化，默认参数即社区大规模优化结果 |
| 目标记忆率 | 0.9（默认）→ intervalModifier=1，间隔≈稳定度 | 90% 是效率/保留的常用平衡点，也是 S 的定义基准 |
| 短期调度 | `enable_short_term=false`（无分钟级步） | 产品日粒度；同日重见走 our-UX 而非算法层 |
| 三档映射 | again→Rating 1(Again)，fuzzy→3(Good)，easy→4(Easy) | 沿用 SM-2 时代 q(1/3/5) 的中档语义：模糊=正常推进，记得=加成推进 |
| Again 的当日重见 | 评分后 due=今日（interval 记 0）——产品 UX 保留 | 对应 ts-fsrs relearning 步骤降级为日粒度"当场再记一遍"；状态更新仍走 forget 公式 |
| 存量迁移 | 幂等 ALTER 三列 + JS 单次迁移：repetitions>0 → S=max(interval_days,0.5)、D=clamp(5+(2.5−ease)×25/6,1,10)、last_review=due−interval_days；due 不动 | ease 高→好记（D 低）、ease 1.3→D 10；due 不动保证队列不跳变 |
| repetitions 列 | 保留并继续自增（仅作"已过 N 轮"展示） | 展示语义与调度解耦 |
| ease 列 | 保留但冻结（不再写入） | 迁移来源 + 历史审计；删列无收益 |
| 文件组织 | `lib/srs.ts` → `lib/fsrs.ts`（重写），localDay/addDays/ReviewGrade 导出保持 | 调用方 import 路径集中改一次；旧名残留会误导 |

### 外部依赖（已逐项核对源码）

ts-fsrs master（`FSRSVersion … using FSRS-6.0`）：
- 默认参数与常量：`src/fsrs/constant.ts`（`default_w`、S_MIN=0.001、S_MAX=36500、retention 0.9、maxInterval 36500、FSRS6_DEFAULT_DECAY=0.1542）
- 公式：`src/fsrs/algorithm.ts`——forgetting_curve `R=(1+F·t/S)^DECAY`、DECAY=−w₂₀、`F=0.9^(1/DECAY)−1`；init `S₀=w[g−1]`、`D₀=w₄−e^{(g−1)w₅}+1` clamp[1,10]；`D′=meanRev(w₇·D₀(4), D+w₆(3−g)·(10−D)/9)`；recall `S′=S(1+e^{w₈}(11−D)S^{−w₉}(e^{w₁₀(1−R)}−1)·hardPen(w₁₅,g=2)·easyBonus(w₁₆,g=4))`；forget `S′=w₁₁D^{−w₁₂}((S+1)^{w₁₃}−1)e^{w₁₄(1−R)}`；interval `clamp(round(S×mod),1,36500)`
- r 取值时机：`impl/long_term_scheduler.ts` reviewState——r 用**评分前**的 S 按 elapsed 算一次，四档共用
- 中间量 toFixed(8) 舍入位置：与 algorithm.ts 逐处对齐（对照脚本需逐位一致）

## 边界 case

- (story 2) 迁移幂等：stability>0 的行不再改（重复重启不重算）。
- (story 2) repetitions=0 的旧新卡 → 视为未学，首次评分走 init 路径。
- (story 1) 新卡首评 again → S=0.212/D 高，due=今日；同日再评 fuzzy/easy → t=0、R=1 → 增长项为 0，S 不涨，间隔按 S 算（≈1 天）——算法对"当日重看"的保守反应，符合预期。
- elapsed_days 用 last_review 推导；last_review 为 NULL 且 stability>0（理论不出现）→ t=0 兜底。
- 间隔溢出：clamp 至 36500 天（100 年），due 字符串照常可表达。

## ★ 验证 seam

- **测试 seam**：单元（纯函数）+ HTTP（review 路由写回）。
- **复用入口**：既有 curl 冒烟。
- **新建入口**：`scripts/fsrs-verify.mjs`——`ts-fsrs` 作为 devDependency 引入，多序列（各三档组合、跨多日 elapsed）逐位比对自研 fsrs.ts 与参考实现的 D/S/interval。新建理由：正确性主张是"逐位对齐参考实现"，只有并排对照能证明。

## 验证方案

- [x] 对照脚本：6 条评分序列共 27 次比对，D/S 与 ts-fsrs 全部一致（<1e-6；非 again 档间隔含单调链一致）
- [x] 新卡首评 fuzzy → due=+3 天（S=2.3065，间隔链 good≥hard+1 抬到 3）；easy → +8 天
- [x] review 写回 difficulty/stability/last_review/due/interval，repetitions 自增
- [x] 迁移：造旧态卡（repetitions=3, ease=2.0, interval=10, due=10-22）→ 重启后 D=7.0833、S=10、last_review=10-12、due 不变；WHERE stability=0 保证重复迁移幂等
- [x] 到期队列/计数/测验抽卷不受影响（review 走 fuzzy 后 due 推后，不再入今日队列）
- [x] `pnpm exec tsc --noEmit` 通过

## ★ 实测结果

### 改动清单

- `lib/fsrs.ts`（新，替代 lib/srs.ts）：FSRS-6 纯函数——遗忘曲线/D/S 推演/四档间隔单调链/nextInterval
- `lib/db/index.ts`：cards 加 difficulty/stability/last_review 三列（幂等 ALTER）+ SM-2→FSRS 状态迁移（S=max(interval,0.5)、D=ease 线性映射、last_review=due−interval 倒推、due 不动）
- `lib/db/cards.ts`：ReviewCard 换 FSRS 字段；reviewCard 走 schedule() 写回（repetitions 保留自增仅作轮次展示；ease 冻结）
- `scripts/fsrs-verify.mjs`（新）+ devDependency ts-fsrs@5.4.2：逐序列对照（tsc 转译临时副本 import，跑完即删临时目录）
- 前端类型/文案：lib/api/cards.ts 字段更新；复习/测验/地图/制卡按钮的 SM-2 表述换 FSRS；卡片管理显示"稳定度 N 天"

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| scripts/fsrs-verify.mjs（6 序列 27 比对 + R(S)=0.9 自检） | ALL PASS，exit 0 |
| 迁移（id=19：ease 2.0/interval 10/due 10-22） | D=7.0833、S=10、last_review=2026-10-12、due=2026-10-22 不变 |
| 迁移后评 fuzzy（elapsed 5 天） | D 7.0833→7.0715、S 10→18.4396、interval 18、due=11-04、repetitions 4 |
| tsc / 到期队列回归 | 通过 / 正常（评后出今日队列） |

### 实施中发现的问题

- **间隔必须带四档单调链**：初版只按所评档位的 S 排间隔，与参考实现差 1-2 天——ts-fsrs 的 long_term_scheduler 对四档间隔强制 again≥1、hard≥again+1、good≥hard+1、easy≥good+1（Anki 档位间到期日严格错开的 UX 保证），即使产品只暴露三档也要按四档全算后取链上值。
- **D₀(Easy) 在均值回归中不 clamp**：init_difficulty 原始值可为负（默认参数下 ≈ -4.77），next_difficulty 的 meanReversion 用的是这个原始值而非 clamp 后的 1——初版差 0.001×5.77/步，多轮累积放大。clamp 只发生在 next_difficulty 结果与新卡初始化两处。
- 遗留卡迁移后首次评分即走完整 FSRS 推演（elapsed 由倒推的 last_review 得出），无需"首评特殊化"。

## 不在本次范围（Out of Scope）

- FSRS optimizer 参数个性化、模糊因子（enable_fuzz）、分钟级 steps
- SM-2 代码保留（被替换，git 历史可溯）
