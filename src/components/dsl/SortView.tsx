"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SortBlock } from "@/lib/dsl/schema";
import { hashOrder } from "@/lib/dsl/order";
import { playComplete, playWrong } from "@/lib/audio/sound";
import { celebrateAt } from "@/lib/celebrate";
import { useAttempt } from "./attempt-context";
import { CheckDraw } from "./CheckDraw";
import { SHAKE, SHAKE_IDLE, SHAKE_TRANSITION } from "./motion-presets";

/**
 * 分类练习：每条目点类别 chip 归类，全部归完检查；题面用确定性洗牌打乱，
 * 避免按类别连续排列时答案被顺序泄露。
 */
export function SortView({ block }: { block: SortBlock }) {
  const [assigned, setAssigned] = useState<(number | null)[]>(() => block.items.map(() => null));
  const [checked, setChecked] = useState(false);
  const attempt = useAttempt();
  const cardRef = useRef<HTMLDivElement>(null);

  const itemOrder = useMemo(() => hashOrder(block.items.map((it) => it.label)), [block]);

  const allAssigned = assigned.every((a) => a !== null);
  const correctCount = assigned.reduce<number>(
    (acc, a, i) => acc + (a !== null && block.categories[a] === block.items[i].category ? 1 : 0),
    0
  );
  const allCorrect = correctCount === block.items.length;

  const assign = (item: number, category: number) => {
    if (checked) return;
    setAssigned((prev) => prev.map((a, i) => (i === item ? (a === category ? null : category) : a)));
  };

  const reset = () => {
    setAssigned(block.items.map(() => null));
    setChecked(false);
  };

  const check = () => {
    setChecked(true);
    attempt?.report("sort", allCorrect);
    if (allCorrect) {
      playComplete();
      void celebrateAt(cardRef.current);
    } else {
      playWrong();
    }
  };

  return (
    <div ref={cardRef} className="rounded-xl border border-stone-200 bg-card p-4">
      <p className="mb-2 text-sm font-medium text-stone-800">
        <span className="mr-1.5 rounded bg-accent-100 px-1.5 py-0.5 text-xs font-semibold text-accent-700">
          分类
        </span>
        {block.prompt}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {block.categories.map((c, ci) => (
          <span
            key={ci}
            className="rounded-full border border-accent-100 bg-accent-50 px-2.5 py-1 text-xs text-accent-700"
          >
            {c}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {itemOrder.map((orig) => {
          const item = block.items[orig];
          const choice = assigned[orig];
          const correct = checked && choice !== null && block.categories[choice] === item.category;
          const wrongRow = checked && !correct;
          return (
            <motion.div
              key={orig}
              animate={wrongRow ? SHAKE : SHAKE_IDLE}
              transition={SHAKE_TRANSITION}
              className={[
                "flex flex-wrap items-center gap-1.5 rounded-lg border px-3 py-2 transition-colors",
                correct
                  ? "border-emerald-300 bg-emerald-50/60"
                  : wrongRow
                    ? "border-red-200 bg-red-50/40"
                    : "border-stone-200",
              ].join(" ")}
            >
              <span className="mr-1 text-sm text-stone-800">{item.label}</span>
              {block.categories.map((c, ci) => (
                <button
                  key={ci}
                  type="button"
                  disabled={checked}
                  onClick={() => assign(orig, ci)}
                  className={[
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-default",
                    choice === ci
                      ? "border-accent-400 bg-accent-50 text-accent-700"
                      : "border-stone-200 bg-card text-stone-600 hover:border-accent-300 hover:text-accent-700",
                  ].join(" ")}
                >
                  {c}
                </button>
              ))}
              {wrongRow && (
                <span className="ml-auto text-xs text-red-500">应为 {item.category}</span>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        {!checked ? (
          <button
            type="button"
            disabled={!allAssigned}
            onClick={check}
            className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            检查
          </button>
        ) : (
          <button type="button" onClick={reset} className="text-xs text-accent-600 hover:underline">
            重做
          </button>
        )}
      </div>

      <AnimatePresence>
        {checked && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <p
              className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${allCorrect ? "text-emerald-600" : "text-red-600"}`}
            >
              {allCorrect && <CheckDraw />}
              {allCorrect ? "全部分类正确！" : `${correctCount}/${block.items.length} 正确`}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
