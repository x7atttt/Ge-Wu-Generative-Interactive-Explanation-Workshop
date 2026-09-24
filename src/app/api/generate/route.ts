import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { generateDoc } from "@/lib/dsl/generate";

export async function POST(req: Request) {
  let concept: unknown;
  try {
    const body: unknown = await req.json();
    concept = (body as { concept?: unknown } | null)?.concept;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof concept !== "string" || !concept.trim()) {
    return NextResponse.json({ error: "请输入要讲解的概念" }, { status: 400 });
  }
  if (concept.length > 200) {
    return NextResponse.json({ error: "概念描述请控制在 200 字以内" }, { status: 400 });
  }

  return sseResponse(async (send) => {
    try {
      const doc = await generateDoc(concept.trim(), (text) => send({ type: "delta", text }));
      send({ type: "done", doc });
    } catch (err) {
      console.error("[api/generate]", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "生成失败，请稍后重试",
      });
    }
  });
}
