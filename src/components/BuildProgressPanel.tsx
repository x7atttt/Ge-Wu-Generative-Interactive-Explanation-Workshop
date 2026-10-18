"use client";

import { useEffect, useState } from "react";
import type { GenerationStage } from "@/lib/generation-progress";

const STAGES = [
  { key: "prepare", label: "准备资料" },
  { key: "build", label: "构建内容" },
  { key: "verify", label: "内容校验" },
] as const;

const STATUS: Record<GenerationStage, string> = {
  prepare: "正在准备讲解依据",
  build: "正在构建讲解",
  verify: "正在检查讲解内容",
  repair: "正在调整讲解内容",
};

/** 总量未知时只展示活动线；阶段由服务端确认，正文区负责逐段显示真实内容。 */
export function BuildProgressPanel({ raw, phase, stage, note, onCancel }: {
  raw: string;
  phase: "generate" | "refine";
  stage: GenerationStage;
  note?: string | null;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const index = stage === "repair" ? 2 : STAGES.findIndex((item) => item.key === stage);
  const title = raw.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const count = [...raw.matchAll(/"type"\s*:\s*"(heading|text|formula|slider|wavePlot|chart|fillBlank|match|sort|quiz)"/g)].length;
  const helper = stage === "prepare" ? "整理参考资料后开始生成。"
    : stage === "verify" ? "检查公式、交互和练习，完成后即可使用。"
    : stage === "repair" ? "正在调整内容与练习，请稍候。"
    : raw.length > 0 ? "已接收的讲解会在下方逐段显示。" : "正在等待第一段内容，收到后会逐步展开。";

  return <section aria-label={phase === "generate" ? "讲解生成进度" : "讲解改造进度"} className="mt-4 border-t border-stone-200 pt-4">
    <div className="flex items-center justify-between gap-3">
      <p role="status" className="flex min-w-0 items-center gap-2 text-sm font-medium text-stone-800">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-accent-600"><path d="m10 2 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
        {phase === "refine" && stage === "build" ? "正在改造讲解" : STATUS[stage]}
      </p>
      <button type="button" onClick={onCancel} className="min-h-9 shrink-0 rounded-lg px-2 text-xs text-stone-600 hover:bg-stone-100 hover:text-red-700">{phase === "generate" ? "取消生成" : "取消改造"}</button>
    </div>
    <ol aria-label="生成阶段" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {STAGES.map((item, i) => <li key={item.key} aria-current={i === index ? "step" : undefined} className={`flex items-center gap-2 ${i === index ? "font-medium text-accent-700" : i < index ? "text-secondary-600" : "text-stone-500"}`}>
        {i > 0 && <span aria-hidden="true" className="text-stone-400">›</span>}
        {i < index ? "✓ " : ""}{i === index && stage === "repair" ? "调整内容" : item.label}
      </li>)}
    </ol>
    <div role="progressbar" aria-label="正在处理讲解，完成时间暂不确定" data-stage={stage} className="relative my-3 h-1 overflow-hidden rounded-full bg-stone-200">
      <span className="generation-activity absolute h-full w-1/4 rounded-full bg-accent-500" />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500"><p>{note || helper}</p><p className="tabular-nums">已用时 {elapsed}s</p></div>
    <details className="mt-3 text-xs text-stone-500">
      <summary className="w-fit cursor-pointer rounded py-1 hover:text-stone-700">{phase === "generate" ? "生成详情" : "改造详情"}</summary>
      <p className="my-2 break-words">{title && `《${title}》 · `}已接收 {count} 个内容片段 · {raw.length.toLocaleString()} 字符</p>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-stone-100 p-3 font-mono text-xs leading-5 text-stone-600">{raw || "等待内容返回…"}</pre>
    </details>
  </section>;
}
