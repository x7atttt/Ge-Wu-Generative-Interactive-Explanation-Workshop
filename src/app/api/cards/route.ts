import { NextResponse } from "next/server";
import { clearSpaceCards, listDueCards } from "@/lib/db/cards";

/** 到期复习队列；?spaceId= 必填 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("spaceId");
  if (raw === null || !/^\d+$/.test(raw)) {
    return NextResponse.json({ error: "缺少有效的 spaceId" }, { status: 400 });
  }
  return NextResponse.json({ cards: listDueCards(Number(raw)) });
}

/** 清空空间的复习卡 */
export async function DELETE(req: Request) {
  const raw = new URL(req.url).searchParams.get("spaceId");
  if (raw === null || !/^\d+$/.test(raw)) {
    return NextResponse.json({ error: "缺少有效的 spaceId" }, { status: 400 });
  }
  clearSpaceCards(Number(raw));
  return NextResponse.json({ ok: true });
}
