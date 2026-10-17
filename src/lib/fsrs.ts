/**
 * FSRS-6 间隔重复调度（日粒度纯函数）。
 * 公式与默认参数逐项取自开源参考实现 ts-fsrs（open-spaced-repetition/ts-fsrs，
 * src/fsrs/constant.ts 与 algorithm.ts，FSRSVersion "using FSRS-6.0"），
 * 对照验证见 scripts/fsrs-verify.mjs（devDependency ts-fsrs 逐序列比对）。
 * 设计论证见 ../reference.md「间隔重复算法」行。
 *
 * 记忆模型：难度 D∈[1,10]（越大越难）+ 稳定度 S（记忆率降到 90% 的天数）。
 * 目标记忆率 0.9 → intervalModifier = 1，间隔 ≈ 稳定度。
 * 三档评分映射 FSRS Rating：again=1(Again) / fuzzy=3(Good) / easy=4(Easy)。
 * 日粒度适配：enable_short_term=false（无分钟级步），again 评分后当日重见（due=今日），
 * 状态更新仍走 forget 公式——对应参考实现 relearning 步骤的产品级降级。
 */

export type ReviewGrade = "again" | "fuzzy" | "easy";

const GRADE_RATING: Record<ReviewGrade, number> = { again: 1, fuzzy: 3, easy: 4 };

/** 官方默认参数（ts-fsrs constant.ts default_w，FSRS-6 共 21 项；w20=decay） */
const W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const;

const S_MIN = 0.001;
const S_MAX = 36500;
const MAX_INTERVAL = 36500;
const REQUEST_RETENTION = 0.9;

// decay = -w20；factor = 0.9^(1/decay) - 1（R(S)=0.9 数值自洽，即 S 为 90% 记忆率对应天数）
const DECAY = -W[20];
const FACTOR = +((Math.exp(Math.log(0.9) / DECAY) - 1).toFixed(8));
const INTERVAL_MODIFIER = +(((REQUEST_RETENTION ** (1 / DECAY) - 1) / FACTOR).toFixed(8));

/** 本地日期 YYYY-MM-DD */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + Math.max(0, Math.round(days)));
  return localDay(d);
}

/** 两个本地日期间的天数（b - a；跨夏令时用日期零点差取整） */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000);
}

export interface FsrsState {
  /** 难度 [1,10]；0 表示未初始化（新卡） */
  difficulty: number;
  /** 稳定度（天）；0 表示未初始化（新卡） */
  stability: number;
  /** 上次评分日（YYYY-MM-DD）；新卡为 null */
  lastReview: string | null;
}

export interface FsrsNext extends FsrsState {
  /** 本次安排的间隔（again 当日重见记 0） */
  intervalDays: number;
  /** 下次到期日（本地日期） */
  due: string;
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max);
}

const round8 = (x: number): number => Number(x.toFixed(8));

/** 遗忘曲线 R(t,S) = (1 + factor·t/S)^decay */
export function forgettingCurve(t: number, s: number): number {
  return round8(Math.pow(1 + (FACTOR * t) / s, DECAY));
}

/** S₀(G) = max(w[G-1], 0.1) */
function initStability(g: number): number {
  return Math.max(W[g - 1], 0.1);
}

/** D₀(G) = w₄ - e^((G-1)·w₅) + 1（不 clamp——均值回归要用原始值，可为负；clamp 由调用方做） */
function initDifficulty(g: number): number {
  return round8(W[4] - Math.exp((g - 1) * W[5]) + 1);
}

/** 均值回归：w₇·init + (1-w₇)·current */
function meanReversion(init: number, current: number): number {
  return round8(W[7] * init + (1 - W[7]) * current);
}

/** D′ = meanRev(D₀(4), D + linear_damping(-w₆(g-3)))，clamp [1,10] */
function nextDifficulty(d: number, g: number): number {
  const deltaD = -W[6] * (g - 3);
  const damped = round8((deltaD * (10 - d)) / 9);
  return clamp(meanReversion(initDifficulty(4), d + damped), 1, 10);
}

