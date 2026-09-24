/**
 * 生成管线：LLM 原始输出 → JSON 提取 → zod 校验 → 一次自修复重试。
 * 服务端专用（依赖环境变量中的 API Key）。
 */
import { chat, type ChatMessage } from "@/lib/llm/client";
import {
  generateSystemPrompt,
  refineSystemPrompt,
  repairSystemPrompt,
} from "@/lib/llm/prompts";
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

/** 校验失败时携带错误让 LLM 自修复一次 */
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

export async function generateDoc(concept: string): Promise<ExplainDoc> {
  const history: ChatMessage[] = [
    { role: "system", content: generateSystemPrompt() },
    { role: "user", content: `概念：${concept}` },
  ];
  const raw = await chat(history, { jsonMode: true, temperature: 0.4 });
  return withRepair(raw, history);
}

export async function refineDoc(doc: ExplainDoc, instruction: string): Promise<ExplainDoc> {
  const history: ChatMessage[] = [
    { role: "system", content: refineSystemPrompt() },
    {
      role: "user",
      content: `当前文档：\n${JSON.stringify(doc, null, 2)}\n\n改造指令：${instruction}`,
    },
  ];
  const raw = await chat(history, { jsonMode: true, temperature: 0.3 });
  return withRepair(raw, history);
}
