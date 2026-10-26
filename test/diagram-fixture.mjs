export const diagram = {
  type: "diagram", title: "Transformer 编码器—解码器架构", direction: "LR",
  caption: "教学简图：展示原始编码器—解码器结构中的关键数据流；残差连接仅画一条作为示例，省略部分归一化与重复层。",
  groups: [{ id: "encoder", label: "编码器 · Encoder" }, { id: "decoder", label: "解码器 · Decoder" }],
  nodes: [
    { id: "input", group: "encoder", label: "输入嵌入 + 位置编码", description: "把输入序列转换为带有位置信息的向量。" },
    { id: "enc_attention", group: "encoder", label: "编码器自注意力", description: "输入序列内部交换信息，形成上下文表示。" },
    { id: "enc_ffn", group: "encoder", label: "前馈网络", description: "对每个位置的表示进行非线性变换。" },
    { id: "target", group: "decoder", label: "已生成的输出 + 位置编码", description: "解码器以已有输出作为输入，逐步预测后续内容。" },
    { id: "masked", group: "decoder", label: "掩码自注意力", description: "预测时只读取当前位置之前的输出信息。" },
    { id: "cross", group: "decoder", label: "编码器—解码器交叉注意力", description: "以解码器表示为查询，读取编码器提供的键和值。" },
    { id: "dec_ffn", group: "decoder", label: "前馈网络与输出表示", description: "整合注意力结果，形成用于预测的表示。" },
    { id: "output", label: "线性映射 + Softmax", description: "将表示映射为下一个词元的概率。" },
  ],
  edges: [
    { id: "e1", source: "input", target: "enc_attention" },
    { id: "e2", source: "enc_attention", target: "enc_ffn" },
    { id: "residual", source: "input", target: "enc_ffn", label: "残差示例", kind: "residual" },
    { id: "e3", source: "target", target: "masked" },
    { id: "e4", source: "masked", target: "cross" },
    { id: "memory", source: "enc_ffn", target: "cross", label: "键 / 值" },
    { id: "e5", source: "cross", target: "dec_ffn" },
    { id: "e6", source: "dec_ffn", target: "output" },
  ],
  steps: [
    { title: "理解输入", description: "输入经过编码器，得到整段序列的上下文表示。", nodeIds: ["input", "enc_attention", "enc_ffn"], edgeIds: ["e1", "e2"] },
    { title: "读取上下文", description: "解码器同时利用已有输出和编码器表示，连接两侧的信息。", nodeIds: ["masked", "enc_ffn", "cross"], edgeIds: ["e4", "memory"] },
    { title: "预测输出", description: "从解码器表示计算下一个词元的概率。", nodeIds: ["dec_ffn", "output"], edgeIds: ["e6"] },
  ],
};
export const diagramDoc = { version: 1, title: "Transformer 架构验收", blocks: [
  { type: "heading", level: 2, text: "先看模块，再看数据怎样流动" },
  { type: "text", content: "架构图适合表达模块之间的关系。点击节点阅读职责，切换步骤追踪数据流。" },
  diagram,
  { type: "quiz", question: "交叉注意力从哪里读取键和值？", options: ["编码器表示", "未来的输出"], answer: 0, explanation: "它使用编码器提供的上下文表示。" },
] };
