import { NextResponse } from "next/server";
import { clearSpaceCards, createManualCard, listAllCards, listDueCards } from "@/lib/db/cards";

function spaceIdOf(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get("spaceId");
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
}

/** 到期复习队列（缺省）；?all=1 时返回空间全部卡（管理面板用） */
export async function GET(req: Request) {
  const spaceId = spaceIdOf(req);
  if (spaceId === null) {
    return NextResponse.json({ error: "缺少有效的 spaceId" }, { status: 400 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";
  return NextResponse.json({ cards: all ? listAllCards(spaceId) : listDueCards(spaceId) });
}

/** 手写卡：不属于任何讲解，新卡立即进入今日队列 */
export async function POST(req: Request) {
  let body: { spaceId?: unknown; front?: unknown; back?: unknown; concept?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body.spaceId !== "number" || !Number.isInteger(body.spaceId) || body.spaceId <= 0) {
    return NextResponse.json({ error: "缺少有效的 spaceId" }, { status: 400 });
  }
  const front = typeof body.front === "string" ? body.front.trim() : "";
  const back = typeof body.back === "string" ? body.back.trim() : "";
  if (!front || !back) {
    return NextResponse.json({ error: "题面和答案都不能为空" }, { status: 400 });
  }
  const card = createManualCard({
    spaceId: body.spaceId,
    front: front.slice(0, 2000),
    back: back.slice(0, 2000),
    concept: typeof body.concept === "string" ? body.concept.slice(0, 120) : null,
  });
  return NextResponse.json({ card }, { status: 201 });
}

/** 清空空间的复习卡 */
export async function DELETE(req: Request) {
  const spaceId = spaceIdOf(req);
  if (spaceId === null) {
    return NextResponse.json({ error: "缺少有效的 spaceId" }, { status: 400 });
  }
  clearSpaceCards(spaceId);
  return NextResponse.json({ ok: true });
}
