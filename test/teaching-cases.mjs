export const teachingCases = [
  { id: "wave", concept: "正弦波的频率", review: ["频率改变疏密，振幅控制高度；不混淆频率与角频率", "操作说明使用实际存在的滑块和可达到的取值", "改变频率后的变式题与原预测不同"] },
  { id: "recursion", concept: "阶乘递归中递与归的过程", review: ["明确终止条件，区分调用层数与额外递归调用次数", "代码保留换行与缩进，计算和题目答案一致", "不声称静态公式会随滑块计算"] },
  { id: "sorting", concept: "快速排序的分区过程与稳定性", review: ["明确采用的分区方法，例子跟踪与方法一致", "不把平均复杂度说成所有情况下的保证", "不把固定数组图表描述成可自动重算的算法模拟器"] },
  { id: "grammar", concept: "英语名词复数中的规则与不规则变化", review: ["规则的适用条件与反例正确", "题目上下文完整，正确答案唯一", "不为语言学习虚构数值滑块"] },
  { id: "transformer", concept: "原始编码器—解码器 Transformer 架构", review: ["区分编码器、解码器、掩码自注意力与交叉注意力", "图中数据流方向与文字解释一致，不混入仅解码器模型的结构", "简化或省略的重复层、归一化及残差连接应说明"] },
  { id: "residual", concept: "残差神经网络中残差连接的工作方式", review: ["残差分支与跳连在加法节点汇合，不画成普通串联", "说明相加需要匹配维度，必要时投影", "不宣称跳连能够保证解决所有梯度或训练问题"] },
  {
    id: "source", concept: "根据讲义解释栈与队列，并安排一次可观察的练习",
    sources: [{ title: "验收用讲义片段：栈与队列", content: "本讲义采用以下约定：栈后进先出，操作名称为 push 与 pop；队列先进先出，操作名称为 enqueue 与 dequeue。两种结构初始均为空，按 A、B、C 的顺序依次加入，再取出一个元素：栈取出 C，队列取出 A。请使用这些操作名和字母案例，不改成数字案例。" }],
    review: ["遵守讲义约定：栈先取 C，队列先取 A", "使用给定操作名及字母案例，补充内容与原文不冲突", "迁移题改变入队/出队或入栈/出栈顺序，而非原题换句话重复"] ,
  },
];

/** 这些只是可定位的结构线索，不能替代教学正确性的人工核对。 */
export function inspectTeachingFlow(doc) {
  const blocks = doc.blocks;
  const headings = blocks.flatMap((block, index) => block.type === "heading" ? [{ index, text: block.text }] : []);
  const find = pattern => headings.find(item => pattern.test(item.text))?.index ?? -1;
  const positions = { predict: find(/预测|先猜/), observe: find(/观察|动手|试一试/), explain: find(/解释|为什么|揭晓/), transfer: find(/变式|迁移|换个/) };
  const ordered = positions.predict >= 0 && positions.predict < positions.observe && positions.observe < positions.explain && positions.explain < positions.transfer;
  return {
    positions, ordered,
    predictionIsUngraded: ordered && blocks.slice(positions.predict, positions.observe).every(block => !["quiz", "fillBlank", "match", "sort"].includes(block.type)),
    hasObservationActivity: ordered && blocks.slice(positions.observe, positions.explain).some(block => ["chart", "wavePlot", "diagram", "fillBlank", "match", "sort"].includes(block.type)),
    hasTransferQuestion: positions.transfer >= 0 && blocks.slice(positions.transfer + 1).some(block => ["quiz", "fillBlank", "match", "sort"].includes(block.type)),
  };
}
