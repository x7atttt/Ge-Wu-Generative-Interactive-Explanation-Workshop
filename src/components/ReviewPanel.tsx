"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { listAllCards, listDueCards, reviewCard, type ReviewCard } from "@/lib/api/cards";
import { playComplete, playCorrect, playPop, playWrong } from "@/lib/audio/sound";
import { useReducedMotion } from "motion/react";
import { localDay, type ReviewGrade } from "@/lib/fsrs";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { MarkdownView } from "./dsl/MarkdownView";

const GRADE_BUTTONS: { grade: ReviewGrade; label: string; hint: string; className: string }[] = [
  {
    grade: "again",
    label: "忘记",
    hint: "稳定度回落，今天还会再遇到",
    className: "border-red-200 bg-red-50 text-red-600 hover:border-red-400",
  },
  {
    grade: "fuzzy",
    label: "模糊",
    hint: "想起来了但费劲，间隔按稳定度正常推进",
    className: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400",
  },
  {
    grade: "easy",
    label: "记得",
    hint: "轻松答对，间隔加成拉长",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400",
  },
];

/**
 * FSRS 复习会话：到期卡片逐张过——看题面→显示答案→三档评分（键盘 空格翻面 / 1·2·3 评分）。
 * 评分即调度：忘记当日重见，模糊/记得按遗忘曲线推演的稳定度排间隔。
 */
export function ReviewPanel({
  spaceId,
  onClose,
  onFinish,
  cardIds,
  onOpenDoc,
}: {
  spaceId: number;
  onClose: () => void;
  /** 会话结束（全部过完或中途退出）后刷新地图计数 */
  onFinish: () => void;
  cardIds?: number[];
  onOpenDoc: (id: number) => void;
}) {
  const [queue, setQueue] = useState<ReviewCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<ReviewGrade, number>>({ again: 0, fuzzy: 0, easy: 0 });
  const [initialCount, setInitialCount] = useState(0);
  const [deferred, setDeferred] = useState<number[]>([]);
  const gradeLock = useRef(false);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const reducedMotion = useReducedMotion();

  const load = useCallback(() => (cardIds ? listAllCards(spaceId).then((cards) => cards.filter((c) => cardIds.includes(c.id) && c.due <= localDay())) : listDueCards(spaceId)).then((cards) => {
      setQueue(cards); setInitialCount(cards.length); setError(null);
      setIndex(0); setRevealed(false); setDeferred([]); setTally({ again: 0, fuzzy: 0, easy: 0 });
    }).catch((err) => { setError(err instanceof Error ? err.message : "复习队列加载失败"); }), [spaceId, cardIds]);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const card = queue !== null ? queue[index] : undefined;
  const finished = queue !== null && index >= queue.length;

  function handleClose() {
    onFinish();
    onClose();
  }

  async function handleGrade(grade: ReviewGrade) {
    if (!card || card.issue || gradeLock.current) return;
    gradeLock.current = true;
    setGrading(true);
    setError(null);
    if (grade === "easy") playCorrect();
    else if (grade === "again") playWrong();
    else playPop();
    try {
      await reviewCard(card.id, grade);
      setTally((t) => ({ ...t, [grade]: t[grade] + 1 }));
      setRevealed(false);
      if (grade === "again") {
        // 忘记的卡追加到本次队列尾部（当天再过一遍），其余推进
        setQueue((q) => (q ? [...q, card] : q));
      }
      setIndex((i) => i + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "评分失败，请重试");
    } finally {
      gradeLock.current = false;
      setGrading(false);
    }
  }

  // 键盘：空格/回车翻面；1/2/3 = 忘记/模糊/记得
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || !card || grading) return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if ([" ", "Enter"].includes(e.key) && (e.target as HTMLElement).closest("button, a")) return;
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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/30" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          ref={dialogRef} tabIndex={-1}
          initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 18 }}
          role="dialog" aria-modal="true" aria-label="复习"
          className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-card p-5 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-stone-900">🔖 复习</h3>
            {queue !== null && !finished && (
              <span className="text-xs text-stone-400">
                {initialCount} 张卡 · 已评分 {tally.again + tally.fuzzy + tally.easy} 次 · 待处理 {queue.length - index} 次
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

          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}
            {!queue && <button type="button" className="ml-2 underline" onClick={load}>重试加载</button>}
          </p>}

          {queue === null && !error && <p className="py-10 text-center text-sm text-stone-400">加载复习队列…</p>}

          {queue !== null && queue.length === 0 && initialCount === 0 && (
            <p className="py-10 text-center text-sm leading-6 text-stone-500">
              {cardIds ? "本次选中的卡片已处理或删除，没有仍到期的卡" : "今日没有到期的复习卡"}
              <br />
              <span className="text-xs text-stone-400">在讲解底部点「制成复习卡」，题目会按遗忘曲线安排回来</span>
            </p>
          )}

          {card && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap gap-3 text-xs">
                <button type="button" disabled={grading} className="min-h-9 text-stone-600 underline" onClick={() => {
                  if (gradeLock.current) return;
                  setDeferred((ids) => [...new Set([...ids, card.id])]);
                  setQueue((q) => q?.filter((c, i) => i < index || c.id !== card.id) ?? null);
                  setRevealed(false); setError(null);
                }}>稍后再练</button>
                {!!card.docId && <button type="button" disabled={grading} className="min-h-9 text-accent-600 underline" onClick={() => { handleClose(); onOpenDoc(card.docId); }}>查看原讲解</button>}
              </div>
              <p className="mb-2 text-xs text-stone-500">难卡可暂缓，仍保留在今日到期队列。</p>
              {card.issue && <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{card.issue} 请先点“稍后再练”，本题暂不评分。</p>}
              {card.originConcept && (
                <p className="mb-2 inline-block rounded-full bg-secondary-50 px-2 py-0.5 text-[10px] text-secondary-600">
                  {card.originConcept}
                </p>
              )}
              <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-4">
                <div className="text-sm leading-6 text-stone-800"><MarkdownView content={card.front} /></div>
              </div>

              {revealed ? (
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"
                >
                  <div className="text-sm leading-6 text-emerald-900"><MarkdownView content={card.back} /></div>
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

              {revealed && !card.issue && (
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

          {finished && initialCount > 0 && (
            <div className="py-6 text-center">
              <p className="text-sm font-medium text-stone-800">
                本轮结束，{initialCount} 张卡 · {tally.again + tally.fuzzy + tally.easy} 次评分
              </p>
              <p className="mt-1 text-xs text-stone-500">
                <span className="text-emerald-600">记得 {tally.easy}</span> ·{" "}
                <span className="text-amber-600">模糊 {tally.fuzzy}</span> ·{" "}
                <span className="text-red-500">忘记 {tally.again}</span>
                <br />
                {deferred.length > 0 ? `暂缓 ${deferred.length} 张，仍在今日到期队列，可稍后回来处理` : "本轮卡片已处理，后续按排期回来复习"}
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-4 rounded-xl bg-accent-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500"
              >
                完成
              </button>
            </div>
          )}
        </motion.div>
      </div>
      {finished && <SessionDoneSound trigger={finished} />}
    </>
  );
}

/** 会话完成音只在完成那一刻响一次（渲染守卫防重复） */
function SessionDoneSound({ trigger }: { trigger: boolean }) {
  const played = useRef(false);
  useEffect(() => {
    if (trigger && !played.current) {
      playComplete();
      played.current = true;
    }
  }, [trigger]);
  return null;
}
