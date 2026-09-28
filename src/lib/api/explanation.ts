/** 前端 API 调用层：组件不直接 fetch，统一从这里走（SSE 流式 + 持久化数据加载） */
import type { AskItem } from "@/components/dsl/AskPanel";
import type { Block, ExplainDoc } from "@/lib/dsl/schema";

interface StreamHandlers {
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "done"; doc?: ExplainDoc; docId?: number }
  | { type: "error"; message: string };

export interface DocResult {
  doc: ExplainDoc;
  docId: number;
}

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
        const parsed = JSON.parse(payload) as SSEEvent;
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
): Promise<DocResult> {
  const reader = await openSSE(`/api/${kind}`, body, signal);
  return consumeSSE(reader, (event) => {
    if (event.type === "delta" && event.text) onDelta(event.text);
    if (event.type === "done" && event.doc && typeof event.docId === "number") {
      return { doc: event.doc, docId: event.docId };
    }
    return null;
  });
}

export async function streamAsk(
  docId: number,
  question: string,
  { onDelta, signal }: StreamHandlers
): Promise<string> {
  const reader = await openSSE("/api/ask", { docId, question }, signal);
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

export interface DocSummary {
  id: number;
  title: string;
  createdAt: string;
}

export async function listDocs(): Promise<DocSummary[]> {
  const res = await fetch("/api/docs");
  if (!res.ok) throw new Error(`历史加载失败（${res.status}）`);
  const data = (await res.json()) as { docs: DocSummary[] };
  return data.docs;
}

/** 恢复一篇历史讲解：文档 + 已有问答 + 深化分组信息（指令与父版本块） */
export async function loadDoc(
  docId: number
): Promise<{ doc: ExplainDoc; asks: AskItem[]; instruction: string | null; parentBlocks: Block[] | null }> {
  const res = await fetch(`/api/docs/${docId}`);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `加载失败（${res.status}）`;
    throw new Error(message);
  }
  const payload = data as {
    doc: ExplainDoc;
    asks: { role: "user" | "assistant"; content: string }[];
    instruction: string | null;
    parentBlocks: Block[] | null;
  };
  const asks: AskItem[] = [];
  for (const row of payload.asks) {
    if (row.role === "user") asks.push({ question: row.content, answer: "", done: false });
    else if (asks.length > 0) {
      asks[asks.length - 1].answer = row.content;
      asks[asks.length - 1].done = true;
    }
  }
  return {
    doc: payload.doc,
    asks,
    instruction: payload.instruction ?? null,
    parentBlocks: payload.parentBlocks ?? null,
  };
}
