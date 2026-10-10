/**
 * 生成管线：LLM 流式输出 → JSON 提取 → zod 校验 → 一次自修复重试。
 * 服务端专用（依赖环境变量中的 API Key）。
 */
import { chat, streamChat, type ChatMessage } from "@/lib/llm/client";
import {
  askSystemPrompt,
  generateSystemPrompt,
  refineSystemPrompt,
  repairSystemPrompt,
} from "@/lib/llm/prompts";
import { llmConfigFromEnv } from "@/lib/llm/client";
import type { SearchRef } from "@/lib/search/bocha";
import { validateDoc, type ExplainDoc } from "./schema";

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
  const issues = validateDoc(parsed);
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

/** 校验失败时携带错误让 LLM 自修复一次（非流式，罕见路径不值得流式复杂度） */
async function withRepair(raw: string, history: ChatMessage[]): Promise<ExplainDoc> {
  const toMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
  try {
    return parseAndValidate(raw);
  } catch (firstError) {
    const repaired = await chat(
      [
        { role: "system", content: repairSystemPrompt() },
        ...history,
        { role: "assistant", content: raw.slice(0, 8000) },
        {
          role: "user",
          content: `上面的输出存在问题：${toMessage(firstError)}\n请输出修复后的完整 JSON 文档。`,
        },
      ],
      { jsonMode: true, temperature: 0.1 }
    );
    try {
      return parseAndValidate(repaired);
    } catch (secondError) {
      throw new DslError(`生成的内容未通过结构校验（已自动修复一次）：${toMessage(secondError)}`);
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

/** generateDoc 的可选输入：网络资料 / 语气人设 / 补练统计 */
export interface GenerateExtras {
  refs?: SearchRef[];
  personaStyle?: string | null;
  /** 补练模式：用户在该概念的练习统计行（服务端聚合后传入） */
  practiceLines?: string[];
}

/** 主模型流式生成；onDelta 透出原始增量供前端构建流面板展示 */
export async function generateDoc(
  concept: string,
  extras: GenerateExtras = {},
  onDelta?: (text: string) => void
): Promise<ExplainDoc> {
  const sections: string[] = [`概念：${concept}`];
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
    { role: "user", content: sections.join("\n\n") },
  ];
  const raw = onDelta
    ? await streamChat(history, { jsonMode: true, temperature: 0.4 }, onDelta)
    : await chat(history, { jsonMode: true, temperature: 0.4 });
  return withRepair(raw, history);
}

/** 改造走 fast 模型（未配置回落主模型） */
export async function refineDoc(
  doc: ExplainDoc,
  instruction: string,
  onDelta?: (text: string) => void
): Promise<ExplainDoc> {
  const { fastModel } = llmConfigFromEnv();
  const history: ChatMessage[] = [
    { role: "system", content: refineSystemPrompt() },
    {
      role: "user",
      content: `当前文档：\n${JSON.stringify(doc, null, 2)}\n\n改造指令：${instruction}`,
    },
  ];
  const options = { jsonMode: true, temperature: 0.3, model: fastModel };
  const raw = onDelta
    ? await streamChat(history, options, onDelta)
    : await chat(history, options);
  return withRepair(raw, history);
}

/** 追问的既有对话轮次（user/assistant 交替），由路由层从库中组装 */
export interface AskExchange {
  role: "user" | "assistant";
  content: string;
}

/** 发给 LLM 的历史上下文只取最近 6 轮（12 条消息），完整历史在库中 */
const ASK_CONTEXT_TURNS = 6;

/** 追问：基于当前文档 + 最近对话历史的流式短回答，纯文本、不改文档；personaStyle 可选语气 */
export async function askQuestion(
  doc: ExplainDoc,
  history: AskExchange[],
  question: string,
  onDelta: (text: string) => void,
  personaStyle?: string | null
): Promise<string> {
  const { fastModel } = llmConfigFromEnv();
  const trimmed = history.slice(-ASK_CONTEXT_TURNS * 2);
  return streamChat(
    [
      { role: "system", content: askSystemPrompt(personaStyle) },
      { role: "user", content: `当前讲解文档：\n${JSON.stringify(doc, null, 2)}` },
      ...trimmed.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: question },
    ],
    { temperature: 0.3, model: fastModel },
    onDelta
  );
}
