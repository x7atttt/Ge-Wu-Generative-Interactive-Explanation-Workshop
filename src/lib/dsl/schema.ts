/**
 * DSL v0 契约：ExplainDoc。
 * 生成层（LLM）与渲染层（React 组件）之间的唯一接口，
 * 结构与决策依据见 spec/2026-09-24-dsl-schema-v0.md
 * （迭代 2 扩展见 iteration2 spec，练习块见 iteration8 spec）。
 */
import { z } from "zod";

export const varRefSchema = z.object({ $var: z.string() });
export type VarRef = z.infer<typeof varRefSchema>;

/** 数值槽：常量，或绑定到某个滑块变量 */
export type NumberSlot = number | VarRef;

const numberSlotSchema = z.union([z.number(), varRefSchema]);

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const headingBlockSchema = z.object({
  type: z.literal("heading"),
  text: z.string().min(1),
  level: z.number().int().min(2).max(3).default(3),
});

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
  /** bar 柱（数量对比）/ line 折线（顺序趋势）/ area 面积（累积趋势感）/ pie 构成占比 /
   *  hbar 条形（长类目名、排名）/ radar 雷达（3~8 维综合对比，非负指标） */
  chartType: z.enum(["bar", "line", "area", "pie", "hbar", "radar"]),
  title: z.string().optional(),
  categories: z.array(z.string()).optional(),
  /** 纵轴语义标签（仅 bar/line）：key 为刻度数值（JSON 里是数字字符串），渲染层按 String(value) 匹配替换 */
  yLabels: z.record(z.string(), z.string()).optional(),
  /** 纵轴刻度：默认 linear；数据全为正且跨数量级时可用/自动切换 log（含 0 或负值不可用） */
  yType: z.enum(["linear", "log"]).optional(),
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

/** 完形填空的空位：text 中以 ___ 占位，数量须与 blanks 一致（superRefine 校验） */
export const fillBlankSlotSchema = z.object({
  options: z.array(z.string().min(1)).min(2),
  answer: z.number().int().nonnegative(),
  explanation: z.string().optional(),
});

export const fillBlankBlockSchema = z.object({
  type: z.literal("fillBlank"),
  prompt: z.string().optional(),
  text: z.string().min(1),
  blanks: z.array(fillBlankSlotSchema).min(1),
});

export const matchBlockSchema = z.object({
  type: z.literal("match"),
  prompt: z.string().min(1),
  pairs: z
    .array(
      z.object({
        left: z.string().min(1),
        right: z.string().min(1),
      })
    )
    .min(2),
});

export const sortBlockSchema = z.object({
  type: z.literal("sort"),
  prompt: z.string().min(1),
  categories: z.array(z.string().min(1)).min(2),
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        category: z.string().min(1),
      })
    )
    .min(1),
});

export const blockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  textBlockSchema,
  formulaBlockSchema,
  sliderBlockSchema,
  wavePlotBlockSchema,
  chartBlockSchema,
  quizBlockSchema,
  fillBlankBlockSchema,
  matchBlockSchema,
  sortBlockSchema,
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
    const referenced = new Set<string>();
    const trackSlot = (slot: NumberSlot) => {
      if (typeof slot === "object" && slot !== null && "$var" in slot) referenced.add(slot.$var);
    };

    for (const [i, block] of doc.blocks.entries()) {
      if (block.type === "wavePlot") {
        for (const [j, term] of block.terms.entries()) {
          checkSlot(term.amp, ["blocks", i, "terms", j, "amp"], "wavePlot.terms.amp");
          checkSlot(term.freq, ["blocks", i, "terms", j, "freq"], "wavePlot.terms.freq");
          checkSlot(term.phase, ["blocks", i, "terms", j, "phase"], "wavePlot.terms.phase");
          trackSlot(term.amp);
          trackSlot(term.freq);
          trackSlot(term.phase);
        }
      }
      if (block.type === "chart") {
        for (const [j, serie] of block.series.entries()) {
          serie.data.forEach((slot, k) => {
            checkSlot(slot, ["blocks", i, "series", j, "data", k], "chart.series.data");
            trackSlot(slot);
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
      if (block.type === "fillBlank") {
        const slots = block.text.split("___").length - 1;
        if (slots !== block.blanks.length) {
          ctx.addIssue({
            code: "custom",
            path: ["blocks", i, "text"],
            message: `fillBlank 的 text 中 ___ 数量（${slots}）必须等于 blanks 数量（${block.blanks.length}）`,
          });
        }
        for (const [j, blank] of block.blanks.entries()) {
          if (blank.answer >= blank.options.length) {
            ctx.addIssue({
              code: "custom",
              path: ["blocks", i, "blanks", j, "answer"],
              message: "fillBlank 的 answer 必须是 options 的合法下标",
            });
          }
        }
      }
      if (block.type === "match") {
        // 配对按内容判定，任一列出现重复值会让配对结果不可判定
        for (const key of ["left", "right"] as const) {
          const seen = new Set<string>();
          for (const [j, pair] of block.pairs.entries()) {
            if (seen.has(pair[key])) {
              ctx.addIssue({
                code: "custom",
                path: ["blocks", i, "pairs", j, key],
                message: `match 的 ${key} 值重复：${pair[key]}`,
              });
            }
            seen.add(pair[key]);
          }
        }
      }
      if (block.type === "sort") {
        const categories = new Set(block.categories);
        for (const [j, item] of block.items.entries()) {
          if (!categories.has(item.category)) {
            ctx.addIssue({
              code: "custom",
              path: ["blocks", i, "items", j, "category"],
              message: `sort 的 item.category "${item.category}" 必须取自 categories`,
            });
          }
        }
      }
    }

    // 滑块必须有感：没有被任何 $var 槽引用的滑块，拖动在图表上无任何可见效果
    for (const [i, block] of doc.blocks.entries()) {
      if (block.type === "slider" && !referenced.has(block.var)) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", i],
          message: `滑块 ${block.var} 未被任何 wavePlot/chart 的 {"$var":...} 引用，拖动将无效果——请把关键数据槽绑成 {"$var":"${block.var}"} 或删除该滑块`,
        });
      }
    }
  });

export type ExplainDoc = z.output<typeof explainDocSchema>;
export type Block = z.output<typeof blockSchema>;
export type HeadingBlock = z.output<typeof headingBlockSchema>;
export type TextBlock = z.output<typeof textBlockSchema>;
export type FormulaBlock = z.output<typeof formulaBlockSchema>;
export type SliderBlock = z.output<typeof sliderBlockSchema>;
export type WavePlotBlock = z.output<typeof wavePlotBlockSchema>;
export type WaveTerm = z.output<typeof waveTermSchema>;
export type ChartBlock = z.output<typeof chartBlockSchema>;
export type QuizBlock = z.output<typeof quizBlockSchema>;
export type FillBlankBlock = z.output<typeof fillBlankBlockSchema>;
export type FillBlankSlot = z.output<typeof fillBlankSlotSchema>;
export type MatchBlock = z.output<typeof matchBlockSchema>;
export type SortBlock = z.output<typeof sortBlockSchema>;

/** 校验并返回友好错误摘要；合法时返回 null */
export function validateDoc(doc: unknown): string | null {
  const result = explainDocSchema.safeParse(doc);
  if (result.success) return null;
  return result.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(文档)"}: ${issue.message}`)
    .join("；");
}
