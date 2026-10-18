"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  action?: boolean;
}

export function HoverSelect({ value, options, onChange, label, description, icon, tone = "accent", disabled }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  description: string;
  icon: ReactNode;
  tone?: "accent" | "secondary";
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clicked = useRef(false);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<{ style: CSSProperties; height: number; above: boolean } | null>(null);
  const selected = options.findIndex((option) => option.value === value);
  const expanded = open && !disabled && placement !== null;
  const color = tone === "secondary" ? "text-secondary-700" : "text-accent-700";
  const highlight = tone === "secondary" ? "bg-secondary-50 text-secondary-700" : "bg-accent-50 text-accent-700";

  const keepOpen = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => { keepOpen(); clicked.current = false; setOpen(false); }, [keepOpen]);
  const position = useCallback(() => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const up = below < Math.min(480, options.length * 64 + 76) && above > below;
    const width = Math.min(320, window.innerWidth - 24);
    setPlacement({
      above: up,
      height: Math.max(0, Math.min(480, (up ? above : below) - 20)),
      style: { width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), ...(up ? { bottom: window.innerHeight - rect.top } : { top: rect.bottom }) },
    });
  }, [options.length]);

  function show(index = Math.max(0, selected)) {
    if (disabled) return;
    keepOpen();
    position();
    setActive(index);
    setOpen(true);
    document.dispatchEvent(new CustomEvent("gewu:select-open", { detail: id }));
  }
  function leave(pointerType: string) {
    if (pointerType !== "mouse") return;
    keepOpen();
    closeTimer.current = setTimeout(close, 160);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || disabled) return;
    close();
    trigger.current?.focus();
    onChange(option.value);
  }
  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || event.nativeEvent.isComposing) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : expanded ? (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : Math.max(0, selected);
      show(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(active); else show();
    } else if (event.key === "Escape") {
      if (expanded) { event.preventDefault(); event.stopPropagation(); close(); }
    } else if (event.key === "Tab") close();
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + event.key.toLocaleLowerCase(), at: now };
      const match = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(typed.current.text));
      if (match >= 0) { event.preventDefault(); show(match); }
    }
  }

  useEffect(() => keepOpen, [keepOpen]);
  useEffect(() => {
    if (!expanded) return;
    function outside(event: Event) {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    }
    function key(event: globalThis.KeyboardEvent) { if (event.key === "Escape") close(); }
    function other(event: Event) { if ((event as CustomEvent<string>).detail !== id) close(); }
    function scroll(event: Event) {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) close(); else position();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", key);
    document.addEventListener("gewu:select-open", other);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", position);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", key);
      document.removeEventListener("gewu:select-open", other);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
    };
  }, [expanded, close, id, position]);
  useEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, id]);

  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded && options[active] ? `${id}-option-${active}` : undefined}
      data-value={value} disabled={disabled} onKeyDown={onKey}
      onPointerEnter={(event) => { if (event.pointerType === "mouse" && window.matchMedia("(hover: hover)").matches) show(); }}
      onPointerLeave={(event) => leave(event.pointerType)}
      onClick={() => { if (expanded && clicked.current) close(); else { clicked.current = true; show(); } }}
      className={`inline-flex min-h-9 max-w-44 items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${expanded ? "border-stone-400 bg-stone-50" : "border-stone-200 bg-card hover:border-stone-400"} ${tone === "secondary" ? "text-secondary-700" : "text-stone-700"}`}>
      <span aria-hidden="true" className={`shrink-0 ${color}`}>{icon}</span>
      <span className="truncate">{options[selected]?.label ?? "请选择"}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {expanded && placement && createPortal(
      <div ref={panel} style={placement.style} className={`fixed z-[60] ${placement.above ? "pb-2" : "pt-2"}`} onPointerEnter={keepOpen} onPointerLeave={(event) => leave(event.pointerType)}>
        <div style={{ maxHeight: placement.height }} className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-card shadow-[0_12px_40px_-10px_rgba(41,37,36,0.24)]">
          <div className="shrink-0 border-b border-stone-100 px-4 py-3"><p className="text-sm font-semibold text-stone-900">{label}</p><p className="mt-0.5 text-xs leading-5 text-stone-500">{description}</p></div>
          <div role="listbox" aria-label={label} id={`${id}-list`} className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
            {options.map((option, index) => <button key={option.value} id={`${id}-option-${index}`} type="button" role="option" aria-label={option.label}
              aria-describedby={option.description ? `${id}-description-${index}` : undefined} aria-selected={option.value === value} data-value={option.value} tabIndex={-1}
              onPointerMove={(event) => { if (event.pointerType === "mouse") setActive(index); }} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${option.action ? "mt-1 border-t border-stone-100" : ""} ${index === active ? highlight : option.value === value ? "bg-stone-50 text-stone-800" : "text-stone-700"}`}>
              <span className="min-w-0 flex-1"><span className={`block break-words text-sm ${option.value === value || option.action ? "font-semibold" : "font-medium"}`}>{option.label}</span>{option.description && <span id={`${id}-description-${index}`} className="mt-0.5 block break-words text-xs leading-5 text-stone-500">{option.description}</span>}</span>
              {option.value === value && <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={`h-4 w-4 shrink-0 ${color}`}><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>)}
          </div>
        </div>
      </div>, document.body)}
  </>;
}
