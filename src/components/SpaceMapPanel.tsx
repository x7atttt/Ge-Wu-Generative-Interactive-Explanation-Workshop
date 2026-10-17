"use client";

import { useCallback, useEffect, useState } from "react";
import { getSpaceMap, generateRoadmap, type SpaceMap } from "@/lib/api/spaces";
import { localDay } from "@/lib/fsrs";
import { ReviewPanel } from "@/components/ReviewPanel";
import { ExamPanel } from "@/components/ExamPanel";
import { CardManagerPanel } from "@/components/CardManagerPanel";

const STATUS_META: Record<
  string,
  { label: string; chip: string; hint: string }
> = {
  new: {
    label: "未学",
    chip: "border-stone-200 bg-card text-stone-600 hover:border-secondary-300 hover:text-secondary-700",
    hint: "点击生成讲解",
  },
  explained: {
    label: "已讲解",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400",
    hint: "点击打开讲解继续练习",
  },
  practiced: {
    label: "已练习",
    chip: "border-secondary-200 bg-secondary-50 text-secondary-700 hover:border-secondary-400",
    hint: "点击打开讲解",
  },
  weak: {
    label: "薄弱",
    chip: "border-red-300 bg-red-50 text-red-600 hover:border-red-400 font-medium",
    hint: "点击生成针对性补练",
  },
};

