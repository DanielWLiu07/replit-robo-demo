import {
  BRAIN_MAX_SLOTS,
  BRAIN_WEIGHT_BUDGET,
  type BrainSpec,
  type NeuronModule,
} from "@workspace/contract";
import { STAT_GAINS, profileBrain, type StatName } from "./profile.js";
import { WEIGHT_MAX, WEIGHT_MIN, toSlot } from "./simple.js";

/** Threshold on the placeholder circuit of an unspent brain. Never reached: its
 *  weight is zero, so nothing drives the cell. Sits mid-range so that the first
 *  point the player spends moves it in the direction the dial implies. */
const THRESHOLD_REST = 0.8;

/**
 * Stat targets in, a legal brain out.
 *
 * The old lab asked the player to pick circuits off a shelf, which is the model's
 * job dressed up as a choice: you cannot tell from "LC11 / 127 cells" whether you
 * want it. What a player actually has an opinion about is how the fly should
 * FIGHT, press forward, stay out of reach, hold the line, and the interesting
 * part is that you cannot have all three.
 *
 * That makes this a real constrained optimisation, not a menu. `profileBrain` is
 * linear in the slot weights, so the inverse is exact rather than a search:
 *
 *     aggression = 26·w(LC10A)       + 18·w(P1)
 *     evasion    = 28·w(LPLC2_DNP01) + 14·w(MDN)
 *     tracking   = 24·w(LC11)        + 20·w(DNA02)
 *
 *   subject to   Σw ≤ 8      (BRAIN_WEIGHT_BUDGET)
 *                w ≤ 3.2     per circuit
 *                ≤ 5 circuits installed, out of 6 that exist
 *
 * Maxing all three costs 12.4 weight across 6 circuits. The budget is 8 and the
 * chassis holds 5. So every build is a decision about what to give up, and the
 * panel can show the player exactly what their ask costs before they commit.
 */

export interface StatTargets {
  aggression: number;
  evasion: number;
  tracking: number;
}

export interface Solution {
  brain: BrainSpec;
  /** what the brain ACTUALLY scores, read back off the result, never assumed */
  achieved: StatTargets;
  /** weight each stat consumed */
  spend: Record<StatName, number>;
  used: number;
  /** false when the budget could not cover the ask and targets were scaled down */
  feasible: boolean;
  /** how far every target had to be scaled to fit, 1 = untouched */
  scale: number;
  /** circuits the solver wanted but could not install, and why */
  dropped: Array<{ module: NeuronModule; reason: "too-small" | "no-slot" }>;
}

export const STAT_NAMES: readonly StatName[] = ["aggression", "evasion", "tracking"];

/**
 * The cheapest way to buy `points` of one stat.
 *
 * Fill the higher-gain circuit to its cap, then spill into the weaker one. This is
 * optimal because the constraint is a plain sum and the gains are constant, so
 * there is never a reason to buy a point from the more expensive circuit while the
 * cheaper one still has room.
 */
export function planStat(stat: StatName, points: number) {
  const plan: Array<{ module: NeuronModule; weight: number; gain: number }> = [];
  let need = Math.max(0, points);
  for (const [module, gain] of STAT_GAINS[stat]) {
    if (need <= 1e-9) break;
    const weight = Math.min(WEIGHT_MAX, need / gain);
    plan.push({ module, weight, gain });
    need -= weight * gain;
  }
  const weight = plan.reduce((s, p) => s + p.weight, 0);
  // `shortfall` is what the weight cap alone could not deliver, before the budget
  // is even considered, a stat asked past its own ceiling.
  return { plan, weight, shortfall: need };
}

/** Highest value of a stat reachable at all, ignoring what the other two want. */
export const statCeiling = (stat: StatName): number =>
  Math.min(100, Math.round(STAT_GAINS[stat].reduce((s, [, g]) => s + WEIGHT_MAX * g, 0)));

/** Weight a target costs right now, what the panel prints next to each slider. */
export const statCost = (stat: StatName, points: number): number =>
  planStat(stat, points).weight;

const totalWeight = (targets: StatTargets, scale: number) =>
  STAT_NAMES.reduce((s, n) => s + planStat(n, targets[n] * scale).weight, 0);

