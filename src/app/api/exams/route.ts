import { NextResponse } from "next/server";
import { z } from "zod";
import { getSpace } from "@/lib/db/spaces";
import { ExamError, listExams, startExam } from "@/lib/db/exams";

export async function GET(req: Request) {
  const spaceId = Number(new URL(req.url).searchParams.get("spaceId"));
  if (!Number.isSafeInteger(spaceId) || spaceId <= 0) return NextResponse.json({ error: "无效的空间 id" }, { status: 400 });
  if (!getSpace(spaceId)) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  return NextResponse.json({ sessions: listExams(spaceId) });
}

export async function POST(req: Request) {
  const parsed = z.object({ spaceId: z.number().int().positive() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "需要有效的 spaceId" }, { status: 400 });
  if (!getSpace(parsed.data.spaceId)) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  try {
    return NextResponse.json({ session: startExam(parsed.data.spaceId) });
  } catch (err) {
    if (err instanceof ExamError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
