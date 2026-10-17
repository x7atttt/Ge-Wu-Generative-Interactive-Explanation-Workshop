import { NextResponse } from "next/server";
import { deleteSpace, deleteSpaceDeep, getSpace, updateSpace } from "@/lib/db/spaces";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 真实存在的日历日期（YYYY-MM-DD）：格式 + 构造 Date 回读一致——挡 2026-02-30 这类伪日期 */
function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return (
    d.getFullYear() === Number(s.slice(0, 4)) &&
    d.getMonth() === Number(s.slice(5, 7)) - 1 &&
    d.getDate() === Number(s.slice(8, 10))
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = parseId(id);
  const space = numeric !== null ? getSpace(numeric) : null;
  if (!space) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  return NextResponse.json({ space });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = parseId(id);
  if (numeric === null) return NextResponse.json({ error: "无效的空间 id" }, { status: 400 });
  let body: { name?: unknown; note?: unknown; examDate?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!getSpace(numeric)) return NextResponse.json({ error: "空间不存在" }, { status: 404 });
  if (
    body.examDate !== null &&
    body.examDate !== undefined &&
    !(typeof body.examDate === "string" && isValidCalendarDate(body.examDate))
  ) {
    return NextResponse.json(
      { error: "考试日期无效（需要真实存在的 YYYY-MM-DD，如 2026-11-18）" },
      { status: 400 }
    );
  }
  updateSpace(numeric, {
    ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
    ...(typeof body.note === "string" ? { note: body.note.trim() } : {}),
    ...(body.examDate === null || (typeof body.examDate === "string" && isValidCalendarDate(body.examDate))
      ? { examDate: body.examDate as string | null }
      : {}),
  });
  return NextResponse.json({ space: getSpace(numeric) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = parseId(id);
  if (numeric === null) return NextResponse.json({ error: "无效的空间 id" }, { status: 400 });
  // ?content=1 深删：连资料/讲解/练习/复习卡一并删除；缺省仅删空间（资产移回未分组）
  const withContent = new URL(req.url).searchParams.get("content") === "1";
  if (withContent) deleteSpaceDeep(numeric);
  else deleteSpace(numeric);
  return NextResponse.json({ ok: true, contentDeleted: withContent });
}
