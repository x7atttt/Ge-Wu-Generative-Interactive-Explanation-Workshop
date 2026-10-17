# FSRS 参数个性化 · 评估结论

> 2026-10-17 · 结论：**暂缓实施**（数据基础不足，且缺一行日志表）；本文记录论据与升级路径，避免后人重复评估。

## 为什么现在不做

1. **数据量差 2 个数量级**：FSRS optimizer 拟合 21 个参数需要每位学习者数千条带评分延迟的复习记录才有统计意义（社区经验值 ~1000+ 条起步）；当前真实卡池为个位~两位数张，拟合只会过拟合噪声。
2. **缺 review log 表**：cards 表只存当前记忆状态（difficulty/stability/last_review），没有逐次复习日志（grade、elapsed、reviewed_at）。个性化训练的前提是完整日志，目前结构上不可回放。
3. **默认参数已是大规模优化结果**：`lib/fsrs.ts` 使用的官方默认参数来自社区大规模训练，对小样本用户的期望表现优于个人小样本拟合——"不个性化"是当前的理性选择。

## 升级路径（未来要做时）

1. 加 `card_reviews` 表（card_id / grade / reviewed_at / stability_before…），`reviewCard` 写入；
2. 积累至 ~1000 条后引入 optimizer（如 open-spaced-repetition 的 FSRS optimizer，或简化为只拟合 request_retention/stability 起点两参数的轻量版）；
3. 先做**低成本替代**：把 `request_retention`（当前 0.9）做成空间级偏好——"赶时间少复习（0.85）/求稳多复习（0.95）"，无需训练、立即可用，收益覆盖个性化的大头。

（第 3 条是真正值得排进 backlog 的项，工作量约半天。）
