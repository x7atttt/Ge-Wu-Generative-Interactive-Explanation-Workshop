/**
 * DSL v0 契约：ExplainDoc。
 * 生成层（LLM）与渲染层（React 组件）之间的唯一接口，
 * 结构与决策依据见 spec/2026-09-24-dsl-schema-v0.md（迭代 2 扩展见 iteration2 spec）。
 */
import { z } from "zod";

export const varRefSchema = z.object({ $var: z.string() });
export type VarRef = z.infer<typeof varRefSchema>;

/** 数值槽：常量，或绑定到某个滑块变量 */
export type NumberSlot = number | VarRef;

const numberSlotSchema = z.union([z.number(), varRefSchema]);

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const textBlockSchema = z.object({
  type: z.literal("text"),
  content: z.string().min(1),
});

export const formulaBlockSchema = z.object({
  type: z.literal("formula"),
  latex: z.string().min(1),
  caption: z.string().optional(),
});

export const sliderBlockSchema = z.object({
  type: z.literal("slider"),
  var: z.string().regex(identifierPattern, "变量名须为字母/数字/下划线的合法标识符"),
  label: z.string().min(1),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  initial: z.number(),
});

export const waveFnSchema = z.enum(["sin", "cos"]);

export const waveTermSchema = z.object({
  fn: waveFnSchema,
  amp: numberSlotSchema.default(1),
  freq: numberSlotSchema.default(1),
  phase: numberSlotSchema.default(0),
});

export const wavePlotBlockSchema = z.object({
  type: z.literal("wavePlot"),
  title: z.string().optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  terms: z.array(waveTermSchema).min(1),
});

export const chartBlockSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "pie"]),
  title: z.string().optional(),
  categories: z.array(z.string()).optional(),
  series: z
    .array(
      z.object({
        name: z.string().optional(),
        data: z.array(numberSlotSchema).min(1),
      })
    )
    .min(1),
});

export const quizBlockSchema = z.object({
  type: z.literal("quiz"),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  answer: z.number().int().nonnegative(),
  explanation: z.string().min(1),
});

export const blockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  formulaBlockSchema,
  sliderBlockSchema,
  wavePlotBlockSchema,
  chartBlockSchema,
  quizBlockSchema,
]);

export const explainDocSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1),
    blocks: z.array(blockSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const vars = new Set<string>();

    for (const [i, block] of doc.blocks.entries()) {
      if (block.type !== "slider") continue;
      if (!(block.min < block.max)) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", i],
          message: `滑块 ${block.var} 的 min 必须小于 max`,
        });
      }
      if (vars.has(block.var)) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", i],
          message: `滑块变量 ${block.var} 重复定义`,
        });
      }
      vars.add(block.var);
    }

    const checkSlot = (slot: NumberSlot, path: (string | number)[], where: string) => {
      if (typeof slot === "object" && slot !== null && "$var" in slot && !vars.has(slot.$var)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `${where} 引用了未定义的变量 ${slot.$var}`,
        });
      }
    };

    for (const [i, block] of doc.blocks.entries()) {
      if (block.type === "wavePlot") {
        for (const [j, term] of block.terms.entries()) {
          checkSlot(term.amp, ["blocks", i, "terms", j, "amp"], "wavePlot.terms.amp");
          checkSlot(term.freq, ["blocks", i, "terms", j, "freq"], "wavePlot.terms.freq");
          checkSlot(term.phase, ["blocks", i, "terms", j, "phase"], "wavePlot.terms.phase");
        }
      }
      if (block.type === "chart") {
        for (const [j, serie] of block.series.entries()) {
          serie.data.forEach((slot, k) => {
            checkSlot(slot, ["blocks", i, "series", j, "data", k], "chart.series.data");
          });
        }
      }
      if (block.type === "quiz" && block.answer >= block.options.length) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", i, "answer"],
          message: "quiz 的 answer 必须是 options 的合法下标",
        });
      }
    }
  });

export type ExplainDoc = z.output<typeof explainDocSchema>;
export type Block = z.output<typeof blockSchema>;
export type TextBlock = z.output<typeof textBlockSchema>;
export type FormulaBlock = z.output<typeof formulaBlockSchema>;
export type SliderBlock = z.output<typeof sliderBlockSchema>;
export type WavePlotBlock = z.output<typeof wavePlotBlockSchema>;
export type WaveTerm = z.output<typeof waveTermSchema>;
export type ChartBlock = z.output<typeof chartBlockSchema>;
export type QuizBlock = z.output<typeof quizBlockSchema>;

/** 校验并返回友好错误摘要；合法时返回 null */
export function validateDoc(doc: unknown): string | null {
  const result = explainDocSchema.safeParse(doc);
  if (result.success) return null;
  return result.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(文档)"}: ${issue.message}`)
    .join("；");
}
