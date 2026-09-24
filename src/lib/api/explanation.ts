/** 前端 API 调用层：组件不直接 fetch，统一从这里走（SSE 流式） */
import type { ExplainDoc } from "@/lib/dsl/schema";

interface StreamHandlers {
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "done"; doc?: ExplainDoc }
  | { type: "error"; message: string };

async function openSSE(url: string, body: unknown, signal?: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data: unknown = await res.json().catch(() => null);
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `请求失败（${res.status}）`;
    throw new Error(message);
  }
  return res.body.getReader();
}

/** 解析 SSE 事件流；onEvent 返回非 null 时提前结束并返回该值 */
async function consumeSSE<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: SSEEvent) => T | null
): Promise<T> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error("连接中断，请重试");
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        const parsed = JSON.parse(payload) as SSEEvent & { message?: string };
        if (parsed.type === "error") throw new Error(parsed.message ?? "服务错误");
        const early = onEvent(parsed);
        if (early !== null) return early;
      }
    }
  }
}

export async function streamExplanation(
  kind: "generate" | "refine",
  body: unknown,
  { onDelta, signal }: StreamHandlers
): Promise<ExplainDoc> {
  const reader = await openSSE(`/api/${kind}`, body, signal);
  return consumeSSE(reader, (event) => {
    if (event.type === "delta" && event.text) onDelta(event.text);
    if (event.type === "done" && event.doc) return event.doc;
    return null;
  });
}

export async function streamAsk(
  doc: ExplainDoc,
  question: string,
  { onDelta, signal }: StreamHandlers
): Promise<string> {
  const reader = await openSSE("/api/ask", { doc, question }, signal);
  let full = "";
  await consumeSSE(reader, (event) => {
    if (event.type === "delta" && event.text) {
      full += event.text;
      onDelta(event.text);
    }
    if (event.type === "done") return true;
    return null;
  });
  return full;
}
