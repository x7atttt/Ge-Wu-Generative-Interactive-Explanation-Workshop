import type { ExplainDoc, FillBlankBlock, QuizBlock } from "./dsl/schema";

export function normalizeBlankText(text: string): string {
  return text.replace(/<br\s*\/?\s*>/gi, "\n");
}

export function isCodeBlank(block: FillBlankBlock): boolean {
  return !!block.language || /\b(def |function |return |const |class |if\s*\()/.test(block.text) || /代码|程序/.test(block.prompt ?? "");
}

export function questionIssue(question: string): string | undefined {
  if (/[，,]\s*$/.test(question.trim())) return "题干可能未生成完整，请先纠正原讲解或编辑卡片。";
}

function blankIssue(block: FillBlankBlock): string | undefined {
  if (isCodeBlank(block) && /\b(def |class |function |else\b|if\b.*:)/.test(block.text) && !normalizeBlankText(block.text).includes("\n")) return "代码题缺少换行与缩进，请先纠正原讲解。";
  if (block.language === "python" || /^\s*def\s/m.test(block.text)) {
    const lines = normalizeBlankText(block.text).split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("#"));
    const indent = (line: string) => line.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:def|class|if|elif|else|for|while|try|except|finally|with)\b.*:\s*(?:#.*)?$/.test(lines[i]) && (!lines[i + 1] || indent(lines[i + 1]) <= indent(lines[i]))) return "Python 代码块缺少必要缩进，请先纠正原讲解。";
    }
  }
}

type StudyCard = { front: string; back: string; legacyFront: string; legacyBack: string; issue?: string };

function quizCard(block: QuizBlock): StudyCard {
  const answer = block.options[block.answer];
  return {
    front: `${block.question}\n\n${block.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join("\n\n")}`,
    back: `答案：${String.fromCharCode(65 + block.answer)}. ${answer}\n\n解析：${block.explanation}`,
    legacyFront: block.question,
    legacyBack: `答案：${answer}${block.explanation ? `\n解析：${block.explanation}` : ""}`,
    issue: questionIssue(block.question),
  };
}

function blankCard(block: FillBlankBlock): StudyCard {
  let index = 0;
  const text = normalizeBlankText(block.text).replace(/___/g, () => `[空${++index}]`);
  const body = isCodeBlank(block) ? `\`\`\`${block.language ?? ""}\n${text}\n\`\`\`` : text;
  const back = block.blanks.map((blank, i) => `空${i + 1}：${blank.options[blank.answer]}${blank.explanation ? ` —— ${blank.explanation}` : ""}`).join("\n\n");
  return {
    front: `${block.prompt ?? "完成下面的填空"}\n\n${body}\n\n${block.blanks.map((blank, i) => `空${i + 1}选项：${blank.options.map((option, j) => `${String.fromCharCode(65 + j)}. ${option}`).join("；")}`).join("\n\n")}`,
    back,
    legacyFront: `${block.prompt ? `${block.prompt}\n` : ""}${block.text}`,
    legacyBack: block.blanks.map((blank, i) => `空${i + 1}：${blank.options[blank.answer]}${blank.explanation ? ` —— ${blank.explanation}` : ""}`).join("\n"),
    issue: blankIssue(block),
  };
}

export function studyCards(doc: ExplainDoc): StudyCard[] {
  return doc.blocks.flatMap((block) => block.type === "quiz" ? [quizCard(block)] : block.type === "fillBlank" ? [blankCard(block)] : []);
}

/** 仅匹配未编辑的自动提取结果，保留手写卡及用户修改。 */
export function completeStudyCard<T extends { front: string; back: string }>(card: T, doc: ExplainDoc): T & { issue?: string } {
  const matches = studyCards(doc).filter((candidate) =>
    (card.front === candidate.legacyFront && card.back === candidate.legacyBack) ||
    (card.front === candidate.front && card.back === candidate.back));
  if (matches.length !== 1) return card;
  const { front, back, issue } = matches[0];
  return { ...card, front, back, issue };
}

/** 只拦截新生成的教学缺陷，不改变存量文档的读取契约。 */
export function teachingContentIssue(doc: ExplainDoc): string | null {
  for (const [i, block] of doc.blocks.entries()) {
    if (block.type === "quiz" && questionIssue(block.question)) return `blocks[${i}].question 题干残缺，必须补全问题，不能以逗号结束`;
    const optionLists = block.type === "quiz" ? [block.options] : block.type === "fillBlank" ? block.blanks.map((blank) => blank.options) : [];
    if (optionLists.some((options) => new Set(options.map((option) => option.trim())).size !== options.length)) return `blocks[${i}] 存在重复选项，无法唯一作答，请改写为互不重复的选项`;
    if (block.type === "fillBlank" && isCodeBlank(block)) {
      if (blankIssue(block) || /<br\b/i.test(block.text)) return `blocks[${i}].text 代码填空必须使用 JSON 换行符并保留缩进，不能单行平铺或使用 HTML br`;
    }
    if (block.type === "chart") {
      const slots = block.series.flatMap((series) => series.data);
      const bindings = slots.filter((slot) => typeof slot !== "number").length;
      if (bindings === 1 && slots.length > 1 && !block.interactionHint) return `blocks[${i}] 只有一个数据点绑定滑块：请按讲解意图补全联动，或用 interactionHint 明确哪些数据是固定参考值`;
    }
  }
  return null;
}
