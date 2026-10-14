import { NextResponse } from "next/server";
import { listDocs } from "@/lib/db/docs";

/** 历史讲解列表；?spaceId= 时只返回该空间 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("spaceId");
  const spaceId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
  return NextResponse.json({ docs: listDocs(500, spaceId) });
}
