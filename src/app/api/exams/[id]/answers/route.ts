import { NextResponse } from "next/server";
import { z } from "zod";
import { answerExam, ExamError } from "@/lib/db/exams";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = z.object({ cardId: z.number().int().positive(), grade: z.enum(["again", "fuzzy", "easy", "skipped"]) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "需要有效的 cardId 与评分" }, { status: 400 });
  try {
    return NextResponse.json({ session: answerExam((await params).id, parsed.data.cardId, parsed.data.grade) });
  } catch (err) {
    if (err instanceof ExamError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
