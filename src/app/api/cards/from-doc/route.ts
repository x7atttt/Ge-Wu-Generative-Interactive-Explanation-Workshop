import { NextResponse } from "next/server";
import { createCardsFromDoc } from "@/lib/db/cards";

/** 从讲解的 quiz/填空块提取复习卡（机械转换，零 LLM）；重复提取按题面去重 */
export async function POST(req: Request) {
  let body: { docId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const docId = body.docId;
  if (typeof docId !== "number" || !Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "无效的 docId" }, { status: 400 });
  }
  const { added, skipped } = createCardsFromDoc(docId);
  if (added === 0 && skipped === 0) {
    return NextResponse.json({ error: "讲解不存在，或没有可提取的自测题/填空" }, { status: 400 });
  }
  return NextResponse.json({ added, skipped });
}
