import { NextResponse } from "next/server";
import { sampleExamCards } from "@/lib/db/cards";

const DEFAULT_COUNT = 20;
const MAX_COUNT = 100;

/** 综合测验抽卷：空间全部卡（不看 due）随机抽样；?count= 抽样上限，缺省 20 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const spaceRaw = params.get("spaceId");
  if (spaceRaw === null || !/^\d+$/.test(spaceRaw)) {
    return NextResponse.json({ error: "缺少有效的 spaceId" }, { status: 400 });
  }
  const countRaw = params.get("count");
  let count = DEFAULT_COUNT;
  if (countRaw !== null) {
    if (!/^\d+$/.test(countRaw) || Number(countRaw) < 1 || Number(countRaw) > MAX_COUNT) {
      return NextResponse.json({ error: `count 必须是 1-${MAX_COUNT} 的整数` }, { status: 400 });
    }
    count = Number(countRaw);
  }
  return NextResponse.json({ cards: sampleExamCards(Number(spaceRaw), count) });
}
