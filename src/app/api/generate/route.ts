import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { insertDoc } from "@/lib/db/docs";
import { generateDoc } from "@/lib/dsl/generate";
import { webSearch } from "@/lib/search/bocha";

export async function POST(req: Request) {
  let concept: unknown;
  let useWebSearch = true;
  try {
    const body: unknown = await req.json();
    concept = (body as { concept?: unknown } | null)?.concept;
    // 前端「联网检索」开关；仅显式 false 关闭，缺省开启
    useWebSearch = (body as { webSearch?: unknown } | null)?.webSearch !== false;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof concept !== "string" || !concept.trim()) {
    return NextResponse.json({ error: "请输入要讲解的概念" }, { status: 400 });
  }
  if (concept.length > 200) {
    return NextResponse.json({ error: "概念描述请控制在 200 字以内" }, { status: 400 });
  }

  return sseResponse(async (send) => {
    try {
      const refs = useWebSearch ? await webSearch(concept.trim()) : [];
      if (refs.length > 0) send({ type: "info", message: `已检索 ${refs.length} 条网络资料` });
      const doc = await generateDoc(concept.trim(), refs, (text) =>
        send({ type: "delta", text })
      );
      const docId = insertDoc(doc, null);
      send({ type: "done", doc, docId });
    } catch (err) {
      console.error("[api/generate]", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "生成失败，请稍后重试",
      });
    }
  });
}
