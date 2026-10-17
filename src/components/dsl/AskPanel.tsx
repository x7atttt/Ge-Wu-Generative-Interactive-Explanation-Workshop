"use client";

import { memo, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { streamAsk } from "@/lib/api/explanation";
import { compressImage } from "@/lib/imageCompress";
import { useDropZone } from "@/hooks/useDropZone";
import { useAskAutoScroll } from "@/hooks/useAskAutoScroll";
import { useSmoothStreamText } from "@/hooks/useSmoothStreamText";
import { MarkdownView } from "./MarkdownView";

export interface AskItem {
  question: string;
  answer: string;
  done: boolean;
  /** 本轮附图数（恢复的历史轮图片不回显，仅在问题文本里带 [图片] 占位） */
  imageCount?: number;
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
      <div className="self-end rounded-2xl rounded-br-sm bg-accent-600 px-3.5 py-2 text-sm text-white">
        {item.imageCount ? (
          <span className="mr-1.5 rounded bg-white/20 px-1 py-0.5 text-[10px]">📷×{item.imageCount}</span>
        ) : null}
        {item.question}
      </div>
      {shown ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="self-start rounded-2xl rounded-bl-sm bg-stone-100 px-3.5 py-2 text-sm leading-6 text-stone-800"
        >
          <MarkdownView content={shown} />
          {!item.done && (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-stone-500 align-middle" />
          )}
        </motion.div>
      ) : (
        <div className="self-start text-xs text-stone-400">思考中…</div>
      )}
    </div>
  );
});

const MAX_IMAGES = 2;

/**
 * 文档内追问面板（嵌入模式：语境由外层 tab 提供）：
 * 多轮记忆在服务端（DB 历史 + 最近 6 轮上下文），前端负责展示；
 * 支持附图（多模态识图）：📷 选择 / 输入框直接粘贴截图，前端压缩后随问题发送；
 * 问答区粘底滚动（上滚释放、回底重吸）。
 */
export function AskPanel({
  docId,
  initialAsks,
  personaStyle,
}: {
  docId: number;
  initialAsks: AskItem[];
  /** 语气人设（服务端注入回答提示词）；null/省略 = 默认 */
  personaStyle?: string | null;
}) {
  const [asks, setAsks] = useState<AskItem[]>(initialAsks);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const lastAnswer = asks[asks.length - 1]?.answer ?? "";
  const { containerRef } = useAskAutoScroll({
    active: asking,
    contentLength: lastAnswer.length,
    itemCount: asks.length,
  });

  async function addFiles(files: File[]) {
    const pics = files.filter((f) => f.type.startsWith("image/"));
    if (pics.length === 0) return;
    setImgBusy(true);
    setError(null);
    try {
      const next = [...images];
      for (const file of pics) {
        if (next.length >= MAX_IMAGES) {
          setError(`一次追问最多 ${MAX_IMAGES} 张图`);
          break;
        }
        next.push(await compressImage(file));
      }
      setImages(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片处理失败");
    } finally {
      setImgBusy(false);
    }
  }

  // 拖入图片（文档不适用于追问，引导去生成区）
  const askDrop = useDropZone((files) => {
    const pics = files.filter((f) => f.type.startsWith("image/"));
    if (pics.length === 0) {
      setError("追问只支持图片；文档请拖到上方生成区导入为资料");
      return;
    }
    void addFiles(files);
  }, !asking);

  async function handleAsk() {
    const question = input.trim();
    if ((!question && images.length === 0) || asking) return;
    setAsking(true);
    setError(null);
    const imageCount = images.length;
    const askText = question || "（看图回答）";
    setAsks((prev) => [...prev, { question: askText, answer: "", done: false, imageCount }]);
    setInput("");
    const sentImages = images;
    setImages([]);
    const index = asks.length;
    try {
      await streamAsk(docId, askText, {
        personaStyle,
        images: sentImages,
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
    <div
      {...askDrop.handlers}
      className={`relative rounded-xl transition-colors ${
        askDrop.isOver ? "bg-accent-50/50 ring-1 ring-accent-300" : ""
      }`}
    >
      {askDrop.isOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent-400 bg-card/85">
          <p className="text-sm font-medium text-accent-600">松开添加图片</p>
        </div>
      )}
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

      {/* 待发送图片缩略图（压缩后 data URL，随问题单次消费不落库） */}
      {images.length > 0 && (
        <div className="mb-2 flex gap-2">
          {images.map((url, i) => (
            <span key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`附图 ${i + 1}`}
                className="h-14 w-14 rounded-lg border border-stone-200 object-cover"
              />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-stone-600 text-[10px] leading-none text-white"
                title="移除"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder="如：这题为什么选 B？（📷 / 粘贴 / 拖入截图提问）"
          maxLength={300}
          className="h-10 flex-1 rounded-xl border border-stone-200 px-3 text-sm outline-none transition-colors focus:border-accent-400"
          disabled={asking}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={asking || imgBusy || images.length >= MAX_IMAGES}
          title={`附图提问（最多 ${MAX_IMAGES} 张，可粘贴截图）`}
          className="h-10 rounded-xl border border-stone-200 px-3 text-sm text-stone-500 transition-colors hover:border-accent-300 hover:text-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          📷
        </button>
        <button
          onClick={handleAsk}
          disabled={asking || (!input.trim() && images.length === 0)}
          className="h-10 rounded-xl border border-accent-200 bg-accent-50 px-4 text-sm font-medium text-accent-700 transition-colors hover:bg-accent-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {asking ? "回答中…" : "追问"}
        </button>
      </div>
    </div>
  );
}
