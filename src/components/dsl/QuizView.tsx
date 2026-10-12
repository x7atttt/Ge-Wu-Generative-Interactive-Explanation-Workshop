"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { QuizBlock } from "@/lib/dsl/schema";
import { playCorrect, playWrong } from "@/lib/audio/sound";
import { useAttempt } from "./attempt-context";
import { CheckDraw } from "./CheckDraw";
import { useFeedbackMotion } from "./motion-presets";

export function QuizView({ block }: { block: QuizBlock }) {
  const [selected, setSelected] = useState<number | null>(null);
  const attempt = useAttempt();
  const { pop, popIdle, popTransition, shake, shakeIdle, shakeTransition } =
    useFeedbackMotion();
  const answered = selected !== null;
  const isCorrect = answered && selected === block.answer;

  const choose = (i: number) => {
    setSelected(i);
    attempt?.report("quiz", i === block.answer);
    if (i === block.answer) playCorrect();
    else playWrong();
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="mb-3 text-sm font-medium text-zinc-800">
        <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-700">
          自测
        </span>
        {block.question}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {block.options.map((option, i) => {
          const correct = answered && i === block.answer;
          const wrong = answered && i === selected && i !== block.answer;
          return (
            <motion.button
              key={i}
              onClick={() => choose(i)}
              disabled={answered}
              animate={correct ? pop : wrong ? shake : { ...popIdle, ...shakeIdle }}
              transition={correct ? popTransition : shakeTransition}
              className={[
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                correct
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : wrong
                    ? "border-red-300 bg-red-50 text-red-600"
                    : answered
                      ? "border-zinc-200 bg-white text-zinc-400"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-indigo-300 hover:text-indigo-700",
              ].join(" ")}
            >
              {option}
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence>
        {answered && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <p
              className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${isCorrect ? "text-emerald-600" : "text-red-600"}`}
            >
              {isCorrect && <CheckDraw />}
              {isCorrect ? "回答正确！" : "再想想～"}
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">{block.explanation}</p>
            <button
              onClick={() => setSelected(null)}
              className="mt-2 text-xs text-indigo-600 hover:underline"
            >
              再试一次
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
