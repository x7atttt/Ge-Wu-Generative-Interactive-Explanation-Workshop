import { NextResponse } from "next/server";
import { createSpace, listSpaces } from "@/lib/db/spaces";

export async function GET() {
  return NextResponse.json({ spaces: listSpaces() });
}

export async function POST(req: Request) {
  let body: { name?: unknown; note?: unknown; examDate?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "请输入空间名称" }, { status: 400 });
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const examDate =
    typeof body.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.examDate) ? body.examDate : null;
  const id = createSpace({ name, note, examDate });
  return NextResponse.json({ id });
}
