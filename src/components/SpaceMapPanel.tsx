"use client";

import { useCallback, useEffect, useState } from "react";
import { getSpaceMap, type SpaceMap } from "@/lib/api/spaces";

const STATUS_META: Record<
  string,
  { label: string; chip: string; hint: string }
> = {
  new: {
    label: "未学",
    chip: "border-zinc-200 bg-white text-zinc-600 hover:border-violet-300 hover:text-violet-700",
    hint: "点击生成讲解",
  },
  explained: {
    label: "已讲解",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400",
    hint: "点击打开讲解继续练习",
  },
  practiced: {
    label: "已练习",
    chip: "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400",
    hint: "点击打开讲解",
  },
  weak: {
    label: "薄弱",
    chip: "border-red-300 bg-red-50 text-red-600 hover:border-red-400 font-medium",
    hint: "点击生成针对性补练",
  },
};

/**
 * 概念地图（空间核心视图）：资料提炼概念 × 讲解/练习状态。
 * 点击行为按状态分派：未学→生成 / 已讲解·已练习→打开讲解 / 薄弱→补练。
 */
export function SpaceMapPanel({
  spaceId,
  refreshKey,
  disabled,
  onPick,
  onPractice,
  onOpenDoc,
}: {
  spaceId: number;
  /** 父级事件后自增以重拉地图（生成完成/切换文档等） */
  refreshKey: number;
  disabled?: boolean;
  /** 未学概念 → 生成：附加来源资料 + 记录出身概念 */
  onPick: (concept: string, sourceIds: number[]) => void;
  /** 薄弱概念 → 补练（以该概念最近一次讲解的统计为准） */
  onPractice: (docId: number, title: string) => void;
  onOpenDoc: (docId: number) => void;
}) {
  const [map, setMap] = useState<SpaceMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMap(await getSpaceMap(spaceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "地图加载失败");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  function handleClick(concept: SpaceMap["concepts"][number]) {
    if (disabled) return;
    if (concept.status === "new") {
      onPick(concept.text, concept.sourceIds);
    } else if (concept.status === "weak") {
      const latest = concept.docIds[concept.docIds.length - 1];
      if (latest !== undefined) onPractice(latest, concept.text);
    } else {
      const latest = concept.docIds[concept.docIds.length - 1];
      if (latest !== undefined) onOpenDoc(latest);
      else onPick(concept.text, concept.sourceIds);
    }
  }

  if (error) {
    return (
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-red-600">{error}</p>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-violet-100 bg-white/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-zinc-800">
          📖 概念地图{map ? ` · ${map.space.name}` : ""}
        </h2>
        {map && (
          <p className="text-xs text-zinc-500">
            {map.summary.sources} 份资料 · {map.concepts.length} 个概念 · 已讲 {map.summary.explained}
            {map.summary.weak > 0 && (
              <span className="ml-1 font-medium text-red-500">· {map.summary.weak} 个薄弱</span>
            )}
          </p>
        )}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-zinc-400">
          {(["weak", "new", "practiced", "explained"] as const).map((status) => (
            <span key={status} className="flex items-center gap-1">
              <span
                className={`h-2 w-2 rounded-full ${
                  status === "weak"
                    ? "bg-red-400"
                    : status === "new"
                      ? "bg-zinc-300"
                      : status === "practiced"
                        ? "bg-blue-400"
                        : "bg-emerald-400"
                }`}
              />
              {STATUS_META[status].label}
            </span>
          ))}
        </div>
      </div>

      {map && map.concepts.length === 0 && (
        <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-4 text-center text-xs leading-5 text-zinc-500">
          {map.summary.sources === 0
            ? "还没有资料——用上方「资料」面板导入本空间的讲义/真题，然后在各资料上「提炼讲解点」"
            : "资料还没有提炼讲解点——在「资料」面板点各资料的「提炼讲解点」，概念会自动出现在这张地图上"}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {map?.concepts.map((concept) => {
          const meta = STATUS_META[concept.status];
          const rate =
            concept.practice.total > 0
              ? Math.round((concept.practice.correct / concept.practice.total) * 100)
              : null;
          return (
            <button
              key={concept.text}
              type="button"
              onClick={() => handleClick(concept)}
              title={meta.hint}
              className={`group flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${meta.chip}`}
            >
              <span className="text-sm">{concept.text}</span>
              <span className="mt-0.5 text-[10px] opacity-70">
                {concept.status === "new"
                  ? `${concept.sourceIds.length} 份资料提及`
                  : rate !== null
                    ? `练习 ${concept.practice.total} 次 · 正确率 ${rate}%`
                    : "已生成讲解"}
              </span>
            </button>
          );
        })}
      </div>
      {loading && <p className="mt-2 text-xs text-zinc-300">刷新中…</p>}
    </section>
  );
}