/** S_r′ = S·(1 + e^{w₈}(11-D)S^{-w₉}(e^{w₁₀(1-R)}-1)·hardPen·easyBonus) */
function nextRecallStability(d: number, s: number, r: number, g: number): number {
  const hardPenalty = g === 2 ? W[15] : 1;
  const easyBonus = g === 4 ? W[16] : 1;
  return clamp(
    round8(
      s *
        (1 +
          Math.exp(W[8]) *
            (11 - d) *
            Math.pow(s, -W[9]) *
            (Math.exp((1 - r) * W[10]) - 1) *
            hardPenalty *
            easyBonus)
    ),
    S_MIN,
    S_MAX
  );
}

/** S_f′ = w₁₁·D^{-w₁₂}·((S+1)^{w₁₃}-1)·e^{w₁₄(1-R)} */
function nextForgetStability(d: number, s: number, r: number): number {
  return clamp(
    round8(W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14])),
    S_MIN,
    S_MAX
  );
}

/** 间隔 I = clamp(round(S × intervalModifier), 1, 36500)；无模糊因子 */
export function nextInterval(s: number): number {
  return Math.min(Math.max(1, Math.round(s * INTERVAL_MODIFIER)), MAX_INTERVAL);
}

/**
 * 四档间隔单调链（参考实现 long_term_scheduler）：again ≥ 1，hard ≥ again+1，
 * good ≥ hard+1，easy ≥ good+1——保证相邻档位的到期日严格错开。
 */
function chainedInterval(
  g: number,
  sAgain: number,
  sHard: number,
  sGood: number,
  sEasy: number
): number {
  const again = nextInterval(sAgain);
  const hard = Math.max(again + 1, nextInterval(sHard));
  const good = Math.max(hard + 1, nextInterval(sGood));
  const easy = Math.max(good + 1, nextInterval(sEasy));
  return [again, hard, good, easy][g - 1];
}

/** FSRS 核心：按当前记忆状态与评分推演下一步（r 由评分前的 S 与 elapsed 计算，与参考实现一致） */
export function schedule(state: FsrsState, grade: ReviewGrade, today = localDay()): FsrsNext {
  const g = GRADE_RATING[grade];

  let difficulty: number;
  let stability: number;
  let intervalDays: number;
  if (state.stability <= 0) {
    // 新卡首评：D₀/S₀ 直接由评分档初始化（四档间隔链保证档位间到期日错开）
    difficulty = clamp(initDifficulty(g), 1, 10);
    stability = initStability(g);
    intervalDays = chainedInterval(
      g,
      initStability(1),
      initStability(2),
      initStability(3),
      initStability(4)
    );
  } else {
    const t = Math.max(0, state.lastReview ? daysBetween(state.lastReview, today) : 0);
    const r = forgettingCurve(t, state.stability);
    const sAgain = Math.min(state.stability, nextForgetStability(state.difficulty, state.stability, r));
    const sHard = nextRecallStability(state.difficulty, state.stability, r, 2);
    const sGood = nextRecallStability(state.difficulty, state.stability, r, 3);
    const sEasy = nextRecallStability(state.difficulty, state.stability, r, 4);
    stability = g === 1 ? sAgain : g === 3 ? sGood : sEasy;
    difficulty = nextDifficulty(state.difficulty, g);
    intervalDays = chainedInterval(g, sAgain, sHard, sGood, sEasy);
  }

  // again 当日重见（产品 UX）；fuzzy/easy 按单调链间隔排期
  const interval = grade === "again" ? 0 : intervalDays;
  return {
    difficulty,
    stability: round8(stability),
    lastReview: today,
    intervalDays: interval,
    due: interval === 0 ? today : addDays(today, interval),
  };
}

export function gradeQ(grade: ReviewGrade): number {
  return GRADE_RATING[grade];
}
