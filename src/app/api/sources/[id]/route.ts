import { NextResponse } from "next/server";
import { deleteSource, setSourceSpace } from "@/lib/db/sources";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return NextResponse.json({ error: "无效的资料 id" }, { status: 400 });
  }
  deleteSource(numeric);
  return NextResponse.json({ ok: true });
}

/** 移动资料归属：{spaceId: number|null}（null = 移回未分组） */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return NextResponse.json({ error: "无效的资料 id" }, { status: 400 });
  }
  let body: { spaceId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (body.spaceId !== null && !(typeof body.spaceId === "number" && Number.isInteger(body.spaceId) && body.spaceId > 0)) {
    return NextResponse.json({ error: "spaceId 必须是正整数或 null" }, { status: 400 });
  }
  setSourceSpace(numeric, body.spaceId as number | null);
  return NextResponse.json({ ok: true });
}
