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
  return parsed as ExplainDoc;
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

/** 主模型流式生成；onDelta 透出原始增量供前端构建流面板展示 */
export async function generateDoc(
  concept: string,
  onDelta?: (text: string) => void
): Promise<ExplainDoc> {
  const history: ChatMessage[] = [
    { role: "system", content: generateSystemPrompt() },
    { role: "user", content: `概念：${concept}` },
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

/** 追问：基于当前文档的流式短回答，纯文本、不改文档 */
export async function askQuestion(
  doc: ExplainDoc,
  question: string,
  onDelta: (text: string) => void
): Promise<string> {
  const { fastModel } = llmConfigFromEnv();
  return streamChat(
    [
      { role: "system", content: askSystemPrompt() },
      { role: "user", content: `当前讲解文档：\n${JSON.stringify(doc, null, 2)}\n\n用户提问：${question}` },
    ],
    { temperature: 0.3, model: fastModel },
    onDelta
  );
}
