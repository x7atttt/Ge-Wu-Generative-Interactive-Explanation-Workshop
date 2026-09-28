/**
 * 深化链分段计算：版本链（根在前）逐对求最长公共前缀，
 * 每轮 refine 的指令对应最终文档中一个新增段，渲染为多张深化卡。
 */
import type { Block } from "./schema";

export interface DeepenInfo {
  fromIndex: number;
  label: string;
}

export interface VersionInfo {
  blocks: Block[];
  instruction: string | null;
}

export function computeDeepens(versions: VersionInfo[]): DeepenInfo[] {
  if (versions.length < 2) return [];
  const result: DeepenInfo[] = [];

  for (let i = 1; i < versions.length; i++) {
    const prev = versions[i - 1].blocks;
    const cur = versions[i].blocks;
    const instruction = versions[i].instruction;
    if (!instruction || !instruction.trim()) continue;
    if (cur.length <= prev.length) continue;

    let prefix = 0;
    while (
      prefix < prev.length &&
      JSON.stringify(cur[prefix]) === JSON.stringify(prev[prefix])
    ) {
      prefix++;
    }
    // 前缀为 0 视为该轮全文重写：跳过分段（后续轮仍按各自前缀计算）
    if (prefix === 0 || prefix >= cur.length) continue;

    result.push({ fromIndex: prefix, label: instruction.trim() });
  }
  return result;
}
