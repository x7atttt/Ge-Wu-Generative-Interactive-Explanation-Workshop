"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import katex from "katex";
import { preprocessMarkdown } from "@/lib/markdown/preprocess";

function renderKatex(raw: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(raw, { displayMode, throwOnError: false });
  } catch {
    return null;
  }
}

/** 轻量 Markdown 渲染：数学定界符预处理 + 手写样式映射，不引排版/数学插件 */
export function MarkdownView({ content }: { content: string }) {
  const processed = useMemo(() => preprocessMarkdown(content), [content]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="leading-6 [&:not(:first-child)]:mt-2">{children}</p>,
        ul: ({ children }) => <ul className="mt-1 list-disc space-y-1 pl-4">{children}</ul>,
        ol: ({ children }) => <ol className="mt-1 list-decimal space-y-1 pl-4">{children}</ol>,
        strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
        // pre 透传：块级样式由 code 组件整体负责
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          const raw = String(children).replace(/\n$/, "");
          const lang = /language-([\w-]+)/.exec(className || "")?.[1];

          if (lang === "math") {
            const html = renderKatex(raw, true);
            return html ? (
              <div
                className="my-2 overflow-x-auto text-center"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[0.85em]">{raw}</code>
            );
          }
          if (raw.startsWith("math:")) {
            const html = renderKatex(raw.slice(5), false);
            return html ? (
              <span dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[0.85em]">
                {raw.slice(5)}
              </code>
            );
          }
          if (raw.includes("\n") || lang) {
            return (
              <div className="my-2 overflow-hidden rounded-xl bg-zinc-900">
                <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-zinc-100">
                  <code>{raw}</code>
                </pre>
              </div>
            );
          }
          return (
            <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
          );
        },
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-lg border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-zinc-50">{children}</thead>,
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-medium text-zinc-800">{children}</th>
        ),
        tbody: ({ children }) => <tbody className="divide-y divide-zinc-100">{children}</tbody>,
        td: ({ children }) => <td className="px-3 py-2 text-zinc-600">{children}</td>,
        a: ({ href, children }) => {
          const external = href?.startsWith("http://") || href?.startsWith("https://");
          return (
            <a
              href={href}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="text-indigo-600 underline decoration-indigo-300 underline-offset-2 transition-colors hover:decoration-indigo-500"
            >
              {children}
            </a>
          );
        },
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}
