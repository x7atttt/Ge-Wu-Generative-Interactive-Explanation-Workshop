"use client";

/** 各块类型的骨架占位（生成期流式上屏的尾部形状，BuildProgressPanel 与 ExplainDocView 共用） */
export function BlockSkeleton({ type }: { type: string }) {
  const base = "animate-pulse rounded-lg bg-zinc-200/80";
  if (type === "text")
    return (
      <div className="space-y-2 py-1">
        <div className={`${base} h-3 w-full`} />
        <div className={`${base} h-3 w-11/12`} />
        <div className={`${base} h-3 w-2/3`} />
      </div>
    );
  if (type === "formula") return <div className={`${base} mx-auto h-12 w-1/2`} />;
  if (type === "slider")
    return (
      <div className="py-1">
        <div className={`${base} mb-2 h-2.5 w-24`} />
        <div className={`${base} h-1.5 w-full`} />
      </div>
    );
  if (type === "quiz")
    return (
      <div className="grid grid-cols-2 gap-2 py-1">
        <div className={`${base} h-8 w-full`} />
        <div className={`${base} h-8 w-full`} />
      </div>
    );
  return <div className={`${base} h-40 w-full`} />; // wavePlot / chart
}
