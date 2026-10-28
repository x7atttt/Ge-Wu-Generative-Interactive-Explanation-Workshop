export const reactDiagram = {
  type: "diagram", title: "ReAct 推理与行动数据流", direction: "LR",
  groups: [{ id: "model", label: "模型侧：推理与决策" }, { id: "environment", label: "外部环境：事实与执行" }],
  nodes: [
    { id: "input", label: "输入用户问题", description: "接收需要解决的问题。" },
    { id: "llm", group: "model", label: "LLM 推理核心", description: "结合已有信息决定下一步。" },
    { id: "thought", group: "model", label: "Thought 推理", description: "形成对任务的判断。" },
    { id: "action", group: "model", label: "Action 行动指令", description: "决定调用的工具及输入。" },
    { id: "tool", group: "environment", label: "外部环境与工具", description: "执行查询或其他操作。" },
    { id: "observation", group: "environment", label: "Observation 观察", description: "把执行结果带回下一轮推理。" },
  ],
  edges: [
    { id: "in", source: "input", target: "llm" }, { id: "think", source: "llm", target: "thought" },
    { id: "decide", source: "thought", target: "action" }, { id: "execute", source: "action", target: "tool", label: "执行工具" },
    { id: "observe", source: "tool", target: "observation" }, { id: "feedback", source: "observation", target: "llm", label: "返回观察结果" },
  ],
};
