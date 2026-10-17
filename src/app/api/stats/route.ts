import { NextResponse } from "next/server";
import { getStats } from "@/lib/db/attempts";

/** 学习统计聚合：KPI + 近 14 天序列 + 按题型/按概念正确率；?spaceId= 时只算该空间。
 *  spaceId 传了但非法 → 400（而不是静默回退全量，防止"想看单空间却看到全局"） */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("spaceId");
  if (raw !== null && !/^\d+$/.test(raw)) {
    return NextResponse.json({ error: "spaceId 非法（缺省=全部，或传数字 id）" }, { status: 400 });
  }
  return NextResponse.json(getStats(raw === null ? undefined : Number(raw)));
}
