import { NextResponse } from "next/server";
import { ATTEMPT_TYPES, insertAttempt, type AttemptType } from "@/lib/db/attempts";

/** 练习判定上报（fire-and-forget：前端失败静默，不影响练习交互） */
export async function POST(req: Request) {
  let body: { docId?: unknown; blockType?: unknown; correct?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const { docId, blockType, correct } = body;
  if (
    typeof docId !== "number" ||
    !Number.isInteger(docId) ||
    docId <= 0 ||
    typeof blockType !== "string" ||
    !ATTEMPT_TYPES.includes(blockType as AttemptType) ||
    typeof correct !== "boolean"
  ) {
    return NextResponse.json({ error: "参数非法" }, { status: 400 });
  }

  insertAttempt(docId, blockType as AttemptType, correct);
  return NextResponse.json({ ok: true });
}
