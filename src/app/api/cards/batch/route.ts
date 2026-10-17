import { NextResponse } from "next/server";
import { createManualCards } from "@/lib/db/cards";

const MAX_LINES = 200;

/**
 * 卡片批量导入：行式文本，每行「题面 | 答案 | 概念(可选)」。
 * 非法行（分段不足 2 / 空）跳过并在响应里带行号样例；新卡今日进入复习队列。
 */
export async function POST(req: Request) {
  let body: { spaceId?: unknown; text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body.spaceId !== "number" || !Number.isInteger(body.spaceId) || body.spaceId <= 0) {
    return NextResponse.json({ error: "缺少有效的 spaceId" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "请粘贴要导入的卡片文本" }, { status: 400 });
  }

  const items: { front: string; back: string; concept?: string | null }[] = [];
  const invalid: number[] = [];
  const lines = body.text.split(/\r?\n/);
  if (lines.length > MAX_LINES) {
    return NextResponse.json({ error: `单次最多导入 ${MAX_LINES} 行` }, { status: 400 });
  }
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      invalid.push(i + 1);
      return;
    }
    items.push({
      front: parts[0].slice(0, 2000),
      back: parts[1].slice(0, 2000),
      concept: parts[2] ? parts[2].slice(0, 120) : null,
    });
  });
  if (items.length === 0) {
    return NextResponse.json(
      { error: `没有可导入的行${invalid.length ? `（${invalid.length} 行格式非法）` : ""}` },
      { status: 400 }
    );
  }
  const added = createManualCards(body.spaceId, items);
  return NextResponse.json({
    added,
    skipped: invalid.length,
    invalidLines: invalid.slice(0, 5),
  });
}
