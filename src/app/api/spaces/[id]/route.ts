import { NextResponse } from "next/server";
import { deleteSpace, getSpace, updateSpace } from "@/lib/db/spaces";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = parseId(id);
  const space = numeric !== null ? getSpace(numeric) : null;
  if (!space) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  return NextResponse.json({ space });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = parseId(id);
  if (numeric === null) return NextResponse.json({ error: "无效的空间 id" }, { status: 400 });
  let body: { name?: unknown; note?: unknown; examDate?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!getSpace(numeric)) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  updateSpace(numeric, {
    ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
    ...(typeof body.note === "string" ? { note: body.note.trim() } : {}),
    ...(body.examDate === null || (typeof body.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.examDate))
      ? { examDate: body.examDate as string | null }
      : {}),
  });
  return NextResponse.json({ space: getSpace(numeric) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = parseId(id);
  if (numeric === null) return NextResponse.json({ error: "无效的空间 id" }, { status: 400 });
  deleteSpace(numeric);
  return NextResponse.json({ ok: true });
}
