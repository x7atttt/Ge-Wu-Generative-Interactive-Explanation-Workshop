import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { appendAsks, listAsks } from "@/lib/db/asks";
import { getDoc } from "@/lib/db/docs";
import { askQuestion } from "@/lib/dsl/generate";

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,/;
const MAX_IMAGES = 2;
const MAX_IMAGE_CHARS = 2_500_000; // 单条 data URL 上限（前端压缩后实际 ≈400KB 内）

/** 追问附图校验：data URL 形态、数量与大小护栏；返回 null 表示合法 */
function parseImages(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return null;
  const images: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !IMAGE_DATA_URL.test(item) || item.length > MAX_IMAGE_CHARS) {
      return null;
    }
    images.push(item);
  }
  return images;
}

export async function POST(req: Request) {
  let body: { docId?: unknown; question?: unknown; personaStyle?: unknown; images?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const docId = body.docId;
  if (typeof docId !== "number" || !Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "docId 非法" }, { status: 400 });
  }

  const question = body.question;
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  }
  if (question.length > 300) {
    return NextResponse.json({ error: "问题请控制在 300 字以内" }, { status: 400 });
  }

  const images = parseImages(body.images);
  if (images === null) {
    return NextResponse.json(
      { error: `图片格式不合法（最多 ${MAX_IMAGES} 张，data URL 单张不超过 2.5MB）` },
      { status: 400 }
    );
  }

  const personaStyle =
    typeof body.personaStyle === "string" && body.personaStyle.trim()
      ? body.personaStyle.trim().slice(0, 100)
      : null;

  const row = getDoc(docId);
  if (!row) {
    return NextResponse.json({ error: "讲解不存在或已损坏" }, { status: 404 });
  }

  const history = listAsks(docId).map((ask) => ({ role: ask.role, content: ask.content }));
  // 入库占位：历史上下文可见有图，但不存 base64（DB 膨胀 + 历史轮不重发图）
  const storedQuestion = images.length > 0 ? `${question.trim()}\n[图片]` : question.trim();

  return sseResponse(async (send) => {
    try {
      const answer = await askQuestion(
        row.doc,
        history,
        question.trim(),
        (text) => send({ type: "delta", text }),
        personaStyle,
        images
      );
      // 成功的问答才成对入库，失败轮次不污染后续上下文
      appendAsks(docId, [
        { role: "user", content: storedQuestion },
        { role: "assistant", content: answer },
      ]);
      send({ type: "done" });
    } catch (err) {
      console.error("[api/ask]", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "回答失败，请稍后重试",
      });
    }
  });
}
