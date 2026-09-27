"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BuildProgressPanel } from "@/components/BuildProgressPanel";
import { AskPanel, type AskItem } from "@/components/dsl/AskPanel";
import { ExplainDocView } from "@/components/dsl/ExplainDocView";
import { listDocs, loadDoc, streamExplanation, type DocSummary } from "@/lib/api/explanation";
import type { ExplainDoc } from "@/lib/dsl/schema";

const EXAMPLE_CONCEPTS = ["正弦波的频率", "傅里叶级数", "柱状图", "供需与价格"];
const REFINE_EXAMPLES = [
  "深入讲讲谐波次数的影响",
  "加一个现实中的类比例子",
  "出两道自测题",
  "加一个对比演示",
];

export default function Home() {
  const [concept, setConcept] = useState("");
  const [doc, setDoc] = useState<ExplainDoc | null>(null);
  const [docId, setDocId] = useState<number | null>(null);
  const [restoredAsks, setRestoredAsks] = useState<AskItem[]>([]);
  const [busy, setBusy] = useState<null | "generate" | "refine">(null);
  const [buildText, setBuildText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [refineInput, setRefineInput] = useState("");
  const [refineError, setRefineError] = useState<string | null>(null);

  const [docList, setDocList] = useState<DocSummary[]>([]);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listDocs().then(setDocList).catch(() => {});
  }, []);

  function refreshDocList() {
    listDocs().then(setDocList).catch(() => {});
  }

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
      const { doc: next, docId: id } = await streamExplanation(
        "generate",
        { concept: text },
        {
          onDelta: (t) => setBuildText((prev) => prev + t),
          signal: controller.signal,
        }
      );
      setDoc(next);
      setDocId(id);
      setRestoredAsks([]);
      setRefineInput("");
      setRefineError(null);
      refreshDocList();
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
      const { doc: next, docId: id } = await streamExplanation(
        "refine",
        { doc, instruction, docId },
        {
          onDelta: (t) => setBuildText((prev) => prev + t),
          signal: controller.signal,
        }
      );
      setDoc(next);
      setDocId(id);
      setRestoredAsks([]);
      setRefineInput("");
      refreshDocList();
    } catch (err) {
      if (controller.signal.aborted) setRefineError("已取消本次改造");
      else setRefineError(err instanceof Error ? err.message : "改造失败，请稍后重试");
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function handleLoadDoc(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = Number(event.target.value);
    if (!Number.isInteger(id) || id <= 0 || loadingDoc) return;
    setLoadingDoc(true);
    setError(null);
    try {
      const { doc: loaded, asks } = await loadDoc(id);
      setDoc(loaded);
      setDocId(id);
      setRestoredAsks(asks);
      setRefineError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复讲解失败");
    } finally {
      setLoadingDoc(false);
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

        {docList.length > 0 && (
          <div className="mb-4 flex items-center justify-center gap-2 text-xs text-zinc-500">
            <span>最近讲解</span>
            <select
              value={docId ?? ""}
              onChange={handleLoadDoc}
              disabled={loadingDoc || busy !== null}
              className="max-w-[280px] rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-indigo-400 disabled:opacity-50"
            >
              <option value="" disabled>
                选择要恢复的讲解…
              </option>
              {docList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}（#{item.id}）
                </option>
              ))}
            </select>
            {loadingDoc && <span className="text-zinc-400">恢复中…</span>}
          </div>
        )}

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
            <BuildProgressPanel text={buildText} phase="generate" onCancel={cancel} />
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
          {doc && docId !== null && (
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
                  <BuildProgressPanel text={buildText} phase="refine" onCancel={cancel} />
                )}
                {refineError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    {refineError}
                  </p>
                )}
              </div>

              <AskPanel docId={docId} initialAsks={restoredAsks} />
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
