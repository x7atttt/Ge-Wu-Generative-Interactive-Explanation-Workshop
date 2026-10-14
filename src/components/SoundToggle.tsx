"use client";

import { useEffect, useState } from "react";
import { isSoundOn, setSoundOn } from "@/lib/audio/sound";

/** 右上角标签组的音效开关（🔊/🔇），localStorage 持久化，关闭即静住持续声部 */
export function SoundToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    setOn(isSoundOn());
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        const next = !on;
        setOn(next);
        setSoundOn(next);
      }}
      aria-pressed={on}
      title={on ? "关闭所有音效" : "开启音效"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-colors ${
        on
          ? "border-stone-200 bg-card/90 text-stone-600 hover:border-accent-300 hover:text-accent-600"
          : "border-stone-200 bg-card/90 text-stone-300 hover:text-stone-500"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinecap="round" strokeLinejoin="round" />
        {on ? (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" strokeLinecap="round" />
        ) : (
          <path d="m16 9 5 6m0-6-5 6" strokeLinecap="round" />
        )}
      </svg>
      {on ? "音效" : "静音"}
    </button>
  );
}
