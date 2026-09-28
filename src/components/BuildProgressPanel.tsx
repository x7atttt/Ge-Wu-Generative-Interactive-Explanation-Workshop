"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSmoothStreamText } from "@/hooks/useSmoothStreamText";

const BLOCK_LABELS: Record<string, string> = {
  text: "讲解文字",
  formula: "公式",
  slider: "交互滑块",
  wavePlot: "波形演示",
  chart: "图表",
  quiz: "自测题",
};

/** 正则只匹配完整字面量，流式半截块（如 "type":"sl）不会误点亮 */
const BLOCK_RE = /"type"\s*:\s*"(text|formula|slider|wavePlot|chart|quiz)"/g;
const TITLE_RE = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/;

function parseProgress(text: string): { title: string | null; blocks: string[] } {
  const blocks: string[] = [];
  for (const match of text.matchAll(BLOCK_RE)) blocks.push(match[1]);
  const titleMatch = text.match(TITLE_RE);
  const title = titleMatch ? titleMatch[1] : null;
  return { title, blocks };
}

/**
 * 构建过程面板：状态行 + 实时块清单 + 折叠的原始构建流（内部 rAF 平滑显示）。
 * 骨架展示已移交文档区流式上屏（ExplainDocView skeletonTail）。
 */
export function BuildProgressPanel({
  raw,
  phase,
  onCancel,
}: {
  raw: string;
  phase: "generate" | "refine";
  onCancel: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const rawScrollRef = useRef<HTMLDivElement>(null);
  const { display, setTarget } = useSmoothStreamText();

  useEffect(() => {
    setTarget(raw);
  }, [raw, setTarget]);

  useEffect(() => {
    const el = rawScrollRef.current;
    if (el && showRaw) el.scrollTop = el.scrollHeight;
  }, [display, showRaw]);

  const { title, blocks } = parseProgress(raw);

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          {phase === "generate" ? "AI 正在构建讲解" : "AI 正在改造讲解"}
          {title && <span className="text-zinc-700">《{title}》</span>}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="text-xs text-zinc-400 transition-colors hover:text-red-500"
          >
            取消
          </button>
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {blocks.map((type, i) => {
            const isLast = i === blocks.length - 1;
            return (
              <span
                key={i}
                className={`flex items-center gap-1 text-xs ${
                  isLast ? "text-indigo-600" : "text-zinc-400"
                }`}
              >
                <span className={isLast ? "animate-pulse" : ""}>{isLast ? "✎" : "✓"}</span>
                {BLOCK_LABELS[type] ?? type}
                {isLast && "…"}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-2 text-center">
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="text-[11px] text-zinc-400 transition-colors hover:text-zinc-600"
        >
          {showRaw ? "收起原始构建流" : "查看原始构建流"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {showRaw && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div
              ref={rawScrollRef}
              className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-900 p-3 font-mono text-[11px] leading-5 text-emerald-300/90"
            >
              {display}
              <span className="ml-0.5 inline-block h-3 w-[6px] animate-pulse bg-emerald-300 align-middle" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
