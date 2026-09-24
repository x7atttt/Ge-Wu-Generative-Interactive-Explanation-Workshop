"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AskPanel } from "@/components/dsl/AskPanel";
import { ExplainDocView } from "@/components/dsl/ExplainDocView";
import { streamExplanation } from "@/lib/api/explanation";
import type { ExplainDoc } from "@/lib/dsl/schema";

const EXAMPLE_CONCEPTS = ["正弦波的频率", "傅里叶级数", "柱状图", "供需与价格"];
const REFINE_EXAMPLES = [
  "深入讲讲谐波次数的影响",
  "加一个现实中的类比例子",
  "出两道自测题",
  "加一个对比演示",
];

/** 构建流面板：AI 原始输出实时滚动，过程透明（流式呈现形态的所有者决策） */
function BuildStreamPanel({
  text,
  phase,
  onCancel,
}: {
  text: string;
  phase: "generate" | "refine";
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, open]);

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/80">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          {phase === "generate" ? "AI 正在构建讲解" : "AI 正在改造讲解"}
          <span className="text-zinc-400">· 原始构建流</span>
        </p>
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-xs text-zinc-400 transition-colors hover:text-red-500">
            取消
          </button>
          <button onClick={() => setOpen((v) => !v)} className="text-xs text-zinc-500 hover:text-zinc-800">
            {open ? "收起" : "展开"}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div
              ref={scrollRef}
              className="mx-3 mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-900 p-3 font-mono text-[11px] leading-5 text-emerald-300/90"
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

export default function Home() {
  const [concept, setConcept] = useState("");
  const [doc, setDoc] = useState<ExplainDoc | null>(null);
  const [docId, setDocId] = useState(0); // 文档身份：refine 后递增以重放进出场动画
  const [busy, setBusy] = useState<null | "generate" | "refine">(null);
  const [buildText, setBuildText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [refineInput, setRefineInput] = useState("");
  const [refineError, setRefineError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  function cancel() {
    abortRef.current?.abort();
  }

  async function handleGenerate() {
    const text = concept.trim();
    if (!text || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("generate");
    setError(null);
    setBuildText("");
    try {
      const next = await streamExplanation(
        "generate",
        { concept: text },
        {
          onDelta: (t) => setBuildText((prev) => prev + t),
          signal: controller.signal,
        }
      );
      setDoc(next);
      setDocId((id) => id + 1);
      setRefineInput("");
      setRefineError(null);
    } catch (err) {
      if (controller.signal.aborted) setError("已取消本次生成");
      else setError(err instanceof Error ? err.message : "生成失败，请稍后重试");
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function handleRefine() {
    const instruction = refineInput.trim();
    if (!instruction || !doc || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("refine");
    setRefineError(null);
    setBuildText("");
    try {
      const next = await streamExplanation(
        "refine",
        { doc, instruction },
        {
          onDelta: (t) => setBuildText((prev) => prev + t),
          signal: controller.signal,
        }
      );
      setDoc(next);
      setDocId((id) => id + 1);
      setRefineInput("");
    } catch (err) {
      if (controller.signal.aborted) setRefineError("已取消本次改造");
      else setRefineError(err instanceof Error ? err.message : "改造失败，请稍后重试");
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-gradient-to-b from-indigo-50/70 via-zinc-50 to-zinc-50 px-4 py-10 font-sans">
      <main className="w-full max-w-2xl">
        <header className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500 shadow-sm">
            <span className="font-medium text-zinc-700">格物</span> Gewu · 生成式交互讲解工坊
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            输入一个概念，
            <span className="bg-gradient-to-r from-indigo-600 to-violet-500 bg-clip-text text-transparent">
              玩着懂
            </span>
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            AI 现场生成带滑块与图表的交互讲解——拖动参数建立直觉，追问深入细节，一句话继续改造
          </p>
        </header>

        {/* 生成入口 */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex gap-2">
            <input
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="想搞懂什么概念？如：傅里叶级数、柱状图、供需与价格"
              maxLength={200}
              className="h-11 flex-1 rounded-xl border border-zinc-200 px-4 text-sm outline-none transition-colors focus:border-indigo-400"
              disabled={busy === "generate"}
            />
            <button
              onClick={handleGenerate}
              disabled={busy !== null || !concept.trim()}
              className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              生成讲解
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLE_CONCEPTS.map((example) => (
              <button
                key={example}
                onClick={() => setConcept(example)}
                disabled={busy === "generate"}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>

          {busy === "generate" && (
            <BuildStreamPanel text={buildText} phase="generate" onCancel={cancel} />
          )}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        {/* 讲解文档 */}
        <AnimatePresence mode="wait">
          {doc && (
            <motion.section
              key={docId}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: "spring", stiffness: 140, damping: 18 }}
              className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <ExplainDocView doc={doc} />

              {/* 内容级改造 */}
              <div className="mt-6 border-t border-zinc-100 pt-4">
                <p className="mb-2 text-xs font-medium tracking-wide text-zinc-400">
                  继续深化这篇讲解
                </p>
                <div className="flex flex-wrap gap-2">
                  {REFINE_EXAMPLES.map((example) => (
                    <button
                      key={example}
                      onClick={() => setRefineInput(example)}
                      disabled={busy === "refine"}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={refineInput}
                    onChange={(e) => setRefineInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRefine()}
                    placeholder="或直接输入你想要的深化方向"
                    maxLength={300}
                    className="h-10 flex-1 rounded-xl border border-zinc-200 px-3 text-sm outline-none transition-colors focus:border-indigo-400"
                    disabled={busy === "refine"}
                  />
                  <button
                    onClick={handleRefine}
                    disabled={busy !== null || !refineInput.trim()}
                    className="h-10 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === "refine" ? "改造中…" : "改造"}
                  </button>
                </div>
                {busy === "refine" && (
                  <BuildStreamPanel text={buildText} phase="refine" onCancel={cancel} />
                )}
                {refineError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    {refineError}
                  </p>
                )}
              </div>

              <AskPanel doc={doc} />
            </motion.section>
          )}
        </AnimatePresence>

        <footer className="mt-10 text-center text-xs text-zinc-400">
          格物 Gewu · 传智杯 AI 创新应用挑战赛（Vibe Coding）作品
        </footer>
      </main>
    </div>
  );
}
