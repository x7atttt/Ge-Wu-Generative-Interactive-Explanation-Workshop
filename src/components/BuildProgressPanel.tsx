"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

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

/** 各块类型的骨架卡片形状（shimmer 占位，给"被搭建"的视觉叙事） */
function BlockSkeleton({ type }: { type: string }) {
  const base = "animate-pulse rounded-lg bg-zinc-200/80";
  if (type === "text")
    return (
      <div className="space-y-2 py-1">
        <div className={`${base} h-3 w-full`} />
        <div className={`${base} h-3 w-11/12`} />
        <div className={`${base} h-3 w-2/3`} />
      </div>
    );
  if (type === "formula") return <div className={`${base} mx-auto h-12 w-1/2`} />;
  if (type === "slider")
    return (
      <div className="py-1">
        <div className={`${base} mb-2 h-2.5 w-24`} />
        <div className={`${base} h-1.5 w-full`} />
      </div>
    );
  if (type === "quiz")
    return (
      <div className="grid grid-cols-2 gap-2 py-1">
        <div className={`${base} h-8 w-full`} />
        <div className={`${base} h-8 w-full`} />
      </div>
    );
  return <div className={`${base} h-40 w-full`} />; // wavePlot / chart
}

export function BuildProgressPanel({
  text,
  phase,
  onCancel,
}: {
  text: string;
  phase: "generate" | "refine";
  onCancel: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const rawScrollRef = useRef<HTMLDivElement>(null);

  const { title, blocks } = useMemo(() => parseProgress(text), [text]);

  useEffect(() => {
    const el = rawScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, showRaw]);

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
                <span className={isLast ? "animate-pulse" : ""}>
                  {isLast ? "✎" : "✓"}
                </span>
                {BLOCK_LABELS[type] ?? type}
                {isLast && "…"}
              </span>
            );
          })}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg bg-white p-3 shadow-inner">
          {blocks.map((type, i) => {
            const isLast = i === blocks.length - 1;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: isLast ? 0.6 : 1, y: 0 }}
              >
                <BlockSkeleton type={type} />
              </motion.div>
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
              {text}
              <span className="ml-0.5 inline-block h-3 w-[6px] animate-pulse bg-emerald-300 align-middle" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
