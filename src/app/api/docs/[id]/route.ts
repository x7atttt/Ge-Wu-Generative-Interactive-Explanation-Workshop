import { NextResponse } from "next/server";
import { listAsks } from "@/lib/db/asks";
import { getDoc } from "@/lib/db/docs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "docId 非法" }, { status: 400 });
  }
  const row = getDoc(docId);
  if (!row) {
    return NextResponse.json({ error: "讲解不存在或已损坏" }, { status: 404 });
  }
  return NextResponse.json({ docId: row.id, doc: row.doc, asks: listAsks(docId) });
}
