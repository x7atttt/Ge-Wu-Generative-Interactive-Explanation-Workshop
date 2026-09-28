"use client";

import { memo, useEffect, useState } from "react";
import { motion } from "motion/react";
import { streamAsk } from "@/lib/api/explanation";
import { useAskAutoScroll } from "@/hooks/useAskAutoScroll";
import { useSmoothStreamText } from "@/hooks/useSmoothStreamText";
import { MarkdownView } from "./MarkdownView";

export interface AskItem {
  question: string;
  answer: string;
  done: boolean;
}

/** 单条问答气泡：memo 隔离——只有流式中的活动气泡拿新 props，历史气泡不重解析 markdown */
const AskBubble = memo(function AskBubble({ item, active }: { item: AskItem; active: boolean }) {
  const { display, setTarget } = useSmoothStreamText();

  useEffect(() => {
    if (active) setTarget(item.answer);
  }, [active, item.answer, setTarget]);

  const shown = active ? display : item.answer;

  return (
    <div className="flex flex-col gap-2">
      <div className="self-end rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
        {item.question}
      </div>
      {shown ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="self-start rounded-2xl rounded-bl-sm bg-zinc-100 px-3.5 py-2 text-sm leading-6 text-zinc-800"
        >
          <MarkdownView content={shown} />
          {!item.done && (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-zinc-500 align-middle" />
          )}
        </motion.div>
      ) : (
        <div className="self-start text-xs text-zinc-400">思考中…</div>
      )}
    </div>
  );
});

/**
 * 文档内追问面板（嵌入模式：语境由外层 tab 提供）：
 * 多轮记忆在服务端（DB 历史 + 最近 6 轮上下文），前端负责展示；
 * 问答区粘底滚动（上滚释放、回底重吸）。
 */
export function AskPanel({ docId, initialAsks }: { docId: number; initialAsks: AskItem[] }) {
  const [asks, setAsks] = useState<AskItem[]>(initialAsks);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastAnswer = asks[asks.length - 1]?.answer ?? "";
  const { containerRef } = useAskAutoScroll({
    active: asking,
    contentLength: lastAnswer.length,
    itemCount: asks.length,
  });

  async function handleAsk() {
    const question = input.trim();
    if (!question || asking) return;
    setAsking(true);
    setError(null);
    setAsks((prev) => [...prev, { question, answer: "", done: false }]);
    setInput("");
    const index = asks.length;
    try {
      await streamAsk(docId, question, {
        onDelta: (text) =>
          setAsks((prev) =>
            prev.map((item, i) => (i === index ? { ...item, answer: item.answer + text } : item))
          ),
      });
      setAsks((prev) => prev.map((item, i) => (i === index ? { ...item, done: true } : item)));
    } catch (err) {
      setAsks((prev) => prev.filter((_, i) => i !== index || prev[i].answer));
      setError(err instanceof Error ? err.message : "回答失败，请稍后重试");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div>
      {/* 常驻滚动容器（空时高度为 0），粘底与手势释放依赖它稳定存在 */}
      <div
        ref={containerRef}
        className="mb-3 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1 [overflow-anchor:none]"
      >
        {asks.map((item, i) => (
          <AskBubble key={i} item={item} active={asking && i === asks.length - 1} />
        ))}
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          placeholder="如：为什么振幅按 1/n 衰减？也可以接着上一轮继续问"
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
