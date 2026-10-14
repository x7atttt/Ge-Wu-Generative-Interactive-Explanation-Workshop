import { NextResponse } from "next/server";
import { listAsks } from "@/lib/db/asks";
import { deleteDocTree, getDoc, type DocRow } from "@/lib/db/docs";
import type { Block } from "@/lib/dsl/schema";

const MAX_CHAIN_DEPTH = 20;

/** 删除讲解及其深化子树（追问/练习/复习卡级联清理） */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "docId 非法" }, { status: 400 });
  }
  const deleted = deleteDocTree(docId);
  if (deleted.length === 0) {
    return NextResponse.json({ error: "讲解不存在" }, { status: 404 });
  }
  return NextResponse.json({ deleted });
}

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

  // 沿 parent_id 回溯版本链（根在前），供前端做多轮深化分段
  const versions: { id: number; blocks: Block[]; instruction: string | null }[] = [];
  let current: DocRow | null = row;
  let guard = 0;
  while (current && guard++ < MAX_CHAIN_DEPTH) {
    versions.unshift({ id: current.id, blocks: current.doc.blocks, instruction: current.instruction });
    current = current.parentId !== null ? getDoc(current.parentId) : null;
  }

  return NextResponse.json({
    docId: row.id,
    doc: row.doc,
    versions,
    asks: listAsks(docId),
    spaceId: row.spaceId,
  });
}
