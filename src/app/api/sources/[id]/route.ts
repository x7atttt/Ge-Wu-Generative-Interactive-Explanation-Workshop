import { NextResponse } from "next/server";
import { z } from "zod";
import { correctSource, deleteSource, getSource, setSourceSpace } from "@/lib/db/sources";
import { getSpace } from "@/lib/db/spaces";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "无效的资料 id" }, { status: 400 });
  const source = getSource(id);
  if (!source) return NextResponse.json({ error: "资料不存在" }, { status: 404 });
  return NextResponse.json({ source });
}

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
  const source = getSource(numeric);
  if (!source) return NextResponse.json({ error: "资料不存在" }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  const move = z.object({ spaceId: z.number().int().positive().nullable() }).strict().safeParse(body);
  if (move.success) {
    if (move.data.spaceId !== null && !getSpace(move.data.spaceId)) return NextResponse.json({ error: "目标空间不存在" }, { status: 404 });
    setSourceSpace(numeric, move.data.spaceId);
    return NextResponse.json({ ok: true });
  }
  const edit = z.object({
    revision: z.number().int().positive(),
    mdContent: z.string().min(1).max(1_000_000).refine((s) => !!s.trim()).optional(),
    concepts: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  }).strict().refine((v) => v.mdContent !== undefined || v.concepts !== undefined).safeParse(body);
  if (!edit.success) return NextResponse.json({ error: "需要当前版本 revision 与有效正文或概念列表（每个概念不超过100字）" }, { status: 400 });
  if (source.status !== "ready") return NextResponse.json({ error: "资料尚未就绪，无法修改" }, { status: 409 });
  const input = { ...edit.data, concepts: edit.data.concepts ? [...new Set(edit.data.concepts)] : undefined };
  if (!correctSource(numeric, edit.data.revision, input)) return NextResponse.json({ error: "资料版本已变化，你的修改尚未保存。请先复制草稿，再重新加载最新版本" }, { status: 409 });
  return NextResponse.json({ source: getSource(numeric) });
}
