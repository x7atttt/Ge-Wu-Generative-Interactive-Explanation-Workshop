"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type * as echarts from "echarts/core";
import { useEChart } from "@/components/useEChart";
import type { StatsPayload } from "@/lib/db/attempts";

const TYPE_LABELS: Record<string, string> = {
  quiz: "自测题",
  fillBlank: "填空",
  match: "配对",
  sort: "分类",
};

/**
 * 右上角「学习统计」标签：弹出个人学习仪表盘。
 * KPI + 近 14 天做题/正确率双轴图（复用讲解图表的 ECharts 按需注册）+
 * 按题型正确率 + 弱项清单（正确率 <60% 且样本 ≥3，可一键生成针对性补练）。
 */
export function StatsPanel({
  onPractice,
  spaceId,
}: {
  /** 弱项补练回调（迭代 12：以源概念统计生成针对性练习讲解） */
  onPractice?: (docId: number, title: string) => void;
  /** 空间模式：只统计该空间（undefined = 全局） */
  spaceId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    setLoading(true);
    fetch(spaceId !== undefined ? `/api/stats?spaceId=${spaceId}` : "/api/stats")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`加载失败（${res.status}）`))))
      .then((data: StatsPayload) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
    return () => document.removeEventListener("keydown", onKey);
  }, [open, spaceId]);

  const option = useMemo<echarts.EChartsCoreOption | null>(() => {
    if (!stats || stats.attemptCount === 0) return null;
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 36, right: 36, top: 30, bottom: 24 },
      xAxis: {
        type: "category",
        data: stats.daily.map((d) => d.day.slice(5)),
        axisLabel: { color: "#a1a1aa", fontSize: 10 },
      },
      yAxis: [
        { type: "value", minInterval: 1, axisLabel: { color: "#a1a1aa", fontSize: 10 } },
        {
          type: "value",
          max: 100,
          axisLabel: { formatter: "{value}%", color: "#a1a1aa", fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "练习次数",
          type: "bar",
          data: stats.daily.map((d) => d.total),
          itemStyle: { color: "#c7d2fe", borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 16,
        },
        {
          name: "正确率",
          type: "line",
          yAxisIndex: 1,
          data: stats.daily.map((d) => (d.total > 0 ? Math.round((d.correct / d.total) * 100) : null)),
          itemStyle: { color: "#6366f1" },
          lineStyle: { width: 2 },
          symbolSize: 5,
          connectNulls: true,
        },
      ],
    };
  }, [stats]);

  const containerRef = useEChart(option ?? {});

  const weakSpots = useMemo(
    () =>
      (stats?.concepts ?? []).filter(
        (c) => c.total >= 3 && c.correct / c.total < 0.6
      ),
    [stats]
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur transition-colors hover:border-indigo-300 hover:text-indigo-600"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
          <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" strokeLinecap="round" />
        </svg>
        学习统计
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="absolute right-0 top-11 w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
              <p className="text-sm font-medium text-zinc-800">学习统计</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-zinc-400 transition-colors hover:text-zinc-600"
              >
                收起
              </button>
            </div>

            {loading && <p className="px-4 py-10 text-center text-xs text-zinc-400">统计加载中…</p>}

            {!loading && stats && stats.attemptCount === 0 && (
              <p className="px-6 py-10 text-center text-xs leading-6 text-zinc-400">
                还没有练习记录
                <br />
                完成讲解里的自测、填空、配对或分类练习后，这里会出现你的学习画像
              </p>
            )}

            {!loading && stats && stats.attemptCount > 0 && (
              <div className="flex flex-col gap-4 p-4">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Kpi label="学习概念" value={String(stats.docCount)} />
                  <Kpi label="练习次数" value={String(stats.attemptCount)} />
                  <Kpi label="总正确率" value={`${stats.correctRate}%`} />
                  <Kpi label="连续学习" value={`${stats.streak} 天`} />
                </div>

                <div className="rounded-lg border border-zinc-100 p-1">
                  <div ref={containerRef} className="h-40 w-full" />
                  <p className="pb-1 text-center text-[11px] text-zinc-400">近 14 天练习与正确率</p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-zinc-500">按题型正确率</p>
                  <div className="flex flex-col gap-1.5">
                    {stats.byType.map((t) => {
                      const rate = Math.round((t.correct / t.total) * 100);
                      return (
                        <div key={t.blockType} className="flex items-center gap-2 text-xs">
                          <span className="w-12 shrink-0 text-zinc-500">
                            {TYPE_LABELS[t.blockType] ?? t.blockType}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                            <div
                              className={`h-full rounded-full ${rate >= 60 ? "bg-indigo-400" : "bg-orange-400"}`}
                              style={{ width: `${rate}%` }}
                            />
                          </div>
                          <span className="w-20 shrink-0 text-right font-mono text-zinc-400">
                            {t.correct}/{t.total} · {rate}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-zinc-500">弱项概念（正确率 &lt; 60%）</p>
                  {weakSpots.length === 0 ? (
                    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">
                      暂无明显弱项，继续保持 💪
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {weakSpots.map((c) => {
                        const rate = Math.round((c.correct / c.total) * 100);
                        return (
                          <li
                            key={c.docId}
                            className="flex items-center gap-2 rounded-lg bg-orange-50/60 px-3 py-1.5 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate text-zinc-700">{c.title}</span>
                            <span className="shrink-0 font-mono text-orange-500">
                              {c.correct}/{c.total} · {rate}%
                            </span>
                            {onPractice && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpen(false);
                                  onPractice(c.docId, c.title);
                                }}
                                className="shrink-0 rounded-full border border-orange-200 bg-white px-2 py-0.5 text-[11px] text-orange-600 transition-colors hover:bg-orange-100"
                              >
                                补练
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {open && <div className="fixed inset-0 -z-10" onClick={() => setOpen(false)} aria-hidden />}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-1 py-2">
      <p className="text-sm font-semibold text-zinc-800">{value}</p>
      <p className="mt-0.5 text-[11px] text-zinc-400">{label}</p>
    </div>
  );
}
