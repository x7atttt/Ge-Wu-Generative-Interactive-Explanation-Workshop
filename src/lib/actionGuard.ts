/**
 * 重生成动作单飞门（生成/改造共用）：同一进程同时只允许一个在途动作。
 * 单人本地应用——并发触发必然是误触（连击/双标签页），直接拒绝而不是排队。
 * 10 分钟看门狗：进程崩溃/流泄漏不会永久卡死（超过即视为陈旧可抢占）。
 */

let holder: { kind: string; since: number } | null = null;
const STALE_MS = 10 * 60_000;

export function tryAcquireAction(kind: string): (() => void) | null {
  if (holder !== null && Date.now() - holder.since < STALE_MS) return null;
  const owner = { kind, since: Date.now() };
  holder = owner;
  // 旧请求取消后的 finally 不能释放后来请求的占用。
  return () => { if (holder === owner) holder = null; };
}

/** 当前占用者（诊断用） */
export function currentAction(): string | null {
  return holder !== null && Date.now() - holder.since < STALE_MS ? holder.kind : null;
}
