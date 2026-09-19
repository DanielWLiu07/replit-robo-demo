import {
  BRAIN_MAX_SLOTS,
  BRAIN_WEIGHT_BUDGET,
  BrainSpec,
  NeuronModule,
  type BrainSpec as BrainSpecT,
  type ModuleSlot,
} from "@workspace/contract";
import { randomBrain } from "@workspace/sim";
import { budgetFor, progressAt, type RoundPlan } from "./difficulty";

/**
 * Generating an opponent is not the same as rolling a random brain.
 *
 * A purely random loadout usually has no steering neuron, or nothing that can
 * see a target, so it drifts until the walls close in. Measured over 8 runs,
 * that produced 9 of 17 fights hitting the 90-second cap with a mean length of
 * 68s, and, worse, a passive TANK *wins* those, because the timeout tiebreak
 * is hull fraction and a fly that never fights never takes damage. The ladder
 * was ending at round 1 to opponents that did nothing.
 *
 * So every generated fly is guaranteed a way to engage: DNa02 to steer, and a
 * target cell to steer at. That is the same lesson the hand-built roster
 * taught, a bot without DNa02 cannot turn toward anything, applied to
 * generated brains. Everything else stays random.
 */

/** Steering. Without it a fly cannot turn toward anything. */
const STEER: NeuronModule = "DNA02";
/** Something to steer at. */
const TARGETS: NeuronModule[] = ["LC10A", "LC11"];
/**
 * Reverse. A strong MDN makes a fly back away every time it sees anything, and
 * a ladder full of kiters is a ladder of 90-second chases nobody can finish.
 * It stays available as spice, reversing out of a losing exchange is real fly
 * behaviour, but it is not allowed to be the whole personality.
 */
const REVERSE: NeuronModule = "MDN";
const REVERSE_MAX_WEIGHT = 0.5;

function upsert(
  slots: ModuleSlot[],
  module: NeuronModule,
  weight: number,
  threshold: number,
): void {
  const existing = slots.find((s) => s.module === module);
  if (existing) {
    // Present but feeble is the same as absent; give it enough to work.
    existing.weight = Math.max(existing.weight, weight);
    existing.threshold = Math.min(existing.threshold, threshold);
    return;
  }
  if (slots.length < BRAIN_MAX_SLOTS) {
    slots.push({ module, weight, threshold });
    return;
  }
  // Full: displace the least-invested slot rather than exceeding the cap.
  let weakest = 0;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]!.weight < slots[weakest]!.weight) weakest = i;
  }
  slots[weakest] = { module, weight, threshold };
}

/**
 * Bring the total at or under `cap`, deterministically and without ever going
 * over. Scaling rounds *down* (floor, not round) because rounding up five slots
 * by half a thousandth each is enough to breach the contract's ceiling, which
 * is exactly how the first version of this failed BrainSpec validation. Any
 * residue left by the per-slot minimum comes off the heaviest slot.
 */
function clampTotal(slots: ModuleSlot[], cap: number): ModuleSlot[] {
  const sum = () => slots.reduce((s, x) => s + x.weight, 0);
  if (sum() <= cap) return slots;

  const k = cap / sum();
  for (const s of slots) {
    s.weight = Math.max(0.05, Math.floor(s.weight * k * 1000) / 1000);
  }

  // The 0.05 minimum can still leave us over on a brain of tiny slots.
  let guard = 0;
  while (sum() > cap && guard++ < BRAIN_MAX_SLOTS) {
    const heaviest = slots.reduce((a, b) => (b.weight > a.weight ? b : a));
    const excess = sum() - cap;
    heaviest.weight = Math.max(0.05, +(heaviest.weight - excess).toFixed(3));
  }
  return slots;
}

/**
 * Fit inside the round's budget, trimming the non-core slots first so the
 * engagement path survives. Core slots keep a floor: a bot that cannot steer
 * is not an easier opponent, it is a broken one.
 */
