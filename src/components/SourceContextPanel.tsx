"use client";

import { useState } from "react";
import { loadSourceContext } from "@/lib/api/explanation";
import type { SourceContext } from "@/lib/db/docs";

export function SourceContextPanel({ docId }: { docId: number }) {
  const [context, setContext] = useState<SourceContext | null | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try { setContext(await loadSourceContext(docId)); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "依据加载失败"); }
    finally { setBusy(false); }
  }
  return <details className="mt-4 rounded-xl border border-stone-200 p-3 text-sm text-stone-700" onToggle={(e) => { if (e.currentTarget.open && context === undefined && !busy && !error) load(); }}>
    <summary className="cursor-pointer">生成时的资料依据</summary>
    {busy && <p className="mt-2">加载依据…</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}<button type="button" onClick={load} className="ml-2 underline">重试</button></p>}
    {context === null && <p className="mt-2 text-xs leading-5">这篇历史讲解未记录资料快照，无法还原当时的正文版本。</p>}
    {context && <><p className="mt-2 text-xs leading-5">{context.sources.length ? context.sources.map((s) => `${s.title} · 版本 ${s.revision}`).join("；") : "本次生成未附加资料。"}</p>
      <p className="mt-1 text-xs text-stone-500">仅展示生成时提供的资料上下文；含截断标记，不表示逐句事实核验。后续资料修改不会改写此快照。</p>
      {!!context.text && <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 text-xs leading-6">{context.text}</pre>}</>}
  </details>;
}
