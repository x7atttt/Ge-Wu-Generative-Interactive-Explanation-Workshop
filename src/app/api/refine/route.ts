import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { tryAcquireAction } from "@/lib/actionGuard";
import { getDoc, insertDoc, type DocOrigin } from "@/lib/db/docs";
import { refineDoc } from "@/lib/dsl/generate";
import { explainDocSchema } from "@/lib/dsl/schema";
import { isReasoningEffort } from "@/lib/effort";

export async function POST(req: Request) {
  let body: { doc?: unknown; instruction?: unknown; docId?: unknown; effort?: unknown; mode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (body.effort !== undefined && !isReasoningEffort(body.effort)) {
    return NextResponse.json({ error: "思考强度须为 low、high 或 max" }, { status: 400 });
  }
  const effort = body.effort;
  if (body.mode !== undefined && body.mode !== "append" && body.mode !== "revise") {
    return NextResponse.json({ error: "请选择补充讲解或修订原文" }, { status: 400 });
  }
  // 未传 mode 的旧客户端保留原有改造语义，新界面明确选择补充或修订。
  const mode = body.mode ?? "revise";
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
  const release = tryAcquireAction("refine");
  if (!release) {
    return NextResponse.json({ error: "已有生成/改造进行中，请等它完成" }, { status: 409 });
  }
  // 客户端断开感知：取消后中止上游改造，不再落库
  return sseResponse(async (send, signal) => {
    try {
      send({ type: "stage", stage: "build" });
      const doc = await refineDoc(parsed.data, instruction.trim(), (text) => {
        if (signal.aborted) throw new DOMException("客户端已取消", "AbortError");
        send({ type: "delta", text });
      }, (stage) => {
        if (signal.aborted) throw new DOMException("客户端已取消", "AbortError");
        send({ type: "stage", stage });
      }, effort, {
        signal,
        onThinking: () => send({ type: "info", message: "模型正在思考，尚未返回正文" }),
        onRetry: (attempt) => send({ type: "retry", attempt, message: `连接暂时异常，正在重新连接（${attempt}/2）` }),
      }, mode);
      if (signal.aborted) return;
      // refine 子版本继承父版本的空间归属与出身概念（概念地图状态不被深化打散）
      const parent = parentDocId !== null ? getDoc(parentDocId) : null;
      const origin: DocOrigin = parent
        ? { spaceId: parent.spaceId, originConcept: parent.originConcept, sourceIds: parent.sourceIds, sourceContext: parent.sourceContext }
        : { spaceId: null, originConcept: null };
      const docId = insertDoc(doc, parentDocId, instruction.trim(), origin);
      send({ type: "done", doc, docId });
    } catch (err) {
      if (signal.aborted) return;
      console.error("[api/refine]", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "改造失败，请稍后重试",
      });
    } finally {
      release();
    }
  }, req.signal, release);
}
