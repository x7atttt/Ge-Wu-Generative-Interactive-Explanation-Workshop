import { NextResponse } from "next/server";
import { deleteCard, updateCard } from "@/lib/db/cards";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 单张编辑：题面/答案/概念归属（不传的字段不动） */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardId = parseId(id);
  if (cardId === null) return NextResponse.json({ error: "无效的卡片 id" }, { status: 400 });
  let body: { front?: unknown; back?: unknown; concept?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const front = typeof body.front === "string" ? body.front.trim() : undefined;
  const back = typeof body.back === "string" ? body.back.trim() : undefined;
  if (front === "" || back === "") {
    return NextResponse.json({ error: "题面和答案不能改成空" }, { status: 400 });
  }
  const card = updateCard(cardId, {
    ...(front !== undefined ? { front: front.slice(0, 2000) } : {}),
    ...(back !== undefined ? { back: back.slice(0, 2000) } : {}),
    ...(typeof body.concept === "string" ? { concept: body.concept.slice(0, 120) } : {}),
  });
  if (!card) return NextResponse.json({ error: "卡片不存在" }, { status: 404 });
  return NextResponse.json({ card });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardId = parseId(id);
  if (cardId === null) return NextResponse.json({ error: "无效的卡片 id" }, { status: 400 });
  if (!deleteCard(cardId)) return NextResponse.json({ error: "卡片不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