export function solveBrain(
  targets: StatTargets,
  opts: { leak?: number; refractory?: number } = {},
  /** Weight the player may actually spend, grows as the campaign is cleared. */
  budget: number = BRAIN_WEIGHT_BUDGET,
): Solution {
  // Scale every target by the SAME factor until the plan fits. Proportional
  // scaling preserves the balance between stats, which is the thing the player
  // actually chose; funding one stat by starving another would silently replace
  // their build with a different one.
  //
  // Cost is monotone in the scale factor (piecewise linear, convex at each spill
  // point), so a bisection lands on the boundary exactly. 40 steps is far past the
  // precision a 2dp weight can hold.
  let scale = 1;
  if (totalWeight(targets, 1) > budget) {
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (totalWeight(targets, mid) > budget) hi = mid;
      else lo = mid;
    }
    scale = lo;
  }

  const spend = { aggression: 0, evasion: 0, tracking: 0 } as Record<StatName, number>;
  const dropped: Solution["dropped"] = [];
  let wanted: Array<{ module: NeuronModule; weight: number; value: number }> = [];

  for (const name of STAT_NAMES) {
    const { plan, weight } = planStat(name, targets[name] * scale);
    spend[name] = weight;
    for (const p of plan) {
      /**
       * Below WEIGHT_MIN a circuit cannot be expressed as an intensity, so it used
       * to be dropped outright, and dropping it deletes the points the player just
       * spent on it. Measured across every way of spending the pool, the worst case
       * loses 17: ask for 90/10/40 and the 10 of evasion buys LPLC2 at 0.357 weight,
       * under the floor, so evasion comes back 0. The dial snaps to nothing and the
       * points are neither on the fly nor back in the pool.
       *
       * The smallest amount of a stat that EXISTS is therefore WEIGHT_MIN * gain,
       * 11 evasion, 10 aggression, 10 tracking. Asking for less than that is asking
       * for something unbuildable, and the honest answer is the minimum, not zero:
       * round up to the floor when the budget can still carry it. The pool charges
       * what the brain ACHIEVES, not what was asked, so the extra is accounted for
       * and the player sees the dial settle on the real number.
       */
      if (p.weight < WEIGHT_MIN) {
        const spent = wanted.reduce((a, x) => a + x.weight, 0);
        if (spent + WEIGHT_MIN > BRAIN_WEIGHT_BUDGET) {
          dropped.push({ module: p.module, reason: "too-small" });
          continue;
        }
        wanted.push({ module: p.module, weight: WEIGHT_MIN, value: WEIGHT_MIN * p.gain });
        continue;
      }
      wanted.push({ module: p.module, weight: p.weight, value: p.weight * p.gain });
    }
  }

  // Six circuits exist, five fit. When the ask needs all six, the one contributing
  // the fewest stat points is the one to lose.
  if (wanted.length > BRAIN_MAX_SLOTS) {
    wanted.sort((a, b) => b.value - a.value);
    for (const cut of wanted.slice(BRAIN_MAX_SLOTS))
      dropped.push({ module: cut.module, reason: "no-slot" });
    wanted = wanted.slice(0, BRAIN_MAX_SLOTS);
  }

  const slots = wanted.map((x) =>
    toSlot(x.module, (x.weight - WEIGHT_MIN) / (WEIGHT_MAX - WEIGHT_MIN)),
  );

  /**
   * `toSlot` rounds each weight to 2dp, and rounding is not free: three slots each
   * rounded UP can push the total past BRAIN_WEIGHT_BUDGET even though the plan the
   * bisection found fits exactly. Measured over the ask space, 17 of 1331 asks came
   * out at 8.01 and were REJECTED by the schema, and because the lab only disables
   * its buttons on an invalid spec, the player saw a build they could not launch and
   * no reason why. Shave the overflow off the largest slot, which is the one whose
   * stat notices it least.
   */
  let total = slots.reduce((a, x) => a + x.weight, 0);
  if (total > BRAIN_WEIGHT_BUDGET && slots.length) {
    const big = slots.reduce((m, x) => (x.weight > m.weight ? x : m), slots[0]!);
    big.weight = +Math.max(WEIGHT_MIN, big.weight - (total - BRAIN_WEIGHT_BUDGET)).toFixed(2);
    total = slots.reduce((a, x) => a + x.weight, 0);
  }

  const brain: BrainSpec = {
    /**
     * A brain with no slots is not a legal brain, the schema demands at least one.
     * An empty ask therefore has to produce SOMETHING, and it used to get
     * `toSlot("LC10A", 0)`, whose intensity-zero still carries WEIGHT_MIN: 0.4 of
     * pursuit, which profiles as 10 aggression. So "spend nothing" silently spent
     * ten points, the dials could never be returned to zero, and a build that had
     * not been configured at all still walked into the ring swinging.
     *
     * A zero-WEIGHT slot is legal (the schema floors weight at 0, not WEIGHT_MIN)
     * and profiles as a true 0/0/0: a fly with the circuit present and no drive
     * through it. That is what an undistributed build should be.
     */
    slots: slots.length ? slots : [{ module: "LC10A", weight: 0, threshold: THRESHOLD_REST }],
    membraneLeak: opts.leak ?? 0.2,
    refractoryTicks: opts.refractory ?? 4,
  };

  // Read the stats back off the finished brain rather than reporting what we meant
  // to build. Rounding, the weight floor and the dropped slots all move the result,
  // and the panel must show the fly the player is actually taking into the ring.
  const p = profileBrain(brain, "DRONE");
  return {
    brain,
    achieved: { aggression: p.aggression, evasion: p.evasion, tracking: p.tracking },
    spend,
    used: brain.slots.reduce((s, x) => s + x.weight, 0),
    feasible: scale >= 0.999,
    scale,
    dropped,
  };
}

/**
 * Wins by refractory period: 216 matches, identical brains, only refractoryTicks
 * differs, three seeds per ordered pair so every level plays 48. Re-run with
 * `tsx lib/sim/src/__refractory.ts`. These are measured, not chosen, and they have
 * moved once already: they inverted when the boxing physics landed, because a long
 * refractory period used to be all cost and stamina is the benefit it was missing.
 * A neuron that never goes deaf throws every punch it can, gasses out, and gets
 * countered on an empty tank.
 */
export const REFRACTORY_WINS: ReadonlyArray<readonly [ticks: number, wins: number]> = [
  [0, 2], [1, 10], [2, 13], [4, 24], [6, 30], [9, 39], [14, 39], [20, 41], [30, 18],
];

/** The measured best, so "optimise" points at data instead of at taste. */
export const bestRefractory = (): number =>
  REFRACTORY_WINS.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

/** Nearest level actually measured. Never interpolate a number we did not run. */
export const nearestMeasured = (ticks: number): readonly [number, number] =>
  REFRACTORY_WINS.reduce((best, cur) =>
    Math.abs(cur[0] - ticks) < Math.abs(best[0] - ticks) ? cur : best,
  );
