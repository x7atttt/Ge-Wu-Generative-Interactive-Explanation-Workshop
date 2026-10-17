import { NextResponse } from "next/server";
import { sseResponse } from "@/lib/api/sse";
import { getDoc, insertDoc } from "@/lib/db/docs";
import { getReadySources } from "@/lib/db/sources";
import { getDocAttemptStats, type AttemptType } from "@/lib/db/attempts";
import { generateDoc, type GenerateExtras } from "@/lib/dsl/generate";
import { webSearch } from "@/lib/search/bocha";

const TYPE_LABELS: Record<AttemptType, string> = {
  quiz: "自测题",
  fillBlank: "填空",
  match: "配对",
  sort: "分类",
};

/** 单概念练习统计 → 补练提示词的统计行；无记录返回空数组 */
function practiceLines(docId: number): string[] {
  const { overall, byType } = getDocAttemptStats(docId);
  if (overall.total === 0) return [];
  const rate = Math.round((overall.correct / overall.total) * 100);
  return [
    `总体：${overall.total} 次练习，正确 ${overall.correct} 次（${rate}%）`,
    ...byType.map((t) => `${TYPE_LABELS[t.blockType] ?? t.blockType}：${t.correct}/${t.total} 次正确`),
  ];
}

export async function POST(req: Request) {
  let body: {
    concept?: unknown;
    webSearch?: unknown;
    personaStyle?: unknown;
    practiceDocId?: unknown;
    sourceIds?: unknown;
    spaceId?: unknown;
    originConcept?: unknown;
    images?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const useWebSearch = body.webSearch !== false; // 前端「联网检索」开关，仅显式 false 关闭
  const personaStyle =
    typeof body.personaStyle === "string" && body.personaStyle.trim()
      ? body.personaStyle.trim().slice(0, 100)
      : null;
  const practiceDocId =
    typeof body.practiceDocId === "number" && Number.isInteger(body.practiceDocId) && body.practiceDocId > 0
      ? body.practiceDocId
      : null;
  // 空间归属与出身概念（概念地图/资料提炼点生成时携带，refine 子版本会继承）
  const spaceId =
    typeof body.spaceId === "number" && Number.isInteger(body.spaceId) && body.spaceId > 0 ? body.spaceId : null;
  const originConcept =
    typeof body.originConcept === "string" && body.originConcept.trim() ? body.originConcept.trim().slice(0, 100) : null;

  // 附加资料：最多 3 份；失效 id（已删除/未解析）静默剔除并提示，不再阻塞生成
  const sourceIds = Array.isArray(body.sourceIds)
    ? [...new Set(body.sourceIds.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0))]
    : [];
  if (sourceIds.length > 3) {
    return NextResponse.json({ error: "最多附加 3 份资料" }, { status: 400 });
  }
  const sources =
    sourceIds.length > 0
      ? getReadySources(sourceIds).map((row) => ({ id: row.id, title: row.title, content: row.mdContent }))
      : [];
  const validSourceIds = sources.map((s) => s.id);
  const droppedSources = sourceIds.length - sources.length;

  // 拍题图片：data URL 护栏（前端压缩后实际 ≈400KB 内）
  const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,/;
  const images =
    Array.isArray(body.images) && body.images.length <= 3
      ? body.images.filter(
          (v): v is string => typeof v === "string" && IMAGE_DATA_URL.test(v) && v.length <= 2_500_000
        )
      : [];
  if (Array.isArray(body.images) && body.images.length > 3) {
    return NextResponse.json({ error: "最多附 3 张图片" }, { status: 400 });
  }

  // 补练模式：概念取自源文档标题，练习统计由服务端自己聚合（不信任客户端数字）
  let concept = typeof body.concept === "string" ? body.concept.trim() : "";
  let statLines: string[] | null = null;
  if (practiceDocId !== null) {
    const source = getDoc(practiceDocId);
    if (!source) {
      return NextResponse.json({ error: "补练的概念不存在" }, { status: 400 });
    }
    statLines = practiceLines(practiceDocId);
    if (statLines.length === 0) {
      return NextResponse.json({ error: "该概念还没有练习记录，无法补练" }, { status: 400 });
    }
    concept = source.title;
  }

  // 附加资料或图片时概念可留空：资料默认第一份标题，图片由模型按图定主题
  const conceptProvided = concept.length > 0;
  if (!concept && sources.length > 0) {
    concept = sources[0].title.slice(0, 200);
  }
  if (!concept && images.length > 0) {
    concept = "图片讲解";
  }
  if (!concept) {
    return NextResponse.json({ error: "请输入要讲解的概念或附图/资料" }, { status: 400 });
  }
  if (concept.length > 200) {
    return NextResponse.json({ error: "概念描述请控制在 200 字以内" }, { status: 400 });
  }

  return sseResponse(async (send) => {
    try {
      // 补练的用户消息已携带练习统计，资料槽不再放网络检索结果；
      // 纯拍题（概念为默认占位）也不检索——占位词搜不出有效资料
      const refs = useWebSearch && statLines === null && conceptProvided ? await webSearch(concept) : [];
      if (images.length > 0) {
        send({ type: "info", message: `已附 ${images.length} 张图片，讲解将围绕图片内容` });
      }
      if (sources.length > 0) {
        send({ type: "info", message: `已附加 ${sources.length} 份资料（${sources.reduce((n, s) => n + s.content.length, 0)} 字）` });
      }
      if (droppedSources > 0) {
        send({ type: "info", message: `已忽略 ${droppedSources} 份已删除或未解析的资料` });
      }
      if (refs.length > 0) send({ type: "info", message: `已检索 ${refs.length} 条网络资料` });
      const extras: GenerateExtras = { refs, personaStyle };
      if (sources.length > 0) extras.sources = sources;
      if (statLines) extras.practiceLines = statLines;
      if (images.length > 0) extras.images = images;
      const doc = await generateDoc(concept, extras, (text) =>
        send({ type: "delta", text })
      );
      const docId = insertDoc(doc, null, null, {
        spaceId,
        originConcept: originConcept ?? (spaceId !== null ? concept.slice(0, 100) : null),
        sourceIds: validSourceIds,
      });
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
