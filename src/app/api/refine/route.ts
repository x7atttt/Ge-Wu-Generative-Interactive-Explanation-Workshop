import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { tryAcquireAction, releaseAction } from "@/lib/actionGuard";
import { getDoc, insertDoc, type DocOrigin } from "@/lib/db/docs";
import { refineDoc } from "@/lib/dsl/generate";
import { explainDocSchema } from "@/lib/dsl/schema";

export async function POST(req: Request) {
  let body: { doc?: unknown; instruction?: unknown; docId?: unknown };
  try {
    body = (await req.json()) as { doc?: unknown; instruction?: unknown; docId?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const instruction = body.instruction;
  if (typeof instruction !== "string" || !instruction.trim()) {
    return NextResponse.json({ error: "请输入改造指令" }, { status: 400 });
  }
  if (instruction.length > 300) {
    return NextResponse.json({ error: "改造指令请控制在 300 字以内" }, { status: 400 });
  }

  // 入站的当前文档必须仍合法，防止脏数据进入生成层
  const parsed = explainDocSchema.safeParse(body.doc);
  if (!parsed.success) {
    return NextResponse.json({ error: "当前文档结构非法，无法改造" }, { status: 400 });
  }

  const parentDocId =
    typeof body.docId === "number" && Number.isInteger(body.docId) && body.docId > 0
      ? body.docId
      : null;

  // 单飞门（与生成共用）：并发改造/边生成边改造都视为误触
  if (!tryAcquireAction("refine")) {
    return NextResponse.json({ error: "已有生成/改造进行中，请等它完成" }, { status: 409 });
  }
  // 客户端断开感知：取消后中止上游改造，不再落库
  const signal = req.signal;

  return sseResponse(async (send) => {
    try {
      const doc = await refineDoc(parsed.data, instruction.trim(), (text) => {
        if (signal.aborted) throw new DOMException("客户端已取消", "AbortError");
        send({ type: "delta", text });
      });
      if (signal.aborted) return;
      // refine 子版本继承父版本的空间归属与出身概念（概念地图状态不被深化打散）
      const parent = parentDocId !== null ? getDoc(parentDocId) : null;
      const origin: DocOrigin = parent
        ? { spaceId: parent.spaceId, originConcept: parent.originConcept, sourceIds: parent.sourceIds }
        : { spaceId: null, originConcept: null };
      const docId = insertDoc(doc, parentDocId, instruction.trim(), origin);
      send({ type: "done", doc, docId });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // 客户端主动取消，静默
      console.error("[api/refine]", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "改造失败，请稍后重试",
      });
    } finally {
      releaseAction();
    }
  });
}
