"use client";

import type { Block } from "@/lib/dsl/schema";
import { FormulaBlockView } from "./FormulaBlockView";
import { SliderControl } from "./SliderControl";
import { TextBlockView } from "./TextBlockView";
import { WavePlotView } from "./WavePlotView";

/**
 * 块分发器（扩展点）：新增块类型 = schema 加联合分支 + 此处加 case + 实现组件，
 * 其余链路（生成、校验、容器）零改动。
 */
export function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return <TextBlockView block={block} />;
    case "formula":
      return <FormulaBlockView block={block} />;
    case "slider":
      return <SliderControl block={block} />;
    case "wavePlot":
      return <WavePlotView block={block} />;
  }
}
