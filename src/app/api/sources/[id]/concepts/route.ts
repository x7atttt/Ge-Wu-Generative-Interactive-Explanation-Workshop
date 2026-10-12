import { NextResponse } from "next/server";
import { z } from "zod";
import { getSource, setSourceConcepts } from "@/lib/db/sources";
import { chat, llmConfigFromEnv } from "@/lib/llm/client";

/** 概念提炼输入只取资料前段（标题/目录/章节头通常足以覆盖知识点分布） */
const CONCEPT_INPUT_CHARS = 12_000;

const conceptsSchema = z.object({
  concepts: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
});

/** 剥离 markdown 代码栅栏后截取首尾大括号之间的内容（与 dsl/generate 同规则） */
function extractJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) throw new Error("LLM 输出中未找到 JSON 对象");
  return text.slice(first, last + 1);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return NextResponse.json({ error: "无效的资料 id" }, { status: 400 });
  }
  const source = getSource(numeric);
  if (!source) return NextResponse.json({ error: "资料不存在" }, { status: 404 });
  if (source.status !== "ready") {
    return NextResponse.json({ error: "资料还未解析完成，无法提炼" }, { status: 400 });
  }
  // 提炼结果落库缓存：重复点击不重复计费
  if (source.concepts.length > 0) {
    return NextResponse.json({ concepts: source.concepts });
  }

  try {
    const { fastModel } = llmConfigFromEnv();
    const raw = await chat(
      [
        {
          role: "system",
          content:
            "你是「格物」的资料分析助手。用户给你一份资料（Markdown），请提炼 5~8 个最适合生成交互讲解的核心概念或知识点。只输出一个 JSON 对象（不要 markdown 代码块）：{\"concepts\":[\"概念1\",\"概念2\",...]}。要求：概念名不超过 15 字、具体可讲解（不要「概述」「总结」这类空泛词）、尽量覆盖资料的主要章节、按资料中出现顺序排列。",
        },
        {
          role: "user",
          content: `资料标题：${source.title}\n\n资料内容：\n${source.mdContent.slice(0, CONCEPT_INPUT_CHARS)}`,
        },
      ],
      { jsonMode: true, temperature: 0.2, model: fastModel, timeoutMs: 60_000 }
    );
    const parsed = conceptsSchema.parse(JSON.parse(extractJson(raw)));
    setSourceConcepts(numeric, parsed.concepts);
    return NextResponse.json({ concepts: parsed.concepts });
  } catch (err) {
    console.error("[api/sources/concepts]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "概念提炼失败，请稍后重试" },
      { status: 500 }
    );
  }
}
