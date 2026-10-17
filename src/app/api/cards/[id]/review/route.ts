import { NextResponse } from "next/server";
import { reviewCard } from "@/lib/db/cards";
import type { ReviewGrade } from "@/lib/fsrs";

const GRADES: readonly ReviewGrade[] = ["again", "fuzzy", "easy"];

/** 复习评分：应用 FSRS 调度并写回 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return NextResponse.json({ error: "无效的卡片 id" }, { status: 400 });
  }
  let body: { grade?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body.grade !== "string" || !GRADES.includes(body.grade as ReviewGrade)) {
    return NextResponse.json({ error: "grade 必须是 again | fuzzy | easy" }, { status: 400 });
  }
  const card = reviewCard(cardId, body.grade as ReviewGrade);
  if (!card) return NextResponse.json({ error: "卡片不存在" }, { status: 404 });
  return NextResponse.json({ card });
}
