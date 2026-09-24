import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { askQuestion } from "@/lib/dsl/generate";
import { explainDocSchema } from "@/lib/dsl/schema";

export async function POST(req: Request) {
  let body: { doc?: unknown; question?: unknown };
  try {
    body = (await req.json()) as { doc?: unknown; question?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const question = body.question;
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  }
  if (question.length > 300) {
    return NextResponse.json({ error: "问题请控制在 300 字以内" }, { status: 400 });
  }

  const parsed = explainDocSchema.safeParse(body.doc);
  if (!parsed.success) {
    return NextResponse.json({ error: "当前文档结构非法，无法追问" }, { status: 400 });
  }

  return sseResponse(async (send) => {
    try {
      await askQuestion(parsed.data, question.trim(), (text) => send({ type: "delta", text }));
      send({ type: "done" });
    } catch (err) {
      console.error("[api/ask]", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "回答失败，请稍后重试",
      });
    }
  });
}
