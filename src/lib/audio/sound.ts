/**
 * Web Audio 纯合成音效引擎（第一档：UI 反馈音）。
 * 零音频文件——所有音色由振荡器+包络实时合成（可复现性友好）。
 * AudioContext 懒创建：play 均由用户手势（点击）触发，满足自动播放策略；
 * 静音时短路返回不建 ctx。SSR 安全（无 window 时全部 no-op）。
 */

const STORAGE_KEY = "gewu-sound";
const MASTER_VOLUME = 0.2;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function isSoundOn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== "off";
}

export function setSoundOn(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  if (!on) stopMaster();
  // 广播给 UI（SoundToggle 图标、WavePlotView 停止持续音）
  window.dispatchEvent(new CustomEvent("gewu-sound-change", { detail: on }));
}

/** 监听静音开关变化（客户端组件挂载时订阅） */
export function onSoundChange(listener: (on: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<boolean>).detail);
  window.addEventListener("gewu-sound-change", handler);
  return () => window.removeEventListener("gewu-sound-change", handler);
}

/** 在用户手势内预建 AudioContext（生成按钮点击时调用），使完成提醒音不被自动播放策略拦截 */
export function ensureAudio(): void {
  getCtx();
}

/** 供静音开关即时静住正在响的声部（可听化持续音） */
type MasterStopper = () => void;
const stoppers = new Set<MasterStopper>();
function stopMaster(): void {
  for (const stop of stoppers) stop();
}

/** 懒初始化；静音或无 window 返回 null。play 调用点均在用户手势内。 */
function getCtx(): AudioContext | null {
  if (typeof window === "undefined" || !isSoundOn()) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** 内部：获取主输出（sonify 与反馈音共用） */
export function audioMaster(): { ctx: AudioContext; out: GainNode } | null {
  const c = getCtx();
  return c && master ? { ctx: c, out: master } : null;
}

/** 注册随静音/停止需要被掐断的持续声部清理器（sonify 用） */
export function registerStopper(stop: MasterStopper): () => void {
  stoppers.add(stop);
  return () => stoppers.delete(stop);
}

/**
 * 单音：osc → gain 包络（快 attack + 指数衰减）→ master。
 * 每次调用新建节点，天然支持快速重叠（连点配对场景，MDN 最佳实践）。
 */
function tone(
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType = "sine",
  peak = 0.5
): void {
  const m = audioMaster();
  if (!m) return;
  const t0 = m.ctx.currentTime + at;
  const osc = m.ctx.createOscillator();
  const gain = m.ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(m.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 答对：E5→A5 上行双音，明亮不刺耳 */
export function playCorrect(): void {
  tone(659.25, 0, 0.1);
  tone(880, 0.09, 0.22);
}

/** 答错：G3 单音低柔——提示而非惩罚 */
export function playWrong(): void {
  tone(196, 0, 0.2, "sine", 0.4);
}

/** 单项成功（配对成功一指）：短 tick */
export function playPop(): void {
  tone(1046.5, 0, 0.05, "triangle", 0.3);
}

/** 全部完成：C5-E5-G5 上行琶音 */
export function playComplete(): void {
  tone(523.25, 0, 0.12);
  tone(659.25, 0.08, 0.12);
  tone(783.99, 0.16, 0.24);
}

/** 生成/深化完成：柔和双音提醒（生成耗时长，完成提醒有实用价值） */
export function playDone(): void {
  tone(440, 0, 0.12, "sine", 0.35);
  tone(554.37, 0.1, 0.26, "sine", 0.35);
}
