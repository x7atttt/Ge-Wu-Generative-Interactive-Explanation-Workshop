/**
 * 容错增量 JSON 解析：从流式累计文本中切出 blocks 数组里已闭合的顶层元素。
 * 仅服务生成过程的渐进展示；正确性由 done 事件的全量校验文档负责。
 */
import { blockSchema, type Block } from "./schema";

const TITLE_RE = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const TYPE_RE = /"type"\s*:\s*"(\w+)"/;

export interface PartialDoc {
  title: string | null;
  blocks: Block[];
  /** 已闭合但未通过校验的块类型（骨架保留，等终态替换） */
  pending: string[];
  /** 最近见到的块类型（当前正在流式中的块骨架形状参考） */
  lastType: string | null;
}

export function parsePartialDoc(raw: string): PartialDoc {
  const title = raw.match(TITLE_RE)?.[1] ?? null;

  const blocksStart = raw.indexOf("\"blocks\"");
  const arrayStart = blocksStart === -1 ? -1 : raw.indexOf("[", blocksStart);
  const result: PartialDoc = { title, blocks: [], pending: [], lastType: null };
  if (arrayStart === -1) return result;

  const blocks: Block[] = [];
  const pending: string[] = [];
  let lastType: string | null = null;

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart + 1; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (ch === "{" && depth === 0) start = i;
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && ch === "}" && start !== -1) {
        const candidate = raw.slice(start, i + 1);
        const type = candidate.match(TYPE_RE)?.[1] ?? null;
        if (type) lastType = type;
        try {
          const parsed = blockSchema.safeParse(JSON.parse(candidate));
          if (parsed.success) blocks.push(parsed.data);
          else pending.push(type ?? "text");
        } catch {
          pending.push(type ?? "text");
        }
        start = -1;
      }
      if (depth < 0) break; // blocks 数组已闭合
    }
  }

  return { title, blocks, pending, lastType };
}
