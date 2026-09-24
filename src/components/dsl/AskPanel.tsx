"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { streamAsk } from "@/lib/api/explanation";
import type { ExplainDoc } from "@/lib/dsl/schema";

interface AskItem {
  question: string;
  answer: string;
  done: boolean;
}

/** 文档内追问面板：会话态只存前端，不进 DSL（迭代 2 spec 决策） */
export function AskPanel({ doc }: { doc: ExplainDoc }) {
  const [asks, setAsks] = useState<AskItem[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    const question = input.trim();
    if (!question || asking) return;
    setAsking(true);
    setError(null);
    setAsks((prev) => [...prev, { question, answer: "", done: false }]);
    setInput("");
    const index = asks.length;
    try {
      await streamAsk(doc, question, {
        onDelta: (text) =>
          setAsks((prev) =>
            prev.map((item, i) => (i === index ? { ...item, answer: item.answer + text } : item))
          ),
      });
      setAsks((prev) => prev.map((item, i) => (i === index ? { ...item, done: true } : item)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "回答失败，请稍后重试";
      setAsks((prev) => prev.filter((_, i) => i !== index || prev[i].answer));
      setError(message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mt-6 border-t border-zinc-100 pt-4">
      <p className="mb-2 text-xs font-medium tracking-wide text-zinc-400">追问这个讲解</p>
      {asks.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {asks.map((item, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="self-end rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
                {item.question}
              </div>
              {item.answer ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="self-start rounded-2xl rounded-bl-sm bg-zinc-100 px-3.5 py-2 text-sm leading-6 text-zinc-800"
                >
                  <span className="whitespace-pre-wrap">{item.answer}</span>
                  {!item.done && (
                    <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-zinc-500 align-middle" />
                  )}
                </motion.div>
              ) : (
                <div className="self-start text-xs text-zinc-400">思考中…</div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          placeholder="如：为什么振幅按 1/n 衰减？"
          maxLength={300}
          className="h-10 flex-1 rounded-xl border border-zinc-200 px-3 text-sm outline-none transition-colors focus:border-indigo-400"
          disabled={asking}
        />
        <button
          onClick={handleAsk}
          disabled={asking || !input.trim()}
          className="h-10 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {asking ? "回答中…" : "追问"}
        </button>
      </div>
    </div>
  );
}
