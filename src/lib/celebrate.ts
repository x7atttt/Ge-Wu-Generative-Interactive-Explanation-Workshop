/**
 * 全对庆祝：小体量彩带从元素位置迸发（canvas-confetti 动态导入，只在庆祝时加载）。
 * reduced-motion 双保险：本地判断 + confetti 自带 disableForReducedMotion。
 */
export async function celebrateAt(el: HTMLElement | null): Promise<void> {
  if (!el || typeof window === "undefined") return;
  const rect = el.getBoundingClientRect();
  const { default: confetti } = await import("canvas-confetti");
  confetti({
    particleCount: 60,
    spread: 60,
    startVelocity: 28,
    scalar: 0.7,
    ticks: 110,
    disableForReducedMotion: true,
    origin: {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    },
    colors: ["#6366f1", "#34d399", "#fbbf24"],
  });
}
