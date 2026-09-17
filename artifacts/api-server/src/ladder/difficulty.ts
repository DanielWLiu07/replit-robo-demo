import { BRAIN_WEIGHT_BUDGET, CHASSIS_STATS, type Chassis } from "@workspace/contract";

/**
 * The difficulty curve, in one place so it can be argued with.
 *
 * Difficulty is **selection pressure**, not crippled opponents.
 *
 * The obvious design — starve early rounds of synaptic weight — was measured
 * and does not work. A fly with a tiny budget is not easy, it is ineffectual:
 * neither side can finish, roughly half of round-1 fights hit the 90-second cap
 * (median 62-78s across three variants) and the player "wins" a stalemate on
 * hull. Raising the budget fixed the pacing and immediately made round 1 a coin
 * flip at 44%. Budget was controlling both fight quality and difficulty, and
 * the two want opposite things.
 *
 * So they are separated. Every opponent gets a *working* brain, which keeps
 * fights short and decisive. Difficulty comes from where in the scored field
 * the opponent is drawn: several candidates are generated and fought against
 * your actual bot, then round 1 sends the one that did **worst** and round 13
 * sends the one that did **best**.
 *
 * That is a real selection gradient — the cheap half of the same neuroevolution
 * the trainer runs — and it degrades honestly. There is no hidden stat
 * inflation: the opponent is always a brain you could legally have built.
 */
export interface RoundPlan {
  budgetFraction: number;
  candidates: number;
  /**
   * Where in the scored field to take the opponent from: 0 keeps the *worst*
   * candidate, 1 the best. This is the difficulty axis.
   */
  selection: number;
  chassis: Chassis;
}

/** Rounds over which the curve climbs from "warm-up" to "full strength". */
const RAMP = 15;

/** 0 at round 1, 1 once the curve has topped out. */
export function progressAt(round: number): number {
  return Math.min(1, Math.max(0, (round - 1) / RAMP));
}

/**
 * Chassis is a difficulty lever in its own right, and a blunt one: a TANK has
 * 150 hull against a DRONE's 70, and the 90-second tiebreak is hull fraction,
 * so a TANK that merely survives beats you. Measured, TANK rounds were the
 * sharpest spikes in the curve (27% at round 4, 0% at round 12). Alternating it
 * round to round also made the curve sawtooth — 80% at round 5, 33% at round 6 —
 * which reads as randomness rather than escalation.
 *
 * So it moves in tiers, and the order is not the obvious one. DRONEs are the
 * *fragile* chassis, which looks like the right warm-up until you measure it:
 * a DRONE is also the fastest, so a weak one simply runs away and half of all
 * round-1 fights hit the 90-second cap (median 62s) with the player winning a
 * stalemate on hull. Fragile is no use if you cannot catch it.
 *
 * So the ladder opens on HORNETs — catchable and killable — then DRONEs, whose
 * evasion is a different kind of problem, then TANKs late, where a wall is
 * supposed to feel like a wall.
 */
function chassisFor(round: number): Chassis {
  if (round <= 5) return "HORNET";
  if (round <= 11) return "DRONE";
  return "TANK";
}

/** The chassis the curve is calibrated against. */
const REFERENCE_HULL = CHASSIS_STATS.DRONE.hull;

/**
 * A tier change hands the opponent more hull, and hull is worth a great deal:
 * moving from DRONE to HORNET is +43%, and the 90-second tiebreak rewards
 * simply not dying. Measured, the un-compensated tier boundary was a cliff —
 * 80% at round 5 to 33% at round 6 — which ends runs on a coin flip rather than
 * on the climb.
 *
 * So a tougher chassis buys a *smaller* brain budget. The exponent makes it a
 * partial refund: a tier still costs you something, it just is not a wall.
 * Tuned to 0.7 by measuring the win rate either side of the boundary.
 */
function chassisHandicap(chassis: Chassis): number {
  return (REFERENCE_HULL / CHASSIS_STATS[chassis].hull) ** 0.7;
}

export function planRound(round: number): RoundPlan {
  const chassis = chassisFor(round);
  // Difficulty in abstract units, then spent according to what the chassis costs.
  //
  // Healthy from round 1 so fights resolve; see the note above.
  const base = 0.40 + 0.030 * (round - 1);
  return {
    budgetFraction: Math.min(1, +(base * chassisHandicap(chassis)).toFixed(3)),
    // A field to choose from. Wider later, so "best of" means more.
    candidates: Math.min(8, 3 + Math.floor((round - 1) / 2)),
    // Never the very bottom of the field. Taking the single worst candidate
    // reliably finds a fly so useless that nobody can finish it — measured at
    // 16 of 25 round-1 fights hitting the 90-second cap. The pathological tail
    // is not "easy", it is broken, so the curve starts above it and climbs to
    // the best of the field by round 13.
    selection: Math.min(1, 0.35 + 0.65 * ((round - 1) / 12)),
    chassis,
  };
}

/** Weight the opponent may spend at this round. */
export function budgetFor(plan: RoundPlan): number {
  return BRAIN_WEIGHT_BUDGET * plan.budgetFraction;
}
