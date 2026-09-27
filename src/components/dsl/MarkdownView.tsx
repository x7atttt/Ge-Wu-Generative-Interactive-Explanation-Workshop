"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 轻量 Markdown 渲染：手写样式映射，不引入 typography 排版插件 */
export function MarkdownView({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="leading-6 [&:not(:first-child)]:mt-2">{children}</p>,
        ul: ({ children }) => <ul className="mt-1 list-disc space-y-1 pl-4">{children}</ul>,
        ol: ({ children }) => <ol className="mt-1 list-decimal space-y-1 pl-4">{children}</ol>,
        strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
        code: ({ children }) => (
          <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
