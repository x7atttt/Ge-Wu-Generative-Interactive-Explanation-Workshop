import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { appendAsks, listAsks } from "@/lib/db/asks";
import { getDoc } from "@/lib/db/docs";
import { askQuestion } from "@/lib/dsl/generate";

export async function POST(req: Request) {
  let body: { docId?: unknown; question?: unknown };
  try {
    body = (await req.json()) as { docId?: unknown; question?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const docId = body.docId;
  if (typeof docId !== "number" || !Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "docId 非法" }, { status: 400 });
  }

  const question = body.question;
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  }
  if (question.length > 300) {
    return NextResponse.json({ error: "问题请控制在 300 字以内" }, { status: 400 });
  }

  const row = getDoc(docId);
  if (!row) {
    return NextResponse.json({ error: "讲解不存在或已损坏" }, { status: 404 });
  }

  const history = listAsks(docId).map((ask) => ({ role: ask.role, content: ask.content }));

  return sseResponse(async (send) => {
    try {
      const answer = await askQuestion(
        row.doc,
        history,
        question.trim(),
        (text) => send({ type: "delta", text })
      );
      // 成功的问答才成对入库，失败轮次不污染后续上下文
      appendAsks(docId, [
        { role: "user", content: question.trim() },
        { role: "assistant", content: answer },
      ]);
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
