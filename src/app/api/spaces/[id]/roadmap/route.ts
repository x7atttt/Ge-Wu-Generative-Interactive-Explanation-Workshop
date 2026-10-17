import { NextResponse } from "next/server";
import { z } from "zod";
import { getSpace, setRoadmap, type RoadmapStage } from "@/lib/db/spaces";
import { listSources } from "@/lib/db/sources";
import { chat, llmConfigFromEnv } from "@/lib/llm/client";

const roadmapSchema = z.object({
  stages: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(30),
        goal: z.string().trim().max(80),
        concepts: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
      })
    )
    .min(1)
    .max(12),
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

/** 生成/覆盖学习路线：空间概念按依赖与难度编排为 3-8 站（概念名白名单约束 + 后过滤） */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return NextResponse.json({ error: "无效的空间 id" }, { status: 400 });
  }
  const space = getSpace(numeric);
  if (!space) return NextResponse.json({ error: "空间不存在" }, { status: 404 });

  // 就绪资料 × 各自提炼的概念 = 编排输入；概念是地图对齐的白名单
  const ready = listSources(200, numeric).filter((s) => s.status === "ready" && s.concepts.length > 0);
  const known = new Set(ready.flatMap((s) => s.concepts.map((c) => c.trim())).filter(Boolean));
  if (known.size < 2) {
    return NextResponse.json(
      { error: "空间内的概念不足 2 个——先在「资料」面板为各资料提炼讲解点" },
      { status: 400 }
    );
  }

  const listing = ready
    .map((s) => `《${s.title}》：${s.concepts.join("、")}`)
    .join("\n");
  const examLine = space.examDate
    ? `考试日期：${space.examDate}`
    : "考试日期：未设置";

  try {
    const { fastModel } = llmConfigFromEnv();
    const raw = await chat(
      [
        {
          role: "system",
          content:
            "你是「格物」的学习规划师。用户给你一场考试复习空间内的资料与已提炼的概念清单。请把全部概念编排成 3~8 站的学习路线：按学习依赖与认知难度从易到难（基础概念在前、依赖其他概念的在后），每站 2~6 个概念，起简短站名（如「进程与线程基础」），并用一句话说明本站学习目标。硬性规则：只能使用清单中出现的概念名，原样复制不得改写；每个概念只能出现在一站；必须覆盖清单中的全部概念。只输出一个 JSON 对象（不要 markdown 代码块）：{\"stages\":[{\"title\":\"站名\",\"goal\":\"目标一句话\",\"concepts\":[\"概念A\",\"概念B\"]}]}",
        },
        {
          role: "user",
          content: `空间：${space.name}${space.note ? `（${space.note}）` : ""}\n${examLine}\n\n资料与概念清单：\n${listing}`,
        },
      ],
      { jsonMode: true, temperature: 0.3, model: fastModel, timeoutMs: 60_000 }
    );
    const parsed = roadmapSchema.parse(JSON.parse(extractJson(raw)));

    // 后过滤：白名单剔除改写名，跨站去重（保留首站），剔空站
    const seen = new Set<string>();
    const stages: RoadmapStage[] = [];
    for (const stage of parsed.stages) {
      const concepts = [...new Set(stage.concepts)].filter((c) => {
        if (!known.has(c) || seen.has(c)) return false;
        seen.add(c);
        return true;
      });
      if (concepts.length > 0) {
        stages.push({ title: stage.title, goal: stage.goal, concepts });
      }
    }
    // 覆盖兜底：提示词要求全覆盖但模型仍可能漏（实测漏 1/8）——未编排概念确定性补一个收尾站
    const missing = [...known].filter((c) => !seen.has(c));
    if (missing.length > 0) {
      stages.push({ title: "查漏补缺", goal: "编排未覆盖的概念，已自动补入", concepts: missing });
    }
    if (stages.length === 0) {
      return NextResponse.json(
        { error: "路线生成结果未能对齐概念清单，请重试" },
        { status: 500 }
      );
    }
    setRoadmap(numeric, stages);
    return NextResponse.json({ roadmap: stages, generatedAt: getSpace(numeric)?.roadmapAt ?? null });
  } catch (err) {
    console.error("[api/spaces/roadmap]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "学习路线生成失败，请稍后重试" },
      { status: 500 }
    );
  }
}
