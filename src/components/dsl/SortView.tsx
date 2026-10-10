"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SortBlock } from "@/lib/dsl/schema";
import { hashOrder } from "@/lib/dsl/order";

/**
 * 分类练习：每条目点类别 chip 归类，全部归完检查；题面用确定性洗牌打乱，
 * 避免按类别连续排列时答案被顺序泄露。
 */
export function SortView({ block }: { block: SortBlock }) {
  const [assigned, setAssigned] = useState<(number | null)[]>(() => block.items.map(() => null));
  const [checked, setChecked] = useState(false);

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

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-zinc-800">
        <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-700">
          分类
        </span>
        {block.prompt}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {block.categories.map((c, ci) => (
          <span
            key={ci}
            className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700"
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
            <div
              key={orig}
              className={[
                "flex flex-wrap items-center gap-1.5 rounded-lg border px-3 py-2 transition-colors",
                correct
                  ? "border-emerald-300 bg-emerald-50/60"
                  : wrongRow
                    ? "border-red-200 bg-red-50/40"
                    : "border-zinc-200",
              ].join(" ")}
            >
              <span className="mr-1 text-sm text-zinc-800">{item.label}</span>
              {block.categories.map((c, ci) => (
                <button
                  key={ci}
                  type="button"
                  disabled={checked}
                  onClick={() => assign(orig, ci)}
                  className={[
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-default",
                    choice === ci
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-indigo-300 hover:text-indigo-700",
                  ].join(" ")}
                >
                  {c}
                </button>
              ))}
              {wrongRow && (
                <span className="ml-auto text-xs text-red-500">应为 {item.category}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        {!checked ? (
          <button
            type="button"
            disabled={!allAssigned}
            onClick={() => setChecked(true)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            检查
          </button>
        ) : (
          <button type="button" onClick={reset} className="text-xs text-indigo-600 hover:underline">
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
              className={`mt-3 text-sm font-medium ${allCorrect ? "text-emerald-600" : "text-red-600"}`}
            >
              {allCorrect ? "全部分类正确！" : `${correctCount}/${block.items.length} 正确`}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
