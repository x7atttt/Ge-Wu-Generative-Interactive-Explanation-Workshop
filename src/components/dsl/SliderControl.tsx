"use client";

import { motion } from "motion/react";
import type { SliderBlock } from "@/lib/dsl/schema";
import { useVars } from "./var-context";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function SliderControl({ block }: { block: SliderBlock }) {
  const { values, setValue } = useVars();
  // 动效原则：直接操作 1:1 跟手，拖动过程不加任何动画/过渡
  const current = clamp(values[block.var] ?? block.initial, block.min, block.max);

  return (
    <motion.label
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="block rounded-xl border border-zinc-200 px-4 py-3"
    >
      <span className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-medium text-zinc-800">{block.label}</span>
        <span className="font-mono text-zinc-500">{current.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={block.min}
        max={block.max}
        step={block.step}
        value={current}
        onChange={(e) => setValue(block.var, e.target.valueAsNumber)}
        className="h-1.5 w-full cursor-pointer accent-indigo-600"
        aria-label={block.label}
      />
    </motion.label>
  );
}
