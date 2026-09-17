import { BODY_BY_CHASSIS, BodySpec, CHASSIS_STATS, type BotSpec } from "@workspace/contract";
import { runMatch } from "./arena.js";
import { bodyRatios, resolveBody } from "./body.js";

/**
 * Find a better body by FIGHTING with it.
 *
 * The bench could have scored a build off a formula, and that would have been a
 * lie dressed as analysis: the thing that decides whether long arms beat heavy
 * hands is the arena, with its pocket discipline, its stamina drain and its
 * knockdowns, not a weighted sum we chose. So this runs real matches — the same
 * `runMatch` the fight screen streams — and climbs on what actually wins.
 *
 * Coordinate ascent rather than anything cleverer, for two reasons: there are only
 * four parameters, and every evaluation costs ~24ms of simulation, so the budget is
 * spent on more SEEDS per candidate instead of more candidates. A noisy score that
 * ranks candidates wrongly is worse than a coarse search that ranks them right.
 *
 * It yields after every candidate so a browser can drive it a slice at a time and
 * draw progress, instead of freezing for a few seconds.
 */

export interface TuneStep {
  done: number;
  total: number;
  best: BodySpec;
  bestScore: number;
  /** the candidate just evaluated, so the panel can show the search moving */
  trying: BodySpec;
  tryingScore: number;
}

const KEYS = ["mass", "reach", "torque", "stance"] as const;
type Key = (typeof KEYS)[number];

/** Each axis's full range, straight off the schema so the two can never disagree. */
const RANGE: Record<Key, readonly [number, number]> = {
  mass: [48, 124],
  reach: [0.4, 0.76],
  torque: [55, 200],
  stance: [0.24, 0.64],
};

const clampBody = (b: BodySpec): BodySpec => {
  const out = { ...b };
  for (const k of KEYS) {
    const [lo, hi] = RANGE[k];
    out[k] = Math.max(lo, Math.min(hi, out[k]));
  }
  return out;
};

const maxHull = (spec: BotSpec) =>
  CHASSIS_STATS[spec.chassis].hull * bodyRatios(spec.chassis, spec.body).hull;

/**
 * How well `body` does against `foe`, averaged over seeds and both corners.
 *
 * Hull margin rather than win/loss: a win rate over a handful of matches is mostly
 * noise, while "how much of him was left" moves smoothly with the parameters and
 * gives the climb something to follow. A KO still dominates, because the loser's
 * fraction is zero.
 */
function score(bot: BotSpec, body: BodySpec, foe: BotSpec, seeds: number): number {
  const me: BotSpec = { ...bot, body };
  const myMax = maxHull(me), foeMax = maxHull(foe);
  let total = 0;
  for (let s = 0; s < seeds; s++) {
    // Both corners of every seed. Spawn positions are not symmetric, and a body
    // that only wins from one side has not learned anything.
    for (const flip of [false, true]) {
      const [a, b] = flip ? [foe, me] : [me, foe];
      const g = runMatch(`tune-${s}`, a, b);
      let r = g.next(), last = r.value;
      while (!r.done) { last = r.value; r = g.next(); }
      const frame = last as { bots?: Array<{ hull: number }> } | undefined;
      const bots = frame?.bots ?? [];
      const mine = flip ? bots[1] : bots[0];
      const theirs = flip ? bots[0] : bots[1];
      total += (mine ? mine.hull / myMax : 0) - (theirs ? theirs.hull / foeMax : 0);
    }
  }
  return total / (seeds * 2);
}

export function* tuneBody(
  bot: BotSpec,
  foe: BotSpec,
  opts: { seeds?: number; passes?: number } = {},
): Generator<TuneStep, { body: BodySpec; score: number }, void> {
  const seeds = opts.seeds ?? 3;
  const passes = opts.passes ?? 2;

  let best = clampBody(resolveBody(bot.chassis, bot.body));
  let bestScore = score(bot, best, foe, seeds);
  // step shrinks each pass: find the neighbourhood, then refine inside it
  const total = passes * KEYS.length * 2 + 1;
  let done = 1;
  yield { done, total, best, bestScore, trying: best, tryingScore: bestScore };

  for (let pass = 0; pass < passes; pass++) {
    const shrink = 1 / (pass + 1);
    for (const k of KEYS) {
      const [lo, hi] = RANGE[k];
      const step = (hi - lo) * 0.22 * shrink;
      for (const dir of [1, -1]) {
        const trying = clampBody({ ...best, [k]: best[k] + dir * step });
        const tryingScore = score(bot, trying, foe, seeds);
        done++;
        if (tryingScore > bestScore) {
          best = trying;
          bestScore = tryingScore;
        }
        yield { done, total, best, bestScore, trying, tryingScore };
      }
    }
  }
  return { body: best, score: bestScore };
}

/** The stock build for a chassis, for the bench's RESET. */
export const stockBody = (bot: BotSpec): BodySpec => BODY_BY_CHASSIS[bot.chassis];
export { BodySpec };
