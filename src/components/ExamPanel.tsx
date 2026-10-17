"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { getExamCards, reviewCard, type ReviewCard } from "@/lib/api/cards";
import { playComplete, playCorrect, playPop, playWrong } from "@/lib/audio/sound";
import type { ReviewGrade } from "@/lib/fsrs";

const EXAM_COUNT = 20;

const GRADE_BUTTONS: { grade: ReviewGrade; label: string; hint: string; className: string }[] = [
  {
    grade: "again",
    label: "忘记",
    hint: "计 0 分，考后留在今日复习队列",
    className: "border-red-200 bg-red-50 text-red-600 hover:border-red-400",
  },
  {
    grade: "fuzzy",
    label: "模糊",
    hint: "计半分，间隔缩短",
    className: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400",
  },
  {
    grade: "easy",
    label: "记得",
    hint: "计满分，间隔拉长",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400",
  },
];

interface ConceptTally {
  again: number;
  fuzzy: number;
  easy: number;
}

/**
 * 综合测验会话：空间全部复习卡（不限到期）随机抽卷，逐题自评三档。
 * 与复习的差别：每题只出现一次（不追尾）、卷末按概念出分定位薄弱；
 * 评分仍走 FSRS 写回——答错的卡考后自动留在今日复习队列。
 */
