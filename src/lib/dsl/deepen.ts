/**
 * 深化分组计算：当前版本与父版本逐块 JSON 相等求最长公共前缀，
 * 前缀之后的块视为本次 refine 的新增/修改段，渲染进「深化 · 指令」分组卡。
 */
import type { Block } from "./schema";

export interface DeepenInfo {
  fromIndex: number;
  label: string;
}

export function computeDeepen(
  blocks: Block[],
  parentBlocks: Block[] | null,
  instruction: string | null
): DeepenInfo | null {
  if (!parentBlocks || !instruction || !instruction.trim()) return null;
  if (blocks.length <= parentBlocks.length) return null;

  let prefix = 0;
  while (
    prefix < parentBlocks.length &&
    JSON.stringify(blocks[prefix]) === JSON.stringify(parentBlocks[prefix])
  ) {
    prefix++;
  }
  // 前缀为 0 视为全文重写：不分组，整篇正常展示
  if (prefix === 0 || prefix >= blocks.length) return null;

  return { fromIndex: prefix, label: instruction.trim() };
}