function fitBudget(slots: ModuleSlot[], budget: number, floor: number): ModuleSlot[] {
  const isCore = (s: ModuleSlot) => s.module === STEER || TARGETS.includes(s.module);
  const sum = () => slots.reduce((s, x) => s + x.weight, 0);
  if (sum() <= budget) return clampTotal(slots, BRAIN_WEIGHT_BUDGET);

  // Spend the budget on the engagement path first, extras get what is left.
  const coreTotal = slots.filter(isCore).reduce((s, x) => s + x.weight, 0);
  const extras = slots.filter((s) => !isCore(s));
  const extrasTotal = extras.reduce((s, x) => s + x.weight, 0);
  const extrasBudget = Math.max(0, budget - coreTotal);

  if (extrasTotal > 0 && extrasBudget < extrasTotal) {
    const k = extrasBudget / extrasTotal;
    for (const s of extras) {
      s.weight = Math.max(0.05, Math.floor(s.weight * k * 1000) / 1000);
    }
  }

  if (sum() > budget) {
    // The core alone exceeds the budget: scale everything, but never take a
    // core slot below the floor that keeps it functional.
    const k = budget / sum();
    for (const s of slots) {
      const min = isCore(s) ? floor : 0.05;
      s.weight = Math.max(min, Math.floor(s.weight * k * 1000) / 1000);
    }
  }

  // Whatever happened above, the contract's ceiling is absolute.
  return clampTotal(slots, BRAIN_WEIGHT_BUDGET);
}

/**
 * One candidate opponent brain. Deterministic in `rng`, and validated against
 * BrainSpec on the way out, a generated loadout gets no exemption from the
 * schema a human loadout has to satisfy.
 */
export function generateCandidate(
  rng: () => number,
  plan: RoundPlan,
  round: number,
): BrainSpecT {
  const t = progressAt(round);
  const base = randomBrain(rng);
  const slots: ModuleSlot[] = base.slots.map((s) => ({ ...s }));

  // Weight carries the difficulty; threshold stays low at every round.
  //
  // The first attempt raised thresholds to make early flies easy, which made
  // them *inert* instead of *fragile*: they never fired, never closed, never
  // died, and round 1 became a 90-second stalemate the player won on hull,
  // 10 of 25 round-1 fights hit the cap, median 57s. An easy opponent should
  // charge in and lose quickly, not stand still. So early flies commit just as
  // readily as late ones, they simply have far less to commit with.
  const coreWeight = 0.45 + 1.25 * t;
  const coreThreshold = Math.max(0.35, 0.9 - 0.35 * t);
  const floor = 0.3;

  upsert(slots, STEER, coreWeight, coreThreshold);
  if (!slots.some((s) => TARGETS.includes(s.module))) {
    upsert(slots, TARGETS[Math.floor(rng() * TARGETS.length)]!, coreWeight, coreThreshold);
  } else {
    const target = slots.find((s) => TARGETS.includes(s.module))!;
    target.weight = Math.max(target.weight, coreWeight * 0.8);
  }

  const reverse = slots.find((s) => s.module === REVERSE);
  if (reverse) reverse.weight = Math.min(reverse.weight, REVERSE_MAX_WEIGHT);

  return BrainSpec.parse({
    ...base,
    slots: fitBudget(slots, budgetFor(plan), floor),
  });
}

/**
 * Build the field for a round and take the candidate at the round's selection
 * point: worst early, best late. `score` comes from fighting the player's
 * actual fly, so a late opponent is tuned to beat *you*, not tuned in general.
 */
export function pickOpponentBrain(
  rng: () => number,
  plan: RoundPlan,
  round: number,
  score: (brain: BrainSpecT) => number,
): { brain: BrainSpecT; chosenScore: number; fieldLow: number; fieldHigh: number } {
  const field = Array.from({ length: plan.candidates }, () => {
    const brain = generateCandidate(rng, plan, round);
    return { brain, score: score(brain) };
  }).sort((a, b) => a.score - b.score);

  const index = Math.min(
    field.length - 1,
    Math.max(0, Math.round(plan.selection * (field.length - 1))),
  );
  const chosen = field[index]!;
  return {
    brain: chosen.brain,
    chosenScore: +chosen.score.toFixed(2),
    fieldLow: +field[0]!.score.toFixed(2),
    fieldHigh: +field[field.length - 1]!.score.toFixed(2),
  };
}