export function ExamPanel({
  spaceId,
  onClose,
  onFinish,
}: {
  spaceId: number;
  onClose: () => void;
  /** 会话结束（交卷或中途退出）后刷新地图计数 */
  onFinish: () => void;
}) {
  const [queue, setQueue] = useState<ReviewCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<ReviewGrade, number>>({ again: 0, fuzzy: 0, easy: 0 });
  const [byConcept, setByConcept] = useState<Map<string, ConceptTally>>(new Map());
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    getExamCards(spaceId, EXAM_COUNT)
      .then((cards) => setQueue(cards))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "测验卷加载失败");
        setQueue([]);
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const card = queue !== null ? queue[index] : undefined;
  const finished = queue !== null && index >= queue.length;

  function handleClose() {
    onFinish();
    onClose();
  }

  async function handleGrade(grade: ReviewGrade) {
    if (!card || grading) return;
    setGrading(true);
    if (grade === "easy") playCorrect();
    else if (grade === "again") playWrong();
    else playPop();
    try {
      await reviewCard(card.id, grade);
      setTally((t) => ({ ...t, [grade]: t[grade] + 1 }));
      setByConcept((m) => {
        const next = new Map(m);
        const key = card.originConcept?.trim() || "未分概念";
        const current = next.get(key) ?? { again: 0, fuzzy: 0, easy: 0 };
        next.set(key, { ...current, [grade]: current[grade] + 1 });
        return next;
      });
      setRevealed(false);
      // 考卷每题只出现一次：不追尾，答错的交给考后的今日复习队列
      setIndex((i) => i + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "评分失败，请重试");
    } finally {
      setGrading(false);
    }
  }

  // 键盘：空格/回车翻面；1/2/3 = 忘记/模糊/记得
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || !card || grading) return;
      if ((e.key === " " || e.key === "Enter") && !revealed) {
        e.preventDefault();
        setRevealed(true);
        playPop();
      } else if (revealed && ["1", "2", "3"].includes(e.key)) {
        handleGrade(GRADE_BUTTONS[Number(e.key) - 1].grade);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const total = tally.again + tally.fuzzy + tally.easy;
  const score = total > 0 ? Math.round(((tally.easy + tally.fuzzy * 0.5) / total) * 100) : 0;
  const conceptRows = [...byConcept.entries()]
    .map(([concept, t]) => {
      const n = t.again + t.fuzzy + t.easy;
      return { concept, n, rate: (t.easy + t.fuzzy * 0.5) / n, tally: t };
    })
    .sort((a, b) => a.rate - b.rate);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/30" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 18 }}
          className="w-full max-w-lg rounded-2xl border border-stone-200 bg-card p-5 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-stone-900">📝 综合测验</h3>
            {queue !== null && !finished && queue.length > 0 && (
              <span className="text-xs text-stone-400">
                第 {Math.min(index + 1, queue.length)} 题 / 共 {queue.length} 题
              </span>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="ml-auto rounded-full border border-stone-200 px-2 py-0.5 text-xs text-stone-400 transition-colors hover:text-stone-700"
            >
              退出
            </button>
          </div>
          {queue !== null && queue.length > 0 && !finished && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-accent-500 transition-all duration-300"
                style={{ width: `${(index / queue.length) * 100}%` }}
              />
            </div>
          )}

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

          {queue === null && !error && <p className="py-10 text-center text-sm text-stone-400">正在组卷…</p>}

          {queue !== null && queue.length === 0 && (
            <p className="py-10 text-center text-sm leading-6 text-stone-500">
              这个空间还没有复习卡，组不了卷
              <br />
              <span className="text-xs text-stone-400">先在讲解底部「制成复习卡」，或在「卡片」里手写补充</span>
            </p>
          )}

          {card && (
            <div className="mt-4">
              {card.originConcept && (
                <p className="mb-2 inline-block rounded-full bg-secondary-50 px-2 py-0.5 text-[10px] text-secondary-600">
                  {card.originConcept}
                </p>
              )}
              <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-stone-800">{card.front}</p>
              </div>

              {revealed ? (
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"
                >
                  <p className="whitespace-pre-wrap text-sm leading-6 text-emerald-900">{card.back}</p>
                </motion.div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setRevealed(true);
                    playPop();
                  }}
                  className="mt-3 w-full rounded-xl bg-accent-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-500"
                >
                  显示答案（空格）
                </button>
              )}

              {revealed && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {GRADE_BUTTONS.map((btn, i) => (
                    <button
                      key={btn.grade}
                      type="button"
                      disabled={grading}
                      onClick={() => handleGrade(btn.grade)}
                      title={btn.hint}
                      className={`rounded-xl border py-2 text-sm font-medium transition-colors disabled:opacity-50 ${btn.className}`}
                    >
                      {btn.label}
                      <span className="ml-1 text-[10px] opacity-60">{i + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {finished && queue !== null && queue.length > 0 && (
            <div className="py-4">
              <div className="text-center">
                <p className="font-display text-4xl font-bold text-accent-600">{score} 分</p>
                <p className="mt-1 text-xs text-stone-500">
                  共 {total} 题 · <span className="text-emerald-600">记得 {tally.easy}</span> ·{" "}
                  <span className="text-amber-600">模糊 {tally.fuzzy}</span> ·{" "}
                  <span className="text-red-500">忘记 {tally.again}</span>
                </p>
              </div>

              {conceptRows.length > 1 && (
                <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-stone-100 p-2">
                  {conceptRows.map((row) => (
                    <div key={row.concept} className="flex items-center gap-2 px-1.5 py-1.5">
                      <span className="w-28 shrink-0 truncate text-xs text-stone-600" title={row.concept}>
                        {row.concept}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                        <div
                          className={`h-full rounded-full ${
                            row.rate >= 0.6 ? "bg-emerald-400" : row.rate >= 0.3 ? "bg-amber-400" : "bg-red-400"
                          }`}
                          style={{ width: `${Math.max(4, row.rate * 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[10px] tabular-nums text-stone-400">
                        {Math.round(row.rate * 100)}%（{row.n} 题）
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-3 text-center text-xs text-stone-400">
                {tally.again > 0
                  ? `忘记的 ${tally.again} 张已进入今日复习队列，考完趁热补一轮`
                  : "全卷没有忘记的卡，保持这个节奏"}
              </p>
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-xl bg-accent-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500"
                >
                  交卷
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
      {finished && queue !== null && queue.length > 0 && <SessionDoneSound trigger={finished} />}
    </>
  );
}

/** 交卷音只在交卷那一刻响一次（渲染守卫防重复） */
function SessionDoneSound({ trigger }: { trigger: boolean }) {
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    if (trigger && !played) {
      playComplete();
      setPlayed(true);
    }
  }, [trigger, played]);
  return null;
}
