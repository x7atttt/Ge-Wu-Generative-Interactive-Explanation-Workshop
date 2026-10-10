/**
 * 内容哈希的确定性排序下标：同一输入在服务端与客户端产出相同顺序，
 * 供配对/分类题打乱题面使用（随机洗牌会导致 hydration 不一致）。
 */
export function hashOrder(keys: string[]): number[] {
  const hash = (s: string, i: number) => {
    let h = 5381;
    const key = `${i}:${s}`;
    for (let j = 0; j < key.length; j++) h = (Math.imul(h, 33) + key.charCodeAt(j)) | 0;
    return h >>> 0;
  };
  return keys.map((_, i) => i).sort((a, b) => hash(keys[a], a) - hash(keys[b], b));
}
