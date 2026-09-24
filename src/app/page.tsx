"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExplainDocView } from "@/components/dsl/ExplainDocView";
import { generateExplanation, refineExplanation } from "@/lib/api/explanation";
import type { ExplainDoc } from "@/lib/dsl/schema";

const EXAMPLE_CONCEPTS = ["正弦波的频率", "傅里叶级数", "波的叠加与拍频"];
const REFINE_PLACEHOLDER = '试试：把振幅固定为 2';

export default function Home() {
  const [concept, setConcept] = useState("");
  const [doc, setDoc] = useState<ExplainDoc | null>(null);
  const [docId, setDocId] = useState(0); // 文档身份：refine 后递增以重放进出场动画
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [refineInput, setRefineInput] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  async function handleGenerate() {
    const text = concept.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await generateExplanation(text);
      setDoc(next);
      setDocId((id) => id + 1);
      setRefineInput("");
      setRefineError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefine() {
    const instruction = refineInput.trim();
    if (!instruction || !doc || refining) return;
    setRefining(true);
    setRefineError(null);
    try {
      const next = await refineExplanation(doc, instruction);
      setDoc(next);
      setDocId((id) => id + 1);
      setRefineInput("");
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : "改造失败，请稍后重试");
    } finally {
      setRefining(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10 font-sans">
      <main className="w-full max-w-2xl">
        <header className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500">
            <span className="font-medium text-zinc-700">格物</span> Gewu · 生成式交互讲解工坊
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            输入一个概念，玩着懂
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            AI 现场生成带滑块的交互式讲解，拖动参数建立直觉，再用一句话改造它
          </p>
        </header>

        {/* 生成入口 */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex gap-2">
            <input
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="想搞懂什么？如：正弦波的频率"
              maxLength={200}
              className="h-11 flex-1 rounded-xl border border-zinc-200 px-4 text-sm outline-none transition-colors focus:border-indigo-400"
              disabled={loading}
            />
            <button
              onClick={handleGenerate}
              disabled={loading || !concept.trim()}
              className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "生成中…" : "生成讲解"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLE_CONCEPTS.map((example) => (
              <button
                key={example}
                onClick={() => setConcept(example)}
                disabled={loading}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <p className="flex items-center gap-2 pt-3 text-xs text-zinc-500">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                  AI 正在设计交互讲解（约 10–30 秒）…
                </p>
              </motion.div>
            )}
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

              {/* 对话式改造 */}
              <div className="mt-6 border-t border-zinc-100 pt-4">
                <div className="flex gap-2">
                  <input
                    value={refineInput}
                    onChange={(e) => setRefineInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRefine()}
                    placeholder={REFINE_PLACEHOLDER}
                    maxLength={300}
                    className="h-10 flex-1 rounded-xl border border-zinc-200 px-3 text-sm outline-none transition-colors focus:border-indigo-400"
                    disabled={refining}
                  />
                  <button
                    onClick={handleRefine}
                    disabled={refining || !refineInput.trim()}
                    className="h-10 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {refining ? "改造中…" : "改造"}
                  </button>
                </div>
                {refineError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    {refineError}
                  </p>
                )}
              </div>
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
