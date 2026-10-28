/**
 * 只有完整保留前版的追加才属于补充；修订后的块坐标不再沿用旧边界。
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

export function isAppendVersion(previous: Block[], current: Block[]): boolean {
  return current.length > previous.length && previous.every((block, index) => blockFingerprint(block) === blockFingerprint(current[index]));
}

/** JSON 字段顺序不代表内容变化；输入校验和历史恢复会重排对象键。 */
function blockFingerprint(block: Block): string {
  return JSON.stringify(block, (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

export function computeDeepens(versions: VersionInfo[]): DeepenInfo[] {
  if (versions.length < 2) return [];
  const result: DeepenInfo[] = [];

  for (let i = 1; i < versions.length; i++) {
    const prev = versions[i - 1].blocks;
    const cur = versions[i].blocks;
    const instruction = versions[i].instruction;
    if (!isAppendVersion(prev, cur)) { result.length = 0; continue; }
    if (instruction?.trim()) result.push({ fromIndex: prev.length, label: instruction.trim() });
  }
  return result;
}
