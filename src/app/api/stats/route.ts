import { NextResponse } from "next/server";
import { getStats } from "@/lib/db/attempts";

/** 学习统计聚合：KPI + 近 14 天序列 + 按题型/按概念正确率 */
export async function GET() {
  return NextResponse.json(getStats());
}
