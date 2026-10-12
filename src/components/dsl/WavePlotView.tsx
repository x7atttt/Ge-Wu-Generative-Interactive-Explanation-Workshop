"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import { Coordinates, Mafs, Plot } from "mafs";
import type { WavePlotBlock, WaveTerm } from "@/lib/dsl/schema";
import { isSoundOn, onSoundChange } from "@/lib/audio/sound";
import { Sonifier, type Voice } from "@/lib/audio/sonify";
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

/**
 * 可听化声部：频率映射到 110~880 Hz 的舒适听域（学习滑块的 0.1~5 量级直接出声
 * 过低/超声），振幅按最大值归一化。多 terms = 和弦，谐波叠加可听音色。
 */
function voicesOf(block: WavePlotBlock, values: Record<string, number>): Voice[] {
  const amps = block.terms.map((t) => Math.abs(resolveSlot(t.amp, values)));
  const maxAmp = Math.max(...amps, 0.001);
  return block.terms.map((term, i) => ({
    freq: 110 * Math.pow(2, resolveSlot(term.freq, values) * 1.5),
    gain: (amps[i] / maxAmp) * 0.8 + 0.2,
  }));
}

export function WavePlotView({ block }: { block: WavePlotBlock }) {
  const { values } = useVars();
  const [audible, setAudible] = useState(false);
  const sonifierRef = useRef<Sonifier | null>(null);

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

  // 可听化开启期间，滑块变化 → 声部平滑跟随；卸载/关闭即停
  useEffect(() => {
    if (audible && sonifierRef.current) {
      sonifierRef.current.update(voicesOf(block, values));
    }
  }, [audible, block, values]);

  useEffect(() => {
    return () => sonifierRef.current?.stop();
  }, []);

  // 全局静音时掐断持续音并复位按钮状态
  useEffect(() => {
    return onSoundChange((on) => {
      if (!on) {
        sonifierRef.current?.stop();
        sonifierRef.current = null;
        setAudible(false);
      }
    });
  }, []);

  const toggleAudible = () => {
    if (audible) {
      sonifierRef.current?.stop();
      sonifierRef.current = null;
      setAudible(false);
      return;
    }
    if (!isSoundOn()) return; // 全局静音时不启动
    const sonifier = new Sonifier();
    if (sonifier.start(voicesOf(block, values))) {
      sonifierRef.current = sonifier;
      setAudible(true);
    }
  };

  // y 域固定：MVP 波形演示的振幅量级 ≤ 3，超出部分裁剪（schema 决策，见 spec）
  return (
    <figure className="relative rounded-xl border border-zinc-200 p-2">
      <button
        type="button"
        onClick={toggleAudible}
        aria-pressed={audible}
        title={audible ? "停止听音" : "听一听：音高随频率滑块变化"}
        className={`absolute right-2 top-2 z-10 rounded-full border px-2 py-1 text-[11px] leading-none shadow-sm backdrop-blur transition-colors ${
          audible
            ? "border-indigo-300 bg-indigo-50 text-indigo-600"
            : "border-zinc-200 bg-white/90 text-zinc-500 hover:border-indigo-300 hover:text-indigo-600"
        }`}
      >
        {audible ? "🔊 听音中" : "🔊 听一听"}
      </button>
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
