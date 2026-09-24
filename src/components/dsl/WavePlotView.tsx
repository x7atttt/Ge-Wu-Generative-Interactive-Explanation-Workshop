"use client";

import { useMemo } from "react";
import katex from "katex";
import { Coordinates, Mafs, Plot } from "mafs";
import type { WavePlotBlock, WaveTerm } from "@/lib/dsl/schema";
import { resolveSlot, useVars } from "./var-context";

const FN: Record<WaveTerm["fn"], (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
};

/** 由 terms 与当前变量值拼出实时公式（拖滑块 → 数字同步变化，纯渲染层实现） */
function liveLatex(block: WavePlotBlock, values: Record<string, number>): string {
  const fmt = (n: number) => n.toFixed(2);
  const body = block.terms
    .map((term) => {
      const amp = resolveSlot(term.amp, values);
      const freq = resolveSlot(term.freq, values);
      const phase = resolveSlot(term.phase, values);
      return `${fmt(amp)}\\${term.fn}\\left(2\\pi \\cdot ${fmt(freq)}\\,x + ${fmt(phase)}\\right)`;
    })
    .join(" + ");
  return `y = ${body}`;
}

export function WavePlotView({ block }: { block: WavePlotBlock }) {
  const { values } = useVars();

  const y = (x: number) =>
    block.terms.reduce(
      (sum, term) =>
        sum +
        resolveSlot(term.amp, values) *
          FN[term.fn](
            2 * Math.PI * resolveSlot(term.freq, values) * x + resolveSlot(term.phase, values)
          ),
      0
    );

  const formulaHtml = useMemo(
    () => {
      try {
        return katex.renderToString(liveLatex(block, values), {
          displayMode: false,
          throwOnError: false,
        });
      } catch {
        return null;
      }
    },
    // values 每次拖动都变化，公式必须逐帧重渲（KaTeX 短公式开销可忽略）
    [block, values]
  );

  // y 域固定：MVP 波形演示的振幅量级 ≤ 3，超出部分裁剪（schema 决策，见 spec）
  return (
    <figure className="rounded-xl border border-zinc-200 p-2">
      {formulaHtml ? (
        <div
          className="overflow-x-auto px-2 pb-1 pt-1 text-center text-sm"
          dangerouslySetInnerHTML={{ __html: formulaHtml }}
        />
      ) : null}
      <Mafs height={240} viewBox={{ x: [-1, 4], y: [-3.2, 3.2] }} preserveAspectRatio={false}>
        <Coordinates.Cartesian />
        <Plot.OfX y={y} />
      </Mafs>
      {block.title ? (
        <figcaption className="px-2 pb-1 pt-0.5 text-center text-xs text-zinc-500">
          {block.title}
          {block.xLabel
            ? `（横轴：${block.xLabel}${block.yLabel ? `，纵轴：${block.yLabel}` : ""}）`
            : ""}
        </figcaption>
      ) : null}
    </figure>
  );
}
