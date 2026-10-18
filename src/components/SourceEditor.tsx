"use client";

import { useCallback, useEffect, useState } from "react";
import { correctSource, getSource, type SourceDetail } from "@/lib/api/sources";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useConfirmation } from "./ConfirmDialog";

export function SourceEditor({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const [source, setSource] = useState<SourceDetail | null>(null);
  const { confirm, confirmation } = useConfirmation();
  const dialogRef = useDialogFocus<HTMLElement>();
  const [content, setContent] = useState("");
  const [concepts, setConcepts] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => getSource(id).then((row) => {
      setSource(row); setContent(row.mdContent); setConcepts(row.concepts.join("\n")); setError(null);
    }).catch((err) => { setError(err instanceof Error ? err.message : "正文加载失败"); })
    .finally(() => setBusy(false)), [id]);
  useEffect(() => { load(); }, [load]);
  const textChanged = !!source && source.mdContent !== content;
  const dirty = textChanged || (!!source && concepts !== source.concepts.join("\n"));
  const matches = query.trim() ? content.split(/\r?\n/).map((text, i) => ({ text, line: i + 1 })).filter((row) => row.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];

  async function save(mode: "content" | "concepts") {
    if (!source || busy) return;
    setBusy(true); setError(null); setNote("");
    try {
      const row = await correctSource(id, source.revision, mode === "content" ? { mdContent: content } : { concepts: concepts.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) });
      setSource(row); setContent(row.mdContent); setConcepts(row.concepts.join("\n"));
      setNote(mode === "content" ? "正文已保存，旧提炼概念已清空，请重新提炼或手动确认。已有讲解保持原依据，路线建议更新。" : "概念已保存，地图已更新，路线建议重新生成。");
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败，草稿已保留"); }
    finally { setBusy(false); }
  }

  async function close() {
    if (busy) return;
    if (!dirty || await confirm({ title: "放弃未保存的修改", description: "关闭后将丢弃当前草稿，已保存的资料不受影响。", confirmLabel: "放弃并关闭", danger: true })) onClose();
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-3" onClick={close}>
    {confirmation}
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="查看与纠正资料" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (!busy) close(); } }} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-stone-200 bg-card p-5 shadow-xl">
      <div className="flex items-center gap-3"><h3 className="font-display text-lg font-semibold">查看与纠正资料</h3><button type="button" disabled={busy} className="ml-auto min-h-11 px-3 text-sm" onClick={close}>关闭</button></div>
      <p className="mb-3 text-sm text-stone-600">{source?.title} {source && `· 版本 ${source.revision}`}</p>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<button type="button" disabled={busy} className="ml-2 underline" onClick={async () => { if (!dirty || await confirm({ title: "重新加载正文", description: "这会用已保存的版本替换草稿，请先复制需要保留的修改。", confirmLabel: "替换草稿", danger: true })) load(); }}>重新加载正文</button></p>}
      {note && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{note}</p>}
      {busy && !source && <p className="py-8 text-sm text-stone-500">加载正文…</p>}
      {source && <>
        <label className="block text-sm text-stone-700">搜索解析正文<input value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 p-2" placeholder="输入公式、术语或关键句" /></label>
        {query.trim() && <div className="my-2 max-h-36 overflow-y-auto rounded-lg bg-stone-50 p-2 text-xs leading-5 text-stone-700"><p>匹配 {matches.length} 行</p>{matches.map((row) => <p key={row.line} className="break-words">第 {row.line} 行：{row.text}</p>)}</div>}
        <label className="mt-3 block text-sm text-stone-700">解析正文（纯文本 / Markdown）<textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={busy || source.status !== "ready"} rows={12} className="mt-1 w-full rounded-lg border border-stone-300 p-3 font-mono text-sm leading-6" /></label>
        <button type="button" disabled={busy || !textChanged || !content.trim()} onClick={() => save("content")} className="mt-2 min-h-11 rounded-lg bg-accent-600 px-4 text-sm text-white disabled:opacity-50">保存正文并清空旧概念</button>
        <label className="mt-4 block text-sm text-stone-700">人工确认概念（每行一个，可补充或删除）<textarea value={concepts} onChange={(e) => setConcepts(e.target.value)} rows={4} disabled={busy || textChanged || source.status !== "ready"} className="mt-1 w-full rounded-lg border border-stone-300 p-3 text-sm" /></label>
        <p className="mt-1 text-xs leading-5 text-stone-600">正文修改后请先保存，再编辑概念；也可以关闭后在资料面板重新提炼。</p>
        <button type="button" disabled={busy || textChanged || concepts === source.concepts.join("\n") || source.status !== "ready"} onClick={() => save("concepts")} className="mt-2 min-h-11 rounded-lg border border-accent-300 px-4 text-sm text-accent-700 disabled:opacity-50">保存概念</button>
      </>}
    </section>
  </div>;
}
