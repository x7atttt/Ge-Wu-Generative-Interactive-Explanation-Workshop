/**
 * 数据可听化（第二档）：把 wavePlot 的 terms 映射为持续声部——
 * 频率绑定滑块实时听音高，多 terms 叠加播和弦（谐波音色）。
 * 持久振荡器 + setTargetAtTime 平滑滑移；stop 增益归零后断开。
 */
import { audioMaster, registerStopper } from "./sound";

export interface Voice {
  /** Hz */
  freq: number;
  /** 0~1，相对响度 */
  gain: number;
}

const MAX_VOICES = 6;
const MAX_AUDIBLE_FREQ = 2000;

export class Sonifier {
  private oscs: { osc: OscillatorNode; gain: GainNode }[] = [];
  private unregister: (() => void) | null = null;
  private active = false;

  get playing(): boolean {
    return this.active;
  }

  start(voices: Voice[]): boolean {
    const m = audioMaster();
    if (!m) return false;
    this.stop();
    for (const voice of voices.slice(0, MAX_VOICES)) {
      const osc = m.ctx.createOscillator();
      const gain = m.ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = clampFreq(voice.freq);
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(voice.gain * 0.35, m.ctx.currentTime, 0.05);
      osc.connect(gain).connect(m.out);
      osc.start();
      this.oscs.push({ osc, gain });
    }
    this.active = this.oscs.length > 0;
    // 全局静音时被掐断：恢复播放态由 UI 轮询/交互重建
    this.unregister = registerStopper(() => this.stop());
    return this.active;
  }

  /** 滑块变化时平滑跟随（不重建节点，听感无缝） */
  update(voices: Voice[]): void {
    const m = audioMaster();
    if (!m || !this.active) return;
    const now = m.ctx.currentTime;
    this.oscs.forEach(({ osc, gain }, i) => {
      const voice = voices[i];
      if (!voice) return;
      osc.frequency.setTargetAtTime(clampFreq(voice.freq), now, 0.03);
      gain.gain.setTargetAtTime(voice.gain * 0.35, now, 0.03);
    });
  }

  stop(): void {
    const m = audioMaster();
    for (const { osc, gain } of this.oscs) {
      try {
        if (m) {
          gain.gain.cancelScheduledValues(m.ctx.currentTime);
          gain.gain.setTargetAtTime(0, m.ctx.currentTime, 0.02);
        }
        osc.stop(m ? m.ctx.currentTime + 0.1 : undefined as unknown as number);
        osc.disconnect();
        gain.disconnect();
      } catch {
        // 已停止的节点忽略
      }
    }
    this.oscs = [];
    this.active = false;
    this.unregister?.();
    this.unregister = null;
  }
}

function clampFreq(freq: number): number {
  if (!Number.isFinite(freq) || freq <= 0) return 220;
  return Math.min(freq, MAX_AUDIBLE_FREQ);
}
