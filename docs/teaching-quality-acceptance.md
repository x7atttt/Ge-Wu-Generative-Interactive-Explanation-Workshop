# 真实讲解质量验收

本轮使用现有块改进普通讲解的组织：直觉引入 → 先预测 → 动手观察 → 解释现象 → 变式自测。预测采用文字提示，正式练习仍沿用现有判题与复习卡流程；针对性补练继续以薄弱题型为主。未扩展计算能力，也未增加新的块类型。

## 固定案例与核对方法

案例定义在 `test/teaching-cases.mjs`：正弦波频率、阶乘递归、快速排序、英语名词复数、原始编码器—解码器架构、残差连接，以及带有明确操作约定的栈/队列讲义片段。

自动检查分两层：

- 生产生成管线原有的文档结构、变量引用、图表数据和教学完整性校验，失败时走现有有界修复。
- 验收脚本记录生成耗时、首段正文、真实请求次数、网络重试和修复阶段，并定位四段顺序、预测是否包含计分块、观察段是否有活动块、末尾是否有变式题。

后者只是结构线索。标题齐全不代表教学内容正确；“PASS”只表示管线返回了合法文档。图文含义、题目答案、操作任务是否成立、预测是否被提前揭晓、变式是否真正改变推理条件，需要另行人工核对。每个案例都带有核对清单。

## 运行真实模型验收

在应用目录执行：

```shell
node --experimental-strip-types test/run-teaching-eval.mjs --help
node --experimental-strip-types test/run-teaching-eval.mjs --live --run=my-run --effort=low
```

脚本只有显式传入 `--live` 才调用模型。配置由进程读取本地环境文件，不输出或保存密钥、端点、模型配置和思考正文。它直接调用生产生成管线，不启动应用、不联网检索、不读写学习数据库。案例中的讲义是独立编写的验收材料。

本轮脚本使用 Node 24 的源码加载钩子；应用的运行环境要求仍以 README 为准。

串行运行，每个案例最多等待 180 秒，保留生产管线的重试与修复行为；连续两题失败就停止，未执行案例不能计入成功率。可用 `--case=wave,recursion` 缩小范围。原始文档、提示词快照和清单存于 Git 忽略的 `data/teaching-eval/本轮名称/`。

`--resume` 只跳过已记录案例，不自动重做失败题，并要求提示词指纹和 effort 相同。新一轮复测请换名称。对照旧提示词时可以指定已存在的提交 SHA，例如：

```shell
node --experimental-strip-types test/run-teaching-eval.mjs --live --run=baseline-low --effort=low --prompt-revision=e5a7d8f
```

这个选项只从 Git 提取提示词到验收目录，不切换当前工作区。公平对照应固定案例输入、模型配置和 effort；单次运行只能说明这批样本，不能据此宣称总体成功率、固定提速幅度或学习效果提升。

## 无付费调用的桌面回归

停止开发服务后执行：

```shell
pnpm build
python test/run-learning-loop.py --teaching-only
```

该回归使用本地模型替身，验证提示词示例符合实际文档与公式契约、四段在桌面按顺序显示、滑块实际改变波形、预测与观察不写练习记录、正式变式题可判分并制成复习卡。普通完整回归也会包含这些检查，不触发真实模型验收。

已有真实产物时，可追加 `--eval-run=本轮目录名`，将其中成功生成的原文装入一次性验收空间并截图。这个预览只检查渲染，不重新调用真实模型；结束会清理验收空间。

新生成时还会拒绝未支持字段，防止模型把正文放入 `formula.content` 等渲染器不会读取的位置；修复应将解释移到合法文字块。历史文档读取保持原契约。流式响应另有单次 180 秒总时限，持续输出也不能无限等待；到总时限直接结束，不当作网络故障自动重跑。

## 内容核对依据

以下页面于 2026-10-27 直接读取，仅用作核对依据，未向模型注入参考页面的全文：

- [OpenStax：Mathematics of Waves](https://openstax.org/books/university-physics-volume-1/pages/16-2-mathematics-of-waves)：频率、周期、振幅和角频率的含义。
- [Python 教程：Defining Functions](https://docs.python.org/3/tutorial/controlflow.html#defining-functions)：函数调用与递归语境；阶乘算例另外逐步复算。
- [Princeton Algorithms：Quicksort](https://algs4.cs.princeton.edu/23quicksort/)：分区过程、随机化与最坏情况；具体序列单独跟踪核对。
- [British Council：Count nouns](https://learnenglish.britishcouncil.org/grammar/english-grammar-reference/count-nouns)：辅音/元音加 y 的复数变化与不规则复数。
- [Attention Is All You Need](https://arxiv.org/html/1706.03762)：编码器/解码器、交叉注意力来源、掩码、残差和归一化。
- [Deep Residual Learning for Image Recognition](https://arxiv.org/html/1512.03385v1)：残差相加、恒等跳连及维度不匹配时的投影。

运行结果与人工发现另存本轮验收报告，不能用模拟响应代替真实模型结果。

本轮记录：[2026-10-27 讲解验收报告](teaching-quality-2026-10-27.md)。
