"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { MatchBlock } from "@/lib/dsl/schema";
import { hashOrder } from "@/lib/dsl/order";

/**
 * 配对：点左列一项选中，再点右列对应项；配对按内容判定（schema 保证两列各自不重复），
 * 右列用确定性洗牌打乱。错配 shake 反馈并计失误，全配对后展示小结。
 */
export function MatchView({ block }: { block: MatchBlock }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [matched, setMatched] = useState<number[]>([]);
  const [wrong, setWrong] = useState<{ left: number; right: number } | null>(null);
  const [mistakes, setMistakes] = useState(0);

  // rightOrder[显示位 j] = 原始对下标；与 item 内容绑定，SSR/客户端一致
  const rightOrder = useMemo(
    () => hashOrder(block.pairs.map((p) => p.right)),
    [block]
  );

  useEffect(() => {
    if (!wrong) return;
    const t = setTimeout(() => setWrong(null), 500);
    return () => clearTimeout(t);
  }, [wrong]);

  const done = matched.length === block.pairs.length;

  const clickRight = (j: number) => {
    if (selected === null || matched.includes(rightOrder[j])) return;
    if (rightOrder[j] === selected) {
      setMatched((prev) => [...prev, selected]);
      setSelected(null);
    } else {
      setWrong({ left: selected, right: j });
      setMistakes((m) => m + 1);
      setSelected(null);
    }
  };

  const reset = () => {
    setSelected(null);
    setMatched([]);
    setMistakes(0);
  };

  const shake = { x: [0, -6, 6, -4, 4, 0] };
  const itemClass = (state: "idle" | "selected" | "matched" | "wrong") =>
    [
      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
      state === "matched"
        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
        : state === "selected"
          ? "border-indigo-400 bg-indigo-50 text-indigo-700"
          : state === "wrong"
            ? "border-red-300 bg-red-50 text-red-600"
            : "border-zinc-200 bg-white text-zinc-700 hover:border-indigo-300 hover:text-indigo-700",
    ].join(" ");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="mb-1 text-sm font-medium text-zinc-800">
        <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-700">
          配对
        </span>
        {block.prompt}
      </p>
      <p className="mb-3 text-xs text-zinc-400">点击左列一项，再点右列中与它对应的项</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          {block.pairs.map((pair, li) => {
            const state = matched.includes(li)
              ? "matched"
              : wrong?.left === li
                ? "wrong"
                : selected === li
                  ? "selected"
                  : "idle";
            return (
              <motion.button
                key={li}
                type="button"
                animate={state === "wrong" ? shake : { x: 0 }}
                transition={{ duration: 0.4 }}
                disabled={state === "matched"}
                onClick={() => state !== "wrong" && setSelected(selected === li ? null : li)}
                className={itemClass(state)}
              >
                {pair.left}
              </motion.button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          {rightOrder.map((orig, j) => {
            const state = matched.includes(orig)
              ? "matched"
              : wrong?.right === j
                ? "wrong"
                : "idle";
            return (
              <motion.button
                key={orig}
                type="button"
                animate={state === "wrong" ? shake : { x: 0 }}
                transition={{ duration: 0.4 }}
                disabled={state === "matched" || selected === null}
                onClick={() => clickRight(j)}
                className={`${itemClass(state)} ${selected !== null && state === "idle" ? "cursor-pointer" : "cursor-default"} disabled:opacity-100`}
              >
                {block.pairs[orig].right}
              </motion.button>
            );
          })}
        </div>
      </div>

      {done && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 flex items-center gap-3"
        >
          <p className="text-sm font-medium text-emerald-600">
            全部配对成功{mistakes > 0 ? `（失误 ${mistakes} 次）` : "，一次通过！"}
          </p>
          <button type="button" onClick={reset} className="text-xs text-indigo-600 hover:underline">
            重做
          </button>
        </motion.div>
      )}
    </div>
  );
}
