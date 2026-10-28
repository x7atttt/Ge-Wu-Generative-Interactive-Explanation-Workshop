/**
 * 生成管线：LLM 输出 → 结构/算例校验 → 内容复核；共享一次修复机会。
 * 服务端专用（依赖环境变量中的 API Key）。
 */
import { chat, streamChat, withImages, type ChatMessage, type RequestControl } from "@/lib/llm/client";
import {
  askSystemPrompt,
  generateSystemPrompt,
  refineSystemPrompt,
  repairSystemPrompt,
} from "@/lib/llm/prompts";
import { llmConfigFromEnv } from "@/lib/llm/client";
import type { SearchRef } from "@/lib/search/bocha";
import { validateDoc, type ExplainDoc } from "./schema";
import { teachingContentIssue } from "@/lib/study-content";
import type { GenerationStage } from "@/lib/generation-progress";
import type { ReasoningEffort } from "@/lib/effort";
import { factorialFacts, factorialFormulaIssue, factorialPremiseIssue, partitionFacts, reviewContent } from "./content-review";
import { isAppendVersion } from "./deepen";

export class DslError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DslError";
  }
}

/** 剥离可能的 markdown 代码栅栏，并截取首尾大括号之间的内容 */
function extractJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new DslError("LLM 输出中未找到 JSON 对象");
  }
  return text.slice(first, last + 1);
}

function parseAndValidate(raw: string): ExplainDoc {
  const jsonText = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new DslError("LLM 输出不是合法 JSON");
  }
  const issues = validateDoc(parsed, { rejectUnknownFields: true });
  if (issues) throw new DslError(`文档结构校验失败：${issues}`);
  const chartIssue = strictChartChecks(parsed as ExplainDoc);
  if (chartIssue) throw new DslError(`文档结构校验失败：${chartIssue}`);
  return parsed as ExplainDoc;
}

/**
 * 生成期严格校验（比存储 schema 更严，仅新生成/修复路径使用，存量文档仍可加载）：
 * chart 的每个系列数据点数必须与 categories 一致——数量错位 ECharts 会静默少画，
 * 折线断头且形状失真（实测：5 个角度只给 4 个值）。
 */
function strictChartChecks(doc: ExplainDoc): string | null {
  for (const [i, block] of doc.blocks.entries()) {
    if (block.type !== "chart" || !block.categories) continue;
    for (const [j, serie] of block.series.entries()) {
      if (serie.data.length !== block.categories.length) {
        return `blocks[${i}].series[${j}].data 有 ${serie.data.length} 个值，但 categories 有 ${block.categories.length} 个，数量必须一致`;
      }
    }
  }
  return null;
}

/** 结构和内容共享一次修复；复核服务异常直接停止，不用改写文档掩盖检查失败。 */
async function withRepair(raw: string, history: ChatMessage[], onStage?: (stage: GenerationStage) => void, effort?: ReasoningEffort, control: RequestControl = {}, reviewContext: ChatMessage[] = history, preserved?: ExplainDoc): Promise<ExplainDoc> {
  control.signal?.throwIfAborted();
  const toMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
  let original: ExplainDoc | undefined;
  const verify = async (text: string) => {
    onStage?.("verify");
    const doc = parseAndValidate(text);
    if (preserved && (doc.title !== preserved.title || !isAppendVersion(preserved.blocks, doc.blocks))) {
      throw new DslError("补充讲解必须保留当前标题与全部原有块，逐字不变且顺序一致，仅在末尾追加新块。请从用户提供的当前文档恢复原文；如需改写，用户应使用修订原文。");
    }
    if (original && ["quiz", "fillBlank", "match", "sort"].some((type) => doc.blocks.filter((block) => block.type === type).length < original!.blocks.filter((block) => block.type === type).length)) {
      throw new DslError("内容修复不得删减原有练习，请纠正题面、答案与解析后重新提交");
    }
    original ??= doc;
    const contentIssue = teachingContentIssue(doc);
    if (contentIssue) throw new DslError(`教学内容校验失败：${contentIssue}`);
    const arithmeticIssue = factorialFormulaIssue(doc) ?? factorialPremiseIssue(doc);
    if (arithmeticIssue) throw new DslError(`算例校验失败：${arithmeticIssue}`);
    onStage?.("review");
    const issue = await reviewContent(doc, reviewContext, control);
    if (issue) throw new DslError(`内容一致性复核未通过：${issue}`);
    return doc;
  };
  try {
    return await verify(raw);
  } catch (firstError) {
    if (!(firstError instanceof DslError)) throw firstError;
    onStage?.("repair");
    const repaired = await chat(
      [
        // 一条系统消息保留文档规范，末尾明确当前修复任务；原文必须完整，尾部可能正是错误位置。
        { role: "system", content: [...history.filter((message) => message.role === "system").map((message) => message.content), repairSystemPrompt()].join("\n\n") },
        ...history.filter((message) => message.role !== "system"),
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `上面的输出存在问题：${toMessage(firstError)}\n${original ? `程序复算参考（仅适用注明的标准约定）：${JSON.stringify({ factorials: factorialFacts(original), partitions: partitionFacts(original) })}\n` : ""}请输出修复后的完整 JSON 文档。`,
        },
      ],
      { jsonMode: true, temperature: 0.1, purpose: "repair", effort, ...control }
    );
    try {
      return await verify(repaired);
    } catch (secondError) {
      if (!(secondError instanceof DslError)) throw secondError;
      throw new DslError(`生成的内容未通过校验（已自动修复一次）：${toMessage(secondError)}`);
    }
  }
}

