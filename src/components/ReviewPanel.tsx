"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { listDueCards, reviewCard, type ReviewCard } from "@/lib/api/cards";
import { playComplete, playCorrect, playPop, playWrong } from "@/lib/audio/sound";
import { useReducedMotion } from "motion/react";
import type { ReviewGrade } from "@/lib/srs";

const GRADE_BUTTONS: { grade: ReviewGrade; label: string; hint: string; className: string }[] = [
  {
    grade: "again",
    label: "忘记",
    hint: "重置进度，今天还会再遇到",
    className: "border-red-200 bg-red-50 text-red-600 hover:border-red-400",
  },
  {
    grade: "fuzzy",
    label: "模糊",
    hint: "想起来了但费劲，间隔缩短",
    className: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400",
  },
  {
    grade: "easy",
    label: "记得",
    hint: "轻松答对，间隔拉长",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400",
  },
];

/**
 * SM-2 复习会话：到期卡片逐张过——看题面→显示答案→三档评分（键盘 空格翻面 / 1·2·3 评分）。
 * 评分即调度：忘记留今日队列，模糊/记得按间隔推后。
 */
export function ReviewPanel({
  spaceId,
  onClose,
  onFinish,
}: {
  spaceId: number;
  onClose: () => void;
  /** 会话结束（全部过完或中途退出）后刷新地图计数 */
  onFinish: () => void;
}) {
  const [queue, setQueue] = useState<ReviewCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<ReviewGrade, number>>({ again: 0, fuzzy: 0, easy: 0 });
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    listDueCards(spaceId)
      .then((cards) => setQueue(cards))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "复习队列加载失败");
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
      setRevealed(false);
      if (grade === "again") {
        // 忘记的卡追加到本次队列尾部（当天再过一遍），其余推进
        setQueue((q) => (q ? [...q, card] : q));
      }
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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-900/30" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 18 }}
          className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-800">🔖 复习</h3>
            {queue !== null && !finished && (
              <span className="text-xs text-zinc-400">
                {index + 1} / {queue.length}
              </span>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="ml-auto rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:text-zinc-700"
            >
              退出
            </button>
          </div>

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

          {queue === null && !error && <p className="py-10 text-center text-sm text-zinc-400">加载复习队列…</p>}

          {queue !== null && queue.length === 0 && (
            <p className="py-10 text-center text-sm leading-6 text-zinc-500">
              今日没有到期的复习卡
              <br />
              <span className="text-xs text-zinc-400">在讲解底部点「制成复习卡」，题目会按遗忘曲线安排回来</span>
            </p>
          )}

          {card && (
            <div className="mt-4">
              {card.originConcept && (
                <p className="mb-2 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-600">
                  {card.originConcept}
                </p>
              )}
              <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-800">{card.front}</p>
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
                  className="mt-3 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
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
            <div className="py-6 text-center">
              <p className="text-sm font-medium text-zinc-800">
                本轮过完，共 {tally.again + tally.fuzzy + tally.easy} 次评分
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                <span className="text-emerald-600">记得 {tally.easy}</span> ·{" "}
                <span className="text-amber-600">模糊 {tally.fuzzy}</span> ·{" "}
                <span className="text-red-500">忘记 {tally.again}</span>
                <br />
                忘记的卡仍留在今日队列，明天记得回来
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-4 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
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
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    if (trigger && !played) {
      playComplete();
      setPlayed(true);
    }
  }, [trigger, played]);
  return null;
}
