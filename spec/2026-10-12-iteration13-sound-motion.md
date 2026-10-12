# 迭代 13：音效系统（两档）+ 答题反馈动效

> 状态：done
> 创建：2026-10-12
> 关联：reference.md 二节（音效方案定案）、spec/2026-10-10-iteration8-interaction-typing.md（练习块）

## 背景

产品"手感"缺最后一块：练习判定只有颜色反馈（MatchView 一个 ±6 shake），无声音。所有者要求"精心考虑音效设计和答题正确的反馈动效"。音效方向 2026-09-24 已定案（只做前两档、Web Audio 纯合成、克制可静音），本次实施；动效基准采用 Emil Kowalski 动效哲学（review-animations 标准）：答题属 tens/day 频率须克制、全对属偶发可给 delight、亚 300ms、reduced-motion 必须处理。

## User Stories

- 作为终端用户，我想答题对错有即时音效（对=明亮双音/错=低柔单音），以便不加看屏幕也知道结果。
- 作为终端用户，我想全部答对时有庆祝感（勾描画 + 上行琶音 + 小体量彩带），以便成就感闭环。
- 作为终端用户，我想一键全局静音且被记住，以便在任何环境使用。
- 作为终端用户，我想在波形图上"听一听"——音高随频率滑块实时变化、多谐波播和弦，以便用耳朵建立频率/音色的直觉。
- 作为系统，音效不得违反浏览器自动播放策略（AudioContext 须在用户手势内创建），SSR 不得崩溃，静音须能掐断正在响的持续音。

## 方案

| 决策点 | 选择 | 理由 |
|---|---|---|
| 音色来源 | Web Audio 振荡器实时合成，零音频文件 | 定案要求；可复现性（无二进制资产）；体积零成本 |
| ctx 生命周期 | 懒创建 + 手势内 ensureAudio 预建（生成/深化按钮点击时） | 自动播放策略：完成提示音到达时 ctx 已活；静音时不建 ctx |
| 五音设计 | correct E5→A5 双音 / wrong G3 低柔 / pop C6 triangle 短 tick / complete C5-E5-G5 琶音 / done A4→C#5 柔双音 | 全部 <400ms、正弦为主、master 0.2 克制音量；wrong 温和不惩罚 |
| 可听化频率映射 | 滑块频率 → 110·2^(f·1.5) Hz 舒适听域，amp 归一化为响度 | 滑块量级 0.1~5 直接出声过低/超声；多 terms=和弦（傅里叶听音色） |
| 可听化跟随 | 持久振荡器 + setTargetAtTime 平滑滑移 | 拖滑块音高无缝变化，不重建节点 |
| 静音联动 | setSoundOn 广播自定义事件；SoundToggle 图标与 wavePlot 持续音同停 | 静音必须"立即安静"，按钮状态不撒谎 |
| shake 统一 | motion-presets 模块级常量 {x:[0,-4,4,-2,2,0]} 300ms | 全站一致（MatchView 旧 ±6 收敛）；引用稳定避免 motion 重放 |
| 正确反馈 | 选项 scale 1→1.04→1（250ms）+ CheckDraw（pathLength 描画 320ms + 弹入） | tens/day 频率克制动效；勾描画是经典"手绘确认"隐喻 |
| 庆祝 | canvas-confetti（MIT 1.9.4，动态 import）60 粒/600ms，仅全对/零失误触发 | 偶发 delight；动态导入不打初始包 |
| 无障碍 | useReducedMotion 门控 shake/pop/confetti（CheckDraw 降级淡入）；confetti 自带 disableForReducedMotion | 动效标准第 8 条 |

### 外部依赖

- canvas-confetti 1.9.4（MIT，动态导入）+ @types/canvas-confetti
- Web Audio API（浏览器原生）；MDN 最佳实践：手势内 resume、重叠播放用独立节点

## 边界 case

- (story 5) SSR/无 window → sound.ts 全 no-op；静音短路不建 ctx
- (story 3) 静音时正在响的可听化 → 事件广播即时掐断 + 按钮复位
- 快速连点配对 → 每次 play 新建 osc 节点，天然重叠
- wavePlot 卸载 → useEffect cleanup 停声
- 可听化声部 >6 → 截断（谐波多不炸耳）
- reduced-motion → 只留颜色与声音，运动全停

## 验证 seam

- **测试 seam**：tsc（浏览器 API 无法单测）+ dev server 浏览器实测（IAB 自动化：状态机与渲染）
- **复用入口**：无既有浏览器自动化（本轮首次引入 IAB 验证）
- **新建入口**：浏览器自动化（状态翻转/文档加载/答题结果），听觉效果归所有者人工验收

## 验证方案

- [x] `pnpm exec tsc --noEmit` + 完整 `pnpm build` 通过
- [x] 浏览器：三徽章渲染（音效/统计/历史）
- [x] 浏览器：听一听→听音中→停止→听一听 状态机
- [x] 浏览器：答对 quiz → "回答正确" + 结果区渲染（音效同 handler 触发）
- [x] 浏览器：音效开关 静音↔音效 双向切换
- [ ] 人工：五音试听（音色/音量）、静音记忆跨会话、confetti 视效、拖频率滑块听音高变化、reduced-motion 降级（待所有者）

## 不在本次范围

第三档 TTS（定案不做）、滑块拖动音（连续直接操作不加感官噪声）、音量分级、非练习区音效。

## 实测结果

### 改动清单

- `src/lib/audio/sound.ts`（新增）：懒 ctx/master、五音合成、静音存储与事件广播、ensureAudio
- `src/lib/audio/sonify.ts`（新增）：Sonifier 持续声部（start/update/stop，≤6 声部）
- `src/lib/celebrate.ts`（新增）：celebrateAt（confetti 动态导入 + reduced-motion 双保险）
- `src/components/SoundToggle.tsx`（新增）：右上角第三徽章
- `src/components/dsl/motion-presets.ts`（新增）：SHAKE/POP 常量 + useFeedbackMotion（reduced-motion 门控）
- `src/components/dsl/CheckDraw.tsx`（新增）：SVG 勾描画
- 四练习组件：音效+动效接线（表见方案）；MatchView shake 参数统一
- `src/components/dsl/WavePlotView.tsx`：听一听按钮 + 声部跟随 + 静音联动
- `src/app/page.tsx`：徽章组、ensureAudio（手势内）、生成/深化完成 playDone

### 验证 case 结果

| 测试 | 结果 |
|---|---|
| tsc / build | 通过（build 24.5s） |
| 浏览器实测 | 三徽章 ✓、听音状态机 ✓、答对反馈 ✓、静音开关 ✓（doc 29，4 个 wavePlot） |
| 听觉效果 | 待所有者人工验收（自动化无法听） |

### 实施中发现的问题

- `pnpm add` 在 dev server 运行时安装依赖会把服务器带崩（node_modules 解析失效，与 build 清 .next 同类）——依赖安装也应避开运行中的服务器；本轮服务器恰已停止，顺势完成了完整 build。
- IAB 自动化截图偶发"surface preparation timed out"，重试或改用 domSnapshot 即可。