/** 参考资料（网络检索）格式化为编号列表；只带标题/站点/日期与摘要，不带链接 */
function formatRefs(refs: SearchRef[]): string {
  return refs
    .map((ref, i) => {
      const meta = [ref.siteName, ref.date].filter(Boolean).join("，");
      return `[${i + 1}] ${ref.title}${meta ? `（${meta}）` : ""}\n${ref.summary}`;
    })
    .join("\n\n");
}

/** 单篇资料注入上限；超长头尾各半保留（开头的定义与结尾的总结通常最有讲解价值） */
const SOURCE_SINGLE_CAP = 16_000;
const SOURCE_HEAD_TAIL = 8_000;
/** 多篇资料总预算：按顺序分配，装不下的整篇丢弃并标注 */
const SOURCE_TOTAL_CAP = 40_000;

function clipSourceContent(content: string): string {
  if (content.length <= SOURCE_SINGLE_CAP) return content;
  return `${content.slice(0, SOURCE_HEAD_TAIL)}\n\n……（中间内容过长已省略）……\n\n${content.slice(-SOURCE_HEAD_TAIL)}`;
}

/** 源文档资料格式化：带总预算的截断，保证注入用户消息的规模可控 */
export function formatSources(sources: { title: string; content: string }[]): string {
  let budget = SOURCE_TOTAL_CAP;
  const parts: string[] = [];
  for (const [i, source] of sources.entries()) {
    const clipped = clipSourceContent(source.content);
    if (clipped.length > budget) {
      parts.push(`（第 ${i + 1} 篇《${source.title}》因资料总量超限未注入，仅保留标题参考）`);
      continue;
    }
    budget -= clipped.length;
    parts.push(`《${source.title}》\n${clipped}`);
  }
  return parts.join("\n\n---\n\n");
}

/** generateDoc 的可选输入：源文档资料 / 网络资料 / 语气人设 / 补练统计 / 拍摄图片 */
export interface GenerateExtras extends RequestControl {
  effort?: ReasoningEffort;
  /** 用户导入并选用的资料（已解析为 Markdown，服务端已加载） */
  sources?: { title: string; content: string }[];
  refs?: SearchRef[];
  personaStyle?: string | null;
  /** 补练模式：用户在该概念的练习统计行（服务端聚合后传入） */
  practiceLines?: string[];
  /** 用户拍摄的图片（data URL）：拍题生成的语境，单次消费不落库 */
  images?: string[];
}

