import { NextResponse } from "next/server";
import { getExam } from "@/lib/db/exams";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = getExam((await params).id);
  if (!session) return NextResponse.json({ error: "自测记录不存在" }, { status: 404 });
  return NextResponse.json({ session });
}
