"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSmoothStreamText } from "@/hooks/useSmoothStreamText";

const BLOCK_LABELS: Record<string, string> = {
  heading: "小节标题",
  text: "讲解文字",
  formula: "公式",
  slider: "交互滑块",
  wavePlot: "波形演示",
  chart: "图表",
  fillBlank: "填空练习",
  match: "配对练习",
  sort: "分类练习",
  quiz: "自测题",
};

/** 轨道分段的四类着色（文字/公式/可视化/练习），与纸墨朱砂令牌一致 */
const SEGMENT_CLASS: Record<string, string> = {
  text: "bg-stone-400",
  heading: "bg-stone-300",
  formula: "bg-accent-400",
  slider: "bg-secondary-400",
  wavePlot: "bg-secondary-400",
  chart: "bg-secondary-400",
  fillBlank: "bg-emerald-500",
  match: "bg-emerald-500",
  sort: "bg-emerald-500",
  quiz: "bg-emerald-500",
};

const LEGEND: { dot: string; label: string }[] = [
  { dot: "bg-stone-400", label: "文字" },
  { dot: "bg-accent-400", label: "公式" },
  { dot: "bg-secondary-400", label: "可视化" },
  { dot: "bg-emerald-500", label: "练习" },
];

/** 正则只匹配完整字面量，流式半截块（如 "type":"sl）不会误点亮 */
const BLOCK_RE =
  /"type"\s*:\s*"(heading|text|formula|slider|wavePlot|chart|fillBlank|match|sort|quiz)"/g;
const TITLE_RE = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/;

function parseProgress(text: string): { title: string | null; blocks: string[] } {
  const blocks: string[] = [];
  for (const match of text.matchAll(BLOCK_RE)) blocks.push(match[1]);
  const titleMatch = text.match(TITLE_RE);
  const title = titleMatch ? titleMatch[1] : null;
  return { title, blocks };
}

type Stage = "prep" | "build" | "verify";

const STAGES: { key: Stage; label: string }[] = [
  { key: "prep", label: "准备资料" },
  { key: "build", label: "构建内容" },
  { key: "verify", label: "收尾校验" },
];

/** 无分母渐进：p = chars/(chars+K) 封顶 92%；校验段抬到 96%（不虚构总量，业界惯例） */
function progressOf(chars: number, stage: Stage): number {
  if (stage === "verify") return 0.96;
  return Math.min(0.92, chars / (chars + 1500));
}

/**
 * 构建过程面板：阶段步进（准备→构建→校验）+ 渐近进度条 + 实时计数 + 块着色轨道。
 * "校验"段来自真实空窗——流已停止但 done 未到，正是解析/自修复期；
 * 骨架展示已移交文档区流式上屏（ExplainDocView skeletonTail）。
 */
export function BuildProgressPanel({
  raw,
  phase,
  note,
  onCancel,
}: {
  raw: string;
  phase: "generate" | "refine";
  /** 阶段提示（如"已检索 N 条网络资料"），生成前的准备阶段 */
  note?: string | null;
  onCancel: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const rawScrollRef = useRef<HTMLDivElement>(null);
  const { display, setTarget } = useSmoothStreamText();
  const [stage, setStage] = useState<Stage>("prep");
  const [elapsed, setElapsed] = useState(0);
  const lastGrowRef = useRef<{ len: number; at: number }>({ len: 0, at: Date.now() });

  useEffect(() => {
    setTarget(raw);
  }, [raw, setTarget]);

  useEffect(() => {
    const el = rawScrollRef.current;
    if (el && showRaw) el.scrollTop = el.scrollHeight;
  }, [display, showRaw]);

  // 已用时：挂载起每秒走字
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // 阶段推进：首 delta 进入构建；raw 停止增长 1.2s 判定进入校验（解析/自修复空窗）
  useEffect(() => {
    if (raw.length > 0) {
      if (raw.length !== lastGrowRef.current.len) {
        lastGrowRef.current = { len: raw.length, at: Date.now() };
        setStage("build");
      }
    }
  }, [raw]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (stage === "build" && Date.now() - lastGrowRef.current.at > 1200) {
        setStage("verify");
      }
    }, 500);
    return () => clearInterval(timer);
  }, [stage]);

  const { title, blocks } = parseProgress(raw);
  const progress = progressOf(raw.length, stage);
  const charsLabel = raw.length >= 1000 ? `${(raw.length / 1000).toFixed(1)}k` : String(raw.length);
  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/80 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs text-stone-500">
          {stage !== "verify" && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
          )}
          {phase === "generate" ? "AI 正在构建讲解" : "AI 正在改造讲解"}
          {title && <span className="text-stone-700">《{title}》</span>}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="text-xs text-stone-400 transition-colors hover:text-red-500"
          >
            取消
          </button>
        </div>
      </div>

      {/* 阶段步进：准备资料 → 构建内容 → 收尾校验 */}
      <div className="mt-2 flex items-center gap-1.5">
        {STAGES.map((s, i) => {
          const done = i < stageIndex;
          const active = i === stageIndex;
          return (
            <span key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="h-px w-4 bg-stone-300" />}
              <span
                className={`flex items-center gap-1 text-xs ${
                  active ? "font-medium text-accent-600" : done ? "text-stone-400" : "text-stone-300"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] ${
                    active
                      ? "border-accent-500 text-accent-600"
                      : done
                        ? "border-stone-300 bg-stone-300 text-white"
                        : "border-stone-300"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                {s.label}
                {active && <span className="ml-0.5 inline-block h-1 w-1 animate-pulse rounded-full bg-accent-500" />}
              </span>
            </span>
          );
        })}
      </div>

      {note && <p className="mt-1.5 text-xs text-stone-400">🌐 {note}</p>}

      {/* 渐近进度条 + 实时计数 */}
      <div className="mt-2.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-stone-200/80">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent-600 to-accent-400"
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-stone-400">
          <span>
            第 {Math.max(1, blocks.length)} 块 · 已输出 {charsLabel} 字 · 已用时 {elapsed}s
          </span>
          <span className="font-mono">{Math.round(progress * 100)}%</span>
        </div>
      </div>

      {/* 块着色轨道：每块一段，末段构建中 */}
      {blocks.length > 0 && (
        <div className="mt-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {blocks.map((type, i) => {
              const isLast = i === blocks.length - 1;
              return (
                <span
                  key={i}
                  title={BLOCK_LABELS[type] ?? type}
                  className={`h-1.5 w-3.5 rounded-sm ${SEGMENT_CLASS[type] ?? "bg-stone-300"} ${
                    isLast ? "animate-pulse ring-1 ring-accent-500" : ""
                  }`}
                />
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-stone-400">
            {LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${l.dot}`} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 text-center">
        <button
          onClick={() => setShowRaw((v) => !v)}
          className="text-[11px] text-stone-400 transition-colors hover:text-stone-600"
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
              className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-stone-900 p-3 font-mono text-[11px] leading-5 text-emerald-300/90"
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
