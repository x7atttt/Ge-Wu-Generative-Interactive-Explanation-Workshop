import { NextResponse } from "next/server";
import { getStats } from "@/lib/db/attempts";

/** 学习统计聚合：KPI + 近 14 天序列 + 按题型/按概念正确率；?spaceId= 时只算该空间 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("spaceId");
  const spaceId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
  return NextResponse.json(getStats(spaceId));
}
