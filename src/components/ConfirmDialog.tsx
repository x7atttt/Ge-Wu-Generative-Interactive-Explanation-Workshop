"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";

type Choice = { value: string; label: string; description: string; danger?: boolean };
type Confirmation = { title: string; description: string; confirmLabel?: string; danger?: boolean; choices?: Choice[] };
export type ConfirmAction = (request: Confirmation) => Promise<string | null>;

export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);
  const confirm: ConfirmAction = useCallback((next) => {
    if (resolver.current) return Promise.resolve(null);
    setRequest(next);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);
  const settle = useCallback((value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);
  useEffect(() => () => { resolver.current?.(null); resolver.current = null; }, []);
  return { confirm, confirmation: request ? <ConfirmDialog request={request} onResult={settle} /> : null };
}

function ConfirmDialog({ request, onResult }: { request: Confirmation; onResult: (value: string | null) => void }) {
  const ref = useDialogFocus<HTMLElement>();
  const descriptionId = useId();
  const [value, setValue] = useState(request.choices?.[0]?.value ?? "confirm");
  const selected = request.choices?.find((choice) => choice.value === value);
  const danger = selected?.danger ?? request.danger;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm"
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onResult(null); }}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") onResult(null); }}>
      <section ref={ref} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label={request.title} aria-describedby={descriptionId}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-stone-200 bg-card p-6 shadow-2xl outline-none">
        <h3 className="font-display text-xl font-semibold text-stone-900">{request.title}</h3>
        <p id={descriptionId} className="mt-3 whitespace-pre-line text-sm leading-6 text-stone-600">{request.description}</p>
        {request.choices && <fieldset className="mt-4 space-y-2"><legend className="sr-only">删除方式</legend>{request.choices.map((choice) =>
          <label key={choice.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${value === choice.value ? "border-accent-400 bg-accent-50" : "border-stone-200"}`}>
            <input type="radio" name={descriptionId} value={choice.value} checked={value === choice.value} onChange={() => setValue(choice.value)} className="mt-1 accent-accent-600" />
            <span><span className="block text-sm font-medium text-stone-900">{choice.label}</span><span className="mt-1 block text-xs leading-5 text-stone-600">{choice.description}</span></span>
          </label>)}</fieldset>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => onResult(null)} className="min-h-11 rounded-xl border border-stone-300 px-5 text-sm text-stone-700 hover:bg-stone-100">取消</button>
          <button type="button" onClick={() => onResult(value)} className={`min-h-11 rounded-xl px-5 text-sm text-white ${danger ? "bg-red-700 hover:bg-red-800" : "bg-accent-600 hover:bg-accent-700"}`}>{selected?.label ?? request.confirmLabel ?? "确认"}</button>
        </div>
      </section>
    </div>, document.body);
}