/** 距考试天数文案（examDate 为 YYYY-MM-DD；过期显示已过天数） */
function countdownText(examDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = new Date(`${examDate}T00:00:00`);
  if (Number.isNaN(exam.getTime())) return "";
  const days = Math.round((exam.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "今天开考";
  return days > 0 ? `距考试 ${days} 天` : `考试已过 ${-days} 天`;
}

/** 本地日期 → MM-DD */
function monthDay(day: string): string {
  return day.slice(5);
}

function addLocalDays(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface PlanLine {
  days: string;
  label: string;
  detail: string;
}

/**
 * 考前每日计划（确定性分配，无 LLM）：未完成站顺序装进"考前一日"之前的每个学习日
 * （每天装 ceil(剩余站数/剩余天数) 站，概念多的站不拆散），最后一程固定为
 * "考前冲刺：综合测验 + 清到期复习"。考试已过/无路线/无日期时不产出。
 */
function buildExamPlan(input: {
  roadmap: { title: string; concepts: string[] }[];
  statusOf: (text: string) => string;
  examDate?: string | null;
  today: string;
}): PlanLine[] {
  const { roadmap, statusOf, examDate, today } = input;
  if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return [];
  const daysLeft = Math.round(
    (new Date(`${examDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000
  );
  if (daysLeft < 0) return [];
  const unfinished = roadmap
    .map((s) => ({
      title: s.title,
      count: s.concepts.filter((t) => statusOf(t) !== "practiced").length,
    }))
    .filter((s) => s.count > 0);

  const lines: PlanLine[] = [];
  const studyDays = daysLeft - 1; // 最后一日留给冲刺；考试当天不排学习
  let idx = 0;
  for (let d = 0; d < studyDays && idx < unfinished.length; d++) {
    // 剩余站数 ≥ 剩余天数时每天多装几站，保证考前能过完
    const take = Math.max(1, Math.ceil((unfinished.length - idx) / (studyDays - d)));
    const stages = unfinished.slice(idx, idx + take);
    idx += take;
    lines.push({
      days: monthDay(addLocalDays(today, d)),
      label: stages.map((s) => s.title).join(" ＋ "),
      detail: `${stages.reduce((n, s) => n + s.count, 0)} 个概念`,
    });
  }
  // 没分完的站（学习日为 0 或异常）并入冲刺行提示
  const leftover = idx < unfinished.length ? unfinished.length - idx : 0;
  lines.push({
    days: monthDay(addLocalDays(today, Math.max(0, daysLeft - 1))),
    label: "考前冲刺",
    detail:
      (leftover > 0 ? `还有 ${leftover} 站未过完，先挑薄弱 · ` : "") +
      "📝 综合测验 + 🔖 清到期复习",
  });
  return lines;
}

/**
 * 概念地图（空间核心视图）：资料提炼概念 × 讲解/练习状态。
 * 点击行为按状态分派：未学→生成 / 已讲解·已练习→打开讲解 / 薄弱→补练。
 * 头部：考试倒计时（枢纽里设日期）+ FSRS 复习入口（到期 n 张）。
 */
export function SpaceMapPanel({
  spaceId,
  examDate,
  note,
  refreshKey,
  disabled,
  hasDoc,
  onJumpToDoc,
  onPick,
  onPractice,
  onOpenDoc,
}: {
  spaceId: number;
  /** 考试日期（来自空间列表，枢纽改日期后即时生效） */
  examDate?: string | null;
  /** 空间备注（来自空间列表，枢纽改备注后即时生效；空时回落地图自带的） */
  note?: string;
  /** 父级事件后自增以重拉地图（生成完成/切换文档等） */
  refreshKey: number;
  disabled?: boolean;
  /** 当前已加载讲解（快捷跳转入口的显隐） */
  hasDoc?: boolean;
  /** 滚动到下方讲解区 */
  onJumpToDoc?: () => void;
  /** 未学概念 → 生成：附加来源资料 + 记录出身概念 */
  onPick: (concept: string, sourceIds: number[]) => void;
  /** 薄弱概念 → 补练（以该概念最近一次讲解的统计为准） */
  onPractice: (docId: number, title: string) => void;
  onOpenDoc: (docId: number) => void;
}) {
  const [map, setMap] = useState<SpaceMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [roadmapBusy, setRoadmapBusy] = useState(false);

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
    conceptClick(concept.text);
  }

  /** 点击分派（地图色块与学习路线站点共用）；路线快照中的概念已不在地图 → 宽容按未学生成 */
  function conceptClick(text: string) {
    if (disabled) return;
    const concept = map?.concepts.find((c) => c.text === text);
    if (!concept) {
      onPick(text, []);
      return;
    }
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

  async function handleGenRoadmap() {
    if (disabled || roadmapBusy) return;
    setRoadmapBusy(true);
    try {
      await generateRoadmap(spaceId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "学习路线生成失败");
    } finally {
      setRoadmapBusy(false);
    }
  }

  if (error) {
    return (
      <section className="mt-6 rounded-2xl border border-stone-200 bg-card p-4 shadow-sm">
        <p className="text-sm text-red-600">{error}</p>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-secondary-100 bg-card/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-base font-bold text-stone-900">
          📖 概念地图{map ? ` · ${map.space.name}` : ""}
        </h2>
        {map && (
          <p className="text-xs text-stone-500">
            {map.summary.sources} 份资料 · {map.concepts.length} 个概念 · 已讲 {map.summary.explained}
            {map.summary.weak > 0 && (
              <span className="ml-1 font-medium text-red-500">· {map.summary.weak} 个薄弱</span>
            )}
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {examDate && countdownText(examDate) && (
            <span className="text-xs font-medium text-orange-600">{countdownText(examDate)}</span>
          )}
          {map && map.cards.total > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setReviewOpen(true)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                map.cards.due > 0
                  ? "border-orange-300 bg-orange-50 font-medium text-orange-700 hover:border-orange-400"
                  : "border-stone-200 text-stone-400 hover:border-orange-200 hover:text-orange-600"
              }`}
              title="FSRS 间隔复习：讲解底部的题目按遗忘曲线安排回来"
            >
              🔖 复习{map.cards.due > 0 ? ` ${map.cards.due}` : "·已清"}
            </button>
          )}
          {map && map.cards.total > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setExamOpen(true)}
              className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-500 transition-colors hover:border-accent-300 hover:text-accent-600 disabled:opacity-50"
              title="综合测验：全部复习卡随机抽卷模拟考试，按概念出分定位薄弱"
            >
              📝 测验
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCardsOpen(true)}
            className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-500 transition-colors hover:border-secondary-300 hover:text-secondary-600 disabled:opacity-50"
            title="卡片管理：查看/手写补充/编辑/删除复习卡（复习与测验共用题库）"
          >
            🗂 卡片
          </button>
          {hasDoc && onJumpToDoc && (
            <button
              type="button"
              disabled={disabled}
              onClick={onJumpToDoc}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 transition-colors hover:border-emerald-400 disabled:opacity-50"
              title="跳转到下方当前讲解"
            >
              ⤓ 讲解
            </button>
          )}
          <div className="flex items-center gap-2 text-[10px] text-stone-400">
            {(["weak", "new", "practiced", "explained"] as const).map((status) => (
              <span key={status} className="flex items-center gap-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === "weak"
                      ? "bg-red-400"
                      : status === "new"
                        ? "bg-stone-300"
                        : status === "practiced"
                          ? "bg-secondary-400"
                          : "bg-emerald-400"
                  }`}
                />
                {STATUS_META[status].label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {(note || map?.space.note) && (
        <p className="mt-1 text-xs leading-5 text-stone-500">{note || map?.space.note}</p>
      )}

      {map && map.concepts.length === 0 && (
        <p className="mt-3 rounded-lg bg-stone-50 px-3 py-4 text-center text-xs leading-5 text-stone-500">
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
      {loading && <p className="mt-2 text-xs text-stone-300">刷新中…</p>}

      {/* 学习路线：概念按依赖/难度编排的攻克路径（LLM 快照，重生成覆盖；完成度由概念状态推出） */}
      {map && (map.roadmap || map.concepts.length >= 2) && (
        <div className="mt-3 border-t border-stone-100 pt-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-stone-600">🗺 学习路线</h3>
            {map.roadmap && map.roadmapAt && (
              <span className="text-[10px] text-stone-300">生成于 {map.roadmapAt.slice(5, 16)}</span>
            )}
            <button
              type="button"
              disabled={disabled || roadmapBusy}
              onClick={handleGenRoadmap}
              className="ml-auto rounded-full border border-stone-200 px-2.5 py-1 text-[11px] text-stone-500 transition-colors hover:border-secondary-300 hover:text-secondary-600 disabled:opacity-50"
              title="把空间内概念按学习依赖与难度编排成 3~8 站的攻克路径"
            >
              {roadmapBusy ? "编排中…" : map.roadmap ? "重新生成" : "生成学习路线"}
            </button>
          </div>

          {map.roadmap ? (
            <div className="mt-2 space-y-2">
              {(() => {
                const byText = new Map(map.concepts.map((c) => [c.text, c]));
                const statusOf = (text: string) => byText.get(text)?.status ?? "new";
                const currentStage = map.roadmap!.findIndex((s) =>
                  s.concepts.some((t) => statusOf(t) !== "practiced")
                );
                return map.roadmap!.map((stage, i) => {
                  const done = stage.concepts.filter((t) => statusOf(t) === "practiced").length;
                  const isCurrent = i === currentStage;
                  return (
                    <div
                      key={`${stage.title}-${i}`}
                      className={`rounded-xl border p-2.5 transition-colors ${
                        isCurrent ? "border-accent-300 bg-accent-50/40" : "border-stone-100"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                            isCurrent ? "bg-accent-600 text-white" : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          第 {i + 1} 站
                        </span>
                        <span className="text-sm font-medium text-stone-800">{stage.title}</span>
                        {isCurrent && (
                          <span className="text-[10px] font-medium text-accent-600">当前站</span>
                        )}
                        <span className="ml-auto text-[10px] tabular-nums text-stone-400">
                          {done}/{stage.concepts.length} 已练成
                        </span>
                      </div>
                      {stage.goal && (
                        <p className="mt-1 text-[11px] leading-4 text-stone-400">{stage.goal}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {stage.concepts.map((text) => (
                          <button
                            key={text}
                            type="button"
                            onClick={() => conceptClick(text)}
                            title={STATUS_META[statusOf(text)].hint}
                            className={`rounded-lg border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                              STATUS_META[statusOf(text)].chip
                            }`}
                          >
                            {text}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            !roadmapBusy && (
              <p className="mt-1.5 text-[11px] leading-5 text-stone-400">
                把空间内的概念按学习依赖与难度编排成逐站攻克路径
              </p>
            )
          )}

          {/* 考前每日计划：路线未完成站按概念数加权瓜分学习日（确定性派生，无 LLM） */}
          {(() => {
            if (!map?.roadmap) return null;
            const byText = new Map(map.concepts.map((c) => [c.text, c]));
            const plan = buildExamPlan({
              roadmap: map.roadmap,
              statusOf: (t) => byText.get(t)?.status ?? "new",
              examDate,
              today: localDay(),
            });
            if (plan.length === 0) return null;
            return (
              <div className="mt-2 rounded-xl bg-stone-50/70 p-2.5">
                <p className="mb-1 text-[11px] font-semibold text-stone-500">📅 考前计划</p>
                {plan.map((line, i) => (
                  <p key={i} className="flex items-baseline gap-2 text-[11px] leading-5 text-stone-600">
                    <span className="w-20 shrink-0 font-mono text-stone-400">{line.days}</span>
                    <span className="font-medium text-stone-700">{line.label}</span>
                    <span className="text-stone-400">{line.detail}</span>
                  </p>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {reviewOpen && (
        <ReviewPanel spaceId={spaceId} onClose={() => setReviewOpen(false)} onFinish={refresh} />
      )}
      {examOpen && (
        <ExamPanel spaceId={spaceId} onClose={() => setExamOpen(false)} onFinish={refresh} />
      )}
      {cardsOpen && (
        <CardManagerPanel
          spaceId={spaceId}
          concepts={(map?.concepts ?? []).map((c) => c.text)}
          onClose={() => setCardsOpen(false)}
          onChanged={refresh}
        />
      )}
    </section>
  );
}
