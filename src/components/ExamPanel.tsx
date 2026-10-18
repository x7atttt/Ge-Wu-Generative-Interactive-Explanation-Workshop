"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { answerExam, getExam, listExams, startExam, type ExamSession, type ExamGrade } from "@/lib/api/exams";
import { playComplete, playCorrect, playPop, playWrong } from "@/lib/audio/sound";
import type { ReviewGrade } from "@/lib/fsrs";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { MarkdownView } from "./dsl/MarkdownView";

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
  onReview,
  onOpenDoc,
}: {
  spaceId: number;
  onClose: () => void;
  /** 会话结束（交卷或中途退出）后刷新地图计数 */
  onFinish: () => void;
  onReview: (ids: number[]) => void;
  onOpenDoc: (id: number) => void;
}) {
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gradeLock = useRef(false);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const reducedMotion = useReducedMotion();

  const load = useCallback(() => listExams(spaceId).then((rows) => {
      setSessions(rows);
      setSession(rows.find((s) => !s.completedAt) ?? null);
      setError(null);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "自测记录加载失败");
    }).finally(() => setLoading(false)), [spaceId]);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const queue = session?.cards ?? null;
  const index = queue?.findIndex((c) => session?.answers[c.id] === undefined) ?? -1;
  const card = index >= 0 ? queue?.[index] : undefined;
  const finished = !!session?.completedAt;
  const tally: ConceptTally = { again: 0, fuzzy: 0, easy: 0 };
  const byConcept = new Map<string, ConceptTally>();
  for (const c of queue ?? []) {
    const grade = session?.answers[c.id];
    if (!grade || grade === "skipped") continue;
    tally[grade]++;
    const key = c.originConcept?.trim() || "未分概念";
    const row = byConcept.get(key) ?? { again: 0, fuzzy: 0, easy: 0 };
    row[grade]++;
    byConcept.set(key, row);
  }

  async function begin() {
    if (gradeLock.current) return;
    gradeLock.current = true;
    setLoading(true);
    try { setSession(await startExam(spaceId)); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : "组卷失败"); }
    finally { gradeLock.current = false; setLoading(false); }
  }

  function handleClose() {
    onFinish();
    onClose();
  }

  async function handleGrade(grade: ExamGrade) {
    if (!card || !session || gradeLock.current) return;
    if (card.issue && grade !== "skipped") return;
    gradeLock.current = true;
    setGrading(true);
    setError(null);
    if (grade === "easy") playCorrect();
    else if (grade === "again") playWrong();
    else playPop();
    try {
      setSession(await answerExam(session.id, card.id, grade));
      setRevealed(false);
      onFinish();
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
          ref={dialogRef} tabIndex={-1}
          initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 18 }}
          role="dialog" aria-modal="true" aria-label="综合自测"
          className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-200 bg-card p-5 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-stone-900">综合自测</h3>
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
              {finished ? "关闭报告" : "保存并退出"}
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

          <p className="mt-2 text-xs leading-5 text-stone-500">翻面后自行评价记忆情况，分数来自自评。逐题保存，可退出后继续。</p>
          {error && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}
            <button type="button" className="ml-2 underline" onClick={async () => {
              try { if (session) setSession(await getExam(session.id)); else await load(); setError(null); }
              catch (err) { setError(err instanceof Error ? err.message : "刷新失败"); }
            }}>刷新进度</button>
            {error.includes("已被删除") && <button type="button" disabled={grading} className="ml-2 underline" onClick={() => handleGrade("skipped")}>跳过已删除卡</button>}
          </div>}
          {loading && <p className="py-6 text-center text-sm text-stone-500">加载自测记录…</p>}
          {!session && !loading && <div className="space-y-3 py-4">
            <button type="button" onClick={begin} className="w-full rounded-xl bg-accent-600 py-3 text-sm text-white">开始新自测</button>
            <p className="text-xs text-stone-500">最近的自测报告</p>
            {sessions.length === 0 && <p className="text-xs text-stone-500">还没有报告，完成自测后会保存在这里。</p>}
            {sessions.filter((s) => s.completedAt).map((s) => <button key={s.id} type="button" onClick={() => { setSession(s); setRevealed(false); }}
              className="block w-full rounded-xl border border-stone-200 p-3 text-left text-sm hover:border-accent-300">{s.createdAt} · {s.cards.length} 题 · 查看报告</button>)}
          </div>}

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
                <div className="text-sm leading-6 text-stone-800"><MarkdownView content={card.front} /></div>
              </div>
              {card.issue && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900"><p>{card.issue} 此题不计分，也不改变复习排期。</p><button type="button" disabled={grading} onClick={() => handleGrade("skipped")} className="mt-2 min-h-11 rounded-lg border border-amber-400 px-3 font-medium">跳过不完整题目</button></div>}

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

          {finished && queue !== null && queue.length > 0 && (
            <div className="py-4">
              <div className="text-center">
                <p className="font-display text-4xl font-bold text-accent-600">{total > 0 ? `${score} 分` : "未计分"}</p>
                <p className="mt-1 text-xs text-stone-500">
                  共 {total} 题 · <span className="text-emerald-600">记得 {tally.easy}</span> ·{" "}
                  <span className="text-amber-600">模糊 {tally.fuzzy}</span> ·{" "}
                  <span className="text-red-500">忘记 {tally.again}</span>
                </p>
              </div>

              {conceptRows.length > 0 && (
                <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-stone-100 p-2">
                  {conceptRows.map((row) => (
                    <div key={row.concept} className="flex flex-wrap items-center gap-2 px-1.5 py-1.5">
                      <span className="w-28 shrink-0 truncate text-xs text-stone-600" title={row.concept}>
                        {row.concept}
                      </span>
                      {queue.find((c) => c.originConcept === row.concept && c.docId)?.docId && <button type="button" className="text-xs text-accent-600 underline" onClick={() => {
                        const docId = queue.find((c) => c.originConcept === row.concept && c.docId)!.docId;
                        handleClose(); onOpenDoc(docId);
                      }}>相关讲解</button>}
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
                  ? `本次忘记 ${tally.again} 张，可复习其中仍到期的卡片`
                  : total > 0 ? "全卷没有忘记的卡，保持这个节奏" : "本次没有可计分的题目，请先完善卡片"}
              </p>
              <div className="mt-3 text-center">
                <details className="mb-3 rounded-xl border border-stone-200 p-3 text-left text-xs text-stone-700">
                  <summary className="cursor-pointer">本次作答明细</summary>
                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                    {queue.map((c) => <div key={c.id} className="rounded-lg bg-stone-50 p-2">
                      <MarkdownView content={c.front} />
                      <p className="mt-1 font-medium">本次自评：{({ again: "忘记", fuzzy: "模糊", easy: "记得", skipped: "已跳过，未计分" } as const)[session!.answers[c.id]]}</p>
                      <div className="mt-1 leading-5 text-stone-600"><MarkdownView content={c.back} /></div>
                    </div>)}
                  </div>
                </details>
                {tally.again > 0 && <button type="button" onClick={() => {
                  const ids = queue.filter((c) => session?.answers[c.id] === "again").map((c) => c.id);
                  handleClose(); onReview(ids);
                }} className="mb-3 w-full rounded-xl border border-accent-300 py-2 text-sm text-accent-600">复习本次忘记的卡</button>}
                <p className="mb-2 text-xs text-stone-500">报告已保存。已删除或题面不完整而跳过的卡不计分。</p>
                <button
                  type="button"
                  onClick={() => { setSession(null); load(); }}
                  className="rounded-xl bg-accent-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500"
                >
                  返回报告列表
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
  const played = useRef(false);
  useEffect(() => {
    if (trigger && !played.current) {
      playComplete();
      played.current = true;
    }
  }, [trigger]);
  return null;
}
