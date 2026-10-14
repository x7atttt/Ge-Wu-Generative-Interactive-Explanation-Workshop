import { NextResponse } from "next/server";
import { getSpaceMap } from "@/lib/db/spaces";

/** 概念地图：资料提炼概念 × 讲解/练习状态聚合 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return NextResponse.json({ error: "无效的空间 id" }, { status: 400 });
  }
  const map = getSpaceMap(numeric);
  if (!map) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  return NextResponse.json(map);
}
