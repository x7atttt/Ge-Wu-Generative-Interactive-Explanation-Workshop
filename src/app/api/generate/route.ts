import { NextResponse } from "next/server";
import { generateDoc } from "@/lib/dsl/generate";

export async function POST(req: Request) {
  let concept: unknown;
  try {
    const body: unknown = await req.json();
    concept = (body as { concept?: unknown } | null)?.concept;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof concept !== "string" || !concept.trim()) {
    return NextResponse.json({ error: "请输入要讲解的概念" }, { status: 400 });
  }
  if (concept.length > 200) {
    return NextResponse.json({ error: "概念描述请控制在 200 字以内" }, { status: 400 });
  }

  try {
    const doc = await generateDoc(concept.trim());
    return NextResponse.json({ doc });
  } catch (err) {
    console.error("[api/generate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成失败，请稍后重试" },
      { status: 500 }
    );
  }
}
