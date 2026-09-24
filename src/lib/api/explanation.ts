/** 前端 API 调用层：组件不直接 fetch，统一从这里走 */
import type { ExplainDoc } from "@/lib/dsl/schema";

async function postJson<TRes>(url: string, body: unknown): Promise<TRes> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `请求失败（${res.status}）`;
    throw new Error(message);
  }
  return data as TRes;
}

export async function generateExplanation(concept: string): Promise<ExplainDoc> {
  const { doc } = await postJson<{ doc: ExplainDoc }>("/api/generate", { concept });
  return doc;
}

export async function refineExplanation(
  doc: ExplainDoc,
  instruction: string
): Promise<ExplainDoc> {
  const { doc: next } = await postJson<{ doc: ExplainDoc }>("/api/refine", { doc, instruction });
  return next;
}
