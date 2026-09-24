"use client";

import { Coordinates, Mafs, Plot } from "mafs";
import type { WavePlotBlock, WaveTerm } from "@/lib/dsl/schema";
import { resolveSlot, useVars } from "./var-context";

const FN: Record<WaveTerm["fn"], (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
};

export function WavePlotView({ block }: { block: WavePlotBlock }) {
  const { values } = useVars();

  const y = (x: number) =>
    block.terms.reduce(
      (sum, term) =>
        sum +
        resolveSlot(term.amp, values) *
          FN[term.fn](2 * Math.PI * resolveSlot(term.freq, values) * x + resolveSlot(term.phase, values)),
      0
    );

  // y 域固定：MVP 波形演示的振幅量级 ≤ 3，超出部分裁剪（schema 决策，见 spec）
  return (
    <figure className="rounded-xl border border-zinc-200 p-2">
      <Mafs
        height={240}
        viewBox={{ x: [-1, 4], y: [-3.2, 3.2] }}
        preserveAspectRatio={false}
      >
        <Coordinates.Cartesian />
        <Plot.OfX y={y} />
      </Mafs>
      {block.title ? (
        <figcaption className="px-2 pb-1 pt-0.5 text-center text-xs text-zinc-500">
          {block.title}
          {block.xLabel ? `（横轴：${block.xLabel}${block.yLabel ? `，纵轴：${block.yLabel}` : ""}）` : ""}
        </figcaption>
      ) : null}
    </figure>
  );
}
