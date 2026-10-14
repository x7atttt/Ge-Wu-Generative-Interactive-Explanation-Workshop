"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { SliderBlock } from "@/lib/dsl/schema";
import { useVars } from "./var-context";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 按 step 的数量级推显示/输入的小数位：step=1 → 0 位，0.1 → 1 位，0.01 → 2 位 */
function stepDecimals(step: number): number {
  return Math.max(0, Math.min(4, Math.ceil(-Math.log10(step + 1e-9))));
}

export function SliderControl({ block }: { block: SliderBlock }) {
  const { values, setValue } = useVars();
  // 动效原则：直接操作 1:1 跟手，拖动过程不加任何动画/过渡
  const current = clamp(values[block.var] ?? block.initial, block.min, block.max);
  const decimals = stepDecimals(block.step);
  // 编辑中的草稿：null = 未在编辑，显示实际值
  const [draft, setDraft] = useState<string | null>(null);

  /** 提交手输值：夹取到 [min,max] 并吸附到 step 网格；非法输入静默还原 */
  const commit = (raw: string) => {
    setDraft(null);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const snapped = clamp(
      block.min + Math.round((parsed - block.min) / block.step) * block.step,
      block.min,
      block.max
    );
    setValue(block.var, Number(snapped.toFixed(6)));
  };

  return (
    <motion.label
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="block rounded-xl border border-stone-200 px-4 py-3"
    >
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-stone-800">{block.label}</span>
        <input
          type="number"
          inputMode="decimal"
          min={block.min}
          max={block.max}
          step={block.step}
          value={draft ?? current.toFixed(decimals)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(null);
          }}
          aria-label={`${block.label} 数值`}
          className="w-16 rounded-md border border-transparent bg-transparent px-1 text-right font-mono text-stone-500 outline-none transition-colors [appearance:textfield] hover:border-stone-200 focus:border-accent-400 focus:text-stone-800 focus:bg-card [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </span>
      <input
        type="range"
        min={block.min}
        max={block.max}
        step={block.step}
        value={current}
        onChange={(e) => setValue(block.var, e.target.valueAsNumber)}
        className="h-1.5 w-full cursor-pointer accent-accent-600"
        aria-label={block.label}
      />
    </motion.label>
  );
}
