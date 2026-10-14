"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import type { MatchBlock } from "@/lib/dsl/schema";
import { hashOrder } from "@/lib/dsl/order";
import { playComplete, playPop, playWrong } from "@/lib/audio/sound";
import { celebrateAt } from "@/lib/celebrate";
import { useAttempt } from "./attempt-context";
import { CheckDraw } from "./CheckDraw";
import { SHAKE, SHAKE_IDLE, SHAKE_TRANSITION } from "./motion-presets";

/**
 * 配对：点左列一项选中，再点右列对应项；配对按内容判定（schema 保证两列各自不重复），
 * 右列用确定性洗牌打乱。错配 shake 反馈并计失误，全配对后展示小结。
 */
export function MatchView({ block }: { block: MatchBlock }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [matched, setMatched] = useState<number[]>([]);
  const [wrong, setWrong] = useState<{ left: number; right: number } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const attempt = useAttempt();
  const cardRef = useRef<HTMLDivElement>(null);

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
      const nextMatched = [...matched, selected];
      setMatched(nextMatched);
      setSelected(null);
      playPop();
      if (nextMatched.length === block.pairs.length) {
        attempt?.report("match", mistakes === 0);
        playComplete();
        if (mistakes === 0) void celebrateAt(cardRef.current);
      }
    } else {
      setWrong({ left: selected, right: j });
      setMistakes((m) => m + 1);
      setSelected(null);
      playWrong();
    }
  };

  const reset = () => {
    setSelected(null);
    setMatched([]);
    setMistakes(0);
  };

  const shake = SHAKE;
  const itemClass = (state: "idle" | "selected" | "matched" | "wrong") =>
    [
      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
      state === "matched"
        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
        : state === "selected"
          ? "border-accent-400 bg-accent-50 text-accent-700"
          : state === "wrong"
            ? "border-red-300 bg-red-50 text-red-600"
            : "border-stone-200 bg-card text-stone-700 hover:border-accent-300 hover:text-accent-700",
    ].join(" ");

  return (
    <div ref={cardRef} className="rounded-xl border border-stone-200 bg-card p-4">
      <p className="mb-1 text-sm font-medium text-stone-800">
        <span className="mr-1.5 rounded bg-accent-100 px-1.5 py-0.5 text-xs font-semibold text-accent-700">
          配对
        </span>
        {block.prompt}
      </p>
      <p className="mb-3 text-xs text-stone-400">点击左列一项，再点右列中与它对应的项</p>

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
                animate={state === "wrong" ? shake : SHAKE_IDLE}
                transition={SHAKE_TRANSITION}
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
                animate={state === "wrong" ? shake : SHAKE_IDLE}
                transition={SHAKE_TRANSITION}
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
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckDraw />
            全部配对成功{mistakes > 0 ? `（失误 ${mistakes} 次）` : "，一次通过！"}
          </p>
          <button type="button" onClick={reset} className="text-xs text-accent-600 hover:underline">
            重做
          </button>
        </motion.div>
      )}
    </div>
  );
}
