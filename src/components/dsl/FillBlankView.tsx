"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { FillBlankBlock } from "@/lib/dsl/schema";
import { playComplete, playWrong } from "@/lib/audio/sound";
import { celebrateAt } from "@/lib/celebrate";
import { useAttempt } from "./attempt-context";
import { CheckDraw } from "./CheckDraw";
import { useFeedbackMotion } from "./motion-presets";

/**
 * 完形填空：句中空位为行内 chip，下方按空位列选项；全部选完才可检查，
 * 逐空判分并只对错空给出正确答案与解析（生成式回忆：先选后判）。
 */
export function FillBlankView({ block }: { block: FillBlankBlock }) {
  const [choices, setChoices] = useState<(number | null)[]>(() => block.blanks.map(() => null));
  const [checked, setChecked] = useState(false);
  const attempt = useAttempt();
  const cardRef = useRef<HTMLDivElement>(null);
  const { shake, shakeIdle, shakeTransition } = useFeedbackMotion();

  const parts = block.text.split("___");
  const allFilled = choices.every((c) => c !== null);
  const correctCount = choices.reduce<number>(
    (acc, c, i) => acc + (c === block.blanks[i].answer ? 1 : 0),
    0
  );
  const allCorrect = correctCount === block.blanks.length;

  const check = () => {
    setChecked(true);
    attempt?.report("fillBlank", allCorrect);
    if (allCorrect) {
      playComplete();
      void celebrateAt(cardRef.current);
    } else {
      playWrong();
    }
  };

  const pick = (blank: number, option: number) => {
    if (checked) return;
    setChoices((prev) => prev.map((c, i) => (i === blank ? option : c)));
  };

  const reset = () => {
    setChoices(block.blanks.map(() => null));
    setChecked(false);
  };

  return (
    <div ref={cardRef} className="rounded-xl border border-stone-200 bg-card p-4">
      <p className="mb-3 text-sm font-medium text-stone-800">
        <span className="mr-1.5 rounded bg-accent-100 px-1.5 py-0.5 text-xs font-semibold text-accent-700">
          填空
        </span>
        {block.prompt ?? "选词完成下面的句子"}
      </p>

      <p className="text-[15px] leading-8 text-stone-800">
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < block.blanks.length && (
              <BlankChip
                label={choices[i] !== null ? block.blanks[i].options[choices[i] as number] : null}
                index={i}
                state={
                  checked
                    ? choices[i] === block.blanks[i].answer
                      ? "correct"
                      : "wrong"
                    : choices[i] !== null
                      ? "picked"
                      : "empty"
                }
                shake={shake}
                shakeIdle={shakeIdle}
                shakeTransition={shakeTransition}
              />
            )}
          </span>
        ))}
      </p>

      {!checked && (
        <div className="mt-4 flex flex-col gap-2.5">
          {block.blanks.map((blank, bi) => (
            <div key={bi} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-stone-400">空{bi + 1}</span>
              {blank.options.map((option, oi) => (
                <button
                  key={oi}
                  type="button"
                  onClick={() => pick(bi, oi)}
                  className={[
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    choices[bi] === oi
                      ? "border-accent-400 bg-accent-50 text-accent-700"
                      : "border-stone-200 bg-card text-stone-600 hover:border-accent-300 hover:text-accent-700",
                  ].join(" ")}
                >
                  {option}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        {!checked ? (
          <button
            type="button"
            disabled={!allFilled}
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
              {allCorrect ? "全部正确！" : `${correctCount}/${block.blanks.length} 正确`}
            </p>
            {block.blanks.map((blank, bi) =>
              choices[bi] === blank.answer ? null : (
                <p key={bi} className="mt-1.5 text-sm leading-6 text-stone-600">
                  空{bi + 1}：正确答案{" "}
                  <span className="font-medium text-stone-800">{blank.options[blank.answer]}</span>
                  {blank.explanation ? ` —— ${blank.explanation}` : ""}
                </p>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BlankChip({
  label,
  index,
  state,
  shake,
  shakeIdle,
  shakeTransition,
}: {
  label: string | null;
  index: number;
  state: "empty" | "picked" | "correct" | "wrong";
  shake: { x: number[] } | { x: number };
  shakeIdle: { x: number };
  shakeTransition: { duration: number };
}) {
  return (
    <motion.span
      animate={state === "wrong" ? shake : shakeIdle}
      transition={shakeTransition}
      className={[
        "mx-1 inline-flex min-w-14 items-center justify-center rounded-md border px-2 py-0.5 align-middle text-sm font-medium",
        state === "correct"
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : state === "wrong"
            ? "border-red-300 bg-red-50 text-red-600"
            : state === "picked"
              ? "border-accent-300 bg-accent-50 text-accent-700"
              : "border-dashed border-stone-300 bg-stone-50 text-stone-400",
      ].join(" ")}
    >
      {label ?? `空${index + 1}`}
    </motion.span>
  );
}
