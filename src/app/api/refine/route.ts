import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { insertDoc } from "@/lib/db/docs";
import { refineDoc } from "@/lib/dsl/generate";
import { explainDocSchema } from "@/lib/dsl/schema";

export async function POST(req: Request) {
  let body: { doc?: unknown; instruction?: unknown; docId?: unknown };
  try {
    body = (await req.json()) as { doc?: unknown; instruction?: unknown; docId?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const instruction = body.instruction;
  if (typeof instruction !== "string" || !instruction.trim()) {
    return NextResponse.json({ error: "请输入改造指令" }, { status: 400 });
  }
  if (instruction.length > 300) {
    return NextResponse.json({ error: "改造指令请控制在 300 字以内" }, { status: 400 });
  }

  // 入站的当前文档必须仍合法，防止脏数据进入生成层
  const parsed = explainDocSchema.safeParse(body.doc);
  if (!parsed.success) {
    return NextResponse.json({ error: "当前文档结构非法，无法改造" }, { status: 400 });
  }

  const parentDocId =
    typeof body.docId === "number" && Number.isInteger(body.docId) && body.docId > 0
      ? body.docId
      : null;

  return sseResponse(async (send) => {
    try {
      const doc = await refineDoc(parsed.data, instruction.trim(), (text) =>
        send({ type: "delta", text })
      );
      const docId = insertDoc(doc, parentDocId, instruction.trim());
      send({ type: "done", doc, docId });
    } catch (err) {
      console.error("[api/refine]", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "改造失败，请稍后重试",
      });
    }
  });
}
