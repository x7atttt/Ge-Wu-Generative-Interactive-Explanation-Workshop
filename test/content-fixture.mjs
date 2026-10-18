export const code = "def jie_cheng(num):\n    if num == 1:\n        return ___\n    else:\n        return num * ___";
export const quiz = { type: "quiz", question: "计算 factorial(5) 时，总共会产生多少层函数调用（含初始调用）？", options: ["5 层", "4 层", "2 层", "1 层"], answer: 0, explanation: "**包含初始调用**，5→4→3→2→1，共 5 层。" };
export const fill = { type: "fillBlank", prompt: "补全**阶乘递归代码**", language: "python", text: code, blanks: [
  { options: ["1", "0"], answer: 0, explanation: "终止条件返回 1。" },
  { options: ["jie_cheng(num - 1)", "jie_cheng(num)"], answer: 0, explanation: "递归参数逐步减小。" },
] };
export const chart = { type: "chart", chartType: "bar", title: "当前递归深度的递与归", categories: ["当前 n"], interactionHint: "两组均随递归深度变化。", series: [
  { name: "调用层数（递）", data: [{ $var: "depth" }] },
  { name: "返回次数（归）", data: [{ $var: "depth" }] },
] };
export const doc = { version: 1, title: "内容质量验收", blocks: [
  { type: "heading", text: "递归演示", level: 2 },
  { type: "text", content: "递归有**递与归**两个阶段。\n\n`factorial(5)`\n\n```python\ndef f(n):\n    return n\n```" },
  { type: "slider", var: "depth", label: "递归深度", min: 1, max: 8, step: 1, initial: 4 }, chart, quiz, fill,
  { type: "match", prompt: "配对**递归阶段**", pairs: [{ left: "**递**", right: "缩小问题" }, { left: "**归**", right: "返回结果" }] },
  { type: "sort", prompt: "判断**所在阶段**", categories: ["递", "归"], items: [{ label: "**调用**自身", category: "递" }, { label: "返回结果", category: "归" }] },
] };
