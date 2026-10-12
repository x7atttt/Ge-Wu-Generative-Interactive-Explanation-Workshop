import { NextResponse } from "next/server";
import { deleteSource } from "@/lib/db/sources";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return NextResponse.json({ error: "无效的资料 id" }, { status: 400 });
  }
  deleteSource(numeric);
  return NextResponse.json({ ok: true });
}