/** 主模型流式生成；onDelta 透出原始增量供前端构建流面板展示 */
export async function generateDoc(
  concept: string,
  extras: GenerateExtras = {},
  onDelta?: (text: string) => void,
  onStage?: (stage: GenerationStage) => void
): Promise<ExplainDoc> {
  const images = extras.images ?? [];
  const sections: string[] = [`概念：${concept}`];
  if (images.length > 0) {
    sections.push(`（用户附带了 ${images.length} 张图片——拍摄/截图的学习材料（题目、教材、笔记等），讲解围绕图片内容展开，概念名按图片主题确定）`);
  }
  if (extras.sources && extras.sources.length > 0) {
    sections.push(`源文档资料（用户导入的文档，讲解的事实依据）：\n${formatSources(extras.sources)}`);
  }
  if (extras.refs && extras.refs.length > 0) {
    sections.push(`参考资料（网络检索结果）：\n${formatRefs(extras.refs)}`);
  }
  if (extras.practiceLines && extras.practiceLines.length > 0) {
    sections.push(`练习统计（用户在该概念的作答记录，正确率反映薄弱点）：\n${extras.practiceLines.join("\n")}`);
  }
  const history: ChatMessage[] = [
    {
      role: "system",
      content: generateSystemPrompt({
        personaStyle: extras.personaStyle,
        practice: !!extras.practiceLines?.length,
      }),
    },
    { role: "user", content: withImages(sections.join("\n\n"), images) },
  ];
  const raw = onDelta
    ? await streamChat(history, { jsonMode: true, temperature: 0.4, purpose: "generate", effort: extras.effort, signal: extras.signal, onRetry: extras.onRetry, onThinking: extras.onThinking }, onDelta)
    : await chat(history, { jsonMode: true, temperature: 0.4, purpose: "generate", effort: extras.effort, signal: extras.signal, onRetry: extras.onRetry });
  return withRepair(raw, history, onStage, extras.effort, { signal: extras.signal, onRetry: extras.onRetry });
}

/** 改造走 fast 模型（未配置回落主模型） */
export async function refineDoc(
  doc: ExplainDoc,
  instruction: string,
  onDelta?: (text: string) => void,
  onStage?: (stage: GenerationStage) => void,
  effort?: ReasoningEffort,
  control: RequestControl = {},
  mode: "append" | "revise" = "revise"
): Promise<ExplainDoc> {
  const { fastModel } = llmConfigFromEnv();
  const history: ChatMessage[] = [
    { role: "system", content: refineSystemPrompt(mode) },
    {
      role: "user",
      content: `当前文档：\n${JSON.stringify(doc, null, 2)}\n\n改造指令：${instruction}`,
    },
  ];
  const options = { jsonMode: true, temperature: 0.3, purpose: "refine" as const, model: fastModel, effort, ...control };
  const raw = onDelta
    ? await streamChat(history, options, onDelta)
    : await chat(history, options);
  // 复核已收到完整新文档；旧文档仅留给改造与必要的修复，避免重复传输。
  return withRepair(raw, history, onStage, effort, control, [{ role: "user", content: `本次为${mode === "append" ? "追加补充" : "修订原文"}。改造指令：${instruction}` }], mode === "append" ? doc : undefined);
}

/** 追问的既有对话轮次（user/assistant 交替），由路由层从库中组装 */
export interface AskExchange {
  role: "user" | "assistant";
  content: string;
}

/** 发给 LLM 的历史上下文只取最近 6 轮（12 条消息），完整历史在库中 */
const ASK_CONTEXT_TURNS = 6;

/** 追问：基于当前文档 + 最近对话历史的流式短回答，纯文本、不改文档；personaStyle 可选语气；
 *  images（data URL）只随当前这轮问题发送——历史轮次不重发图（视觉 token 省钱，当前轮语境已够） */
export async function askQuestion(
  doc: ExplainDoc,
  history: AskExchange[],
  question: string,
  onDelta: (text: string) => void,
  personaStyle?: string | null,
  images: string[] = [],
  effort?: ReasoningEffort,
  control: RequestControl = {}
): Promise<string> {
  const { fastModel } = llmConfigFromEnv();
  const trimmed = history.slice(-ASK_CONTEXT_TURNS * 2);
  const askText =
    images.length > 0
      ? `${question}\n（附 ${images.length} 张图片，问题围绕图片内容）`
      : question;
  return streamChat(
    [
      { role: "system", content: askSystemPrompt(personaStyle) },
      { role: "user", content: `当前讲解文档：\n${JSON.stringify(doc, null, 2)}` },
      ...trimmed.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: withImages(askText, images) },
    ],
    { temperature: 0.3, purpose: "ask", model: fastModel, effort, ...control },
    onDelta
  );
}
