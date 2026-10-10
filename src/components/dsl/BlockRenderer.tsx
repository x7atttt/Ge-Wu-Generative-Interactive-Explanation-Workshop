"use client";

import type { Block } from "@/lib/dsl/schema";
import { ChartView } from "./ChartView";
import { FillBlankView } from "./FillBlankView";
import { FormulaBlockView } from "./FormulaBlockView";
import { HeadingBlockView } from "./HeadingBlockView";
import { MatchView } from "./MatchView";
import { QuizView } from "./QuizView";
import { SliderControl } from "./SliderControl";
import { SortView } from "./SortView";
import { TextBlockView } from "./TextBlockView";
import { WavePlotView } from "./WavePlotView";

/**
 * 块分发器（扩展点）：新增块类型 = schema 加联合分支 + 此处加 case + 实现组件，
 * 其余链路（生成、校验、容器）零改动。
 */
export function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "heading":
      return <HeadingBlockView block={block} />;
    case "text":
      return <TextBlockView block={block} />;
    case "formula":
      return <FormulaBlockView block={block} />;
    case "slider":
      return <SliderControl block={block} />;
    case "wavePlot":
      return <WavePlotView block={block} />;
    case "chart":
      return <ChartView block={block} />;
    case "quiz":
      return <QuizView block={block} />;
    case "fillBlank":
      return <FillBlankView block={block} />;
    case "match":
      return <MatchView block={block} />;
    case "sort":
      return <SortView block={block} />;
  }
}
