/**
 * 迭代21 对照验证：自研 lib/fsrs.ts vs 开源参考实现 ts-fsrs 5.4.2（devDependency，仅验证用）。
 * 配置对齐：FSRS-6 默认参数、request_retention 0.9、enable_short_term=false、无 fuzz。
 * 逐序列推进（评分子由序列显式给出，两侧共用同一 elapsed），比对难度 D / 稳定度 S，
 * 非 again 档同时断言排期间隔一致；again 的"当日重见"是产品适配（间隔记 0），只比状态。
 *
 * 运行：node scripts/fsrs-verify.mjs（fsrs.ts 单文件无依赖，tsc 转译临时副本后 import）
 */
import { fsrs, createEmptyCard, Rating } from "ts-fsrs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const tmp = mkdtempSync(path.join(tmpdir(), "fsrs-verify-"));
execSync(
  `pnpm exec tsc "${path.resolve("src/lib/fsrs.ts")}" --target es2022 --module commonjs --outDir "${tmp}"`,
  { stdio: "pipe" }
);
const mod = await import(`file://${path.join(tmp, "fsrs.js").replaceAll("\\", "/")}`);
const { schedule, forgettingCurve } = mod.default ?? mod;

const ref = fsrs({ enable_short_term: false, enable_fuzz: false, request_retention: 0.9 });
const GRADE_TO_RATING = { again: Rating.Again, fuzzy: Rating.Good, easy: Rating.Easy };

let failures = 0;
function compare(label, mine, theirs) {
  const dd = Math.abs(mine.difficulty - theirs.card.difficulty);
  const ds = Math.abs(mine.stability - theirs.card.stability);
  if (dd >= 1e-6 || ds >= 1e-6) {
    failures++;
    console.log(`FAIL ${label}: D mine=${mine.difficulty} ref=${theirs.card.difficulty} | S mine=${mine.stability} ref=${theirs.card.stability}`);
  } else {
    console.log(`PASS ${label}: D=${mine.difficulty.toFixed(4)} S=${mine.stability.toFixed(4)} ivl(ref)=${theirs.card.scheduled_days}d`);
  }
}

const day0 = new Date(2026, 9, 17); // 本地 2026-10-17 00:00（用本地字段，避免 UTC 偏移）
const dayAt = (offset) => {
  const d = new Date(day0);
  d.setDate(d.getDate() + offset);
  return d;
};
const pad = (n) => String(n).padStart(2, "0");
const dayStr = (offset) => {
  const d = dayAt(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 单序列：steps = [[gradeName, 评分子偏移], ...]（偏移递增，同日连评允许相等） */
function runSequence(name, steps) {
  let card = createEmptyCard(dayAt(0));
  let mine = { difficulty: 0, stability: 0, lastReview: null };
  for (let i = 0; i < steps.length; i++) {
    const [grade, offset] = steps[i];
    const log = ref.repeat(card, dayAt(offset))[GRADE_TO_RATING[grade]];
    const next = schedule(mine, grade, dayStr(offset));
    compare(`${name}[${i}] ${grade}@d${offset}`, next, log);
    if (grade !== "again" && next.intervalDays !== log.card.scheduled_days) {
      failures++;
      console.log(`FAIL ${name}[${i}] interval: mine=${next.intervalDays} ref=${log.card.scheduled_days}`);
    }
    card = log.card;
    mine = { difficulty: next.difficulty, stability: next.stability, lastReview: next.lastReview };
  }
}

// 遗忘曲线自检：R(S)=0.9（稳定度的定义基准）
const rAtS = forgettingCurve(2.3065, 2.3065);
if (Math.abs(rAtS - 0.9) > 1e-6) {
  failures++;
  console.log(`FAIL forgetting_curve R(S)=${rAtS}`);
} else {
  console.log("PASS forgetting_curve R(S)=0.9");
}

const newCard = { difficulty: 0, stability: 0, lastReview: null };
console.log(
  `INFO 新卡首评 interval: again→${schedule(newCard, "again").intervalDays}d(当日重见) fuzzy→${schedule(newCard, "fuzzy").intervalDays}d easy→${schedule(newCard, "easy").intervalDays}d`
);

runSequence("连续easy", [["easy", 0], ["easy", 8], ["easy", 24], ["easy", 61]]);
runSequence("fuzzy+again", [["fuzzy", 0], ["fuzzy", 2], ["again", 8], ["fuzzy", 9], ["fuzzy", 15]]);
runSequence("难卡", [["again", 0], ["fuzzy", 1], ["fuzzy", 4], ["easy", 12]]);
runSequence("迟评", [["easy", 0], ["easy", 38]]);
runSequence("混合", [["fuzzy", 0], ["easy", 2], ["fuzzy", 9], ["again", 20], ["easy", 21], ["fuzzy", 35], ["easy", 52]]);
runSequence("同日连评", [["easy", 0], ["easy", 0], ["fuzzy", 1]]);

rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
