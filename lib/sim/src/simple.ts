import { BRAIN_WEIGHT_BUDGET, type BrainSpec, type ModuleSlot, type NeuronModule } from "@workspace/contract";

/**
 * One dial per circuit instead of two.
 *
 * Weight and threshold are the honest parameters, but they are also two abstract
 * numbers pulling in opposite directions, and asking a player to reason about both
 * is asking them to do the model's job. In practice you only ever want one thing:
 * how readily should this instinct fire.
 *
 * So: a single 0..1 INTENSITY per circuit. Turning it up raises the gain and lowers
 * the threshold together, which is what "more of this reflex" actually means. The
 * full pair stays available underneath for anyone who wants it.
 */

/** Sensible operating range, measured rather than guessed — see docs/PLAN.md. */
const WEIGHT_MIN = 0.4, WEIGHT_MAX = 3.2;
const THRESHOLD_HI = 1.15;   // timid: needs a lot of evidence
const THRESHOLD_LO = 0.45;   // twitchy: fires on a hint

export const toSlot = (module: NeuronModule, intensity: number): ModuleSlot => {
  const t = Math.max(0, Math.min(1, intensity));
  return {
    module,
    weight: +(WEIGHT_MIN + (WEIGHT_MAX - WEIGHT_MIN) * t).toFixed(2),
    threshold: +(THRESHOLD_HI + (THRESHOLD_LO - THRESHOLD_HI) * t).toFixed(2),
  };
};

/** Recover the dial position from a slot, so the UI can round-trip an existing brain. */
export const toIntensity = (slot: ModuleSlot): number =>
  Math.max(0, Math.min(1, (slot.weight - WEIGHT_MIN) / (WEIGHT_MAX - WEIGHT_MIN)));

/**
 * Build a legal brain from nothing but a list of (circuit, intensity) pairs.
 * Scales everything down proportionally if the budget is blown, so the UI can never
 * hand the schema something it will reject — the player just sees the bars shrink.
 */
export function simpleBrain(
  picks: Array<{ module: NeuronModule; intensity: number }>,
  opts: { leak?: number; refractory?: number } = {},
): BrainSpec {
  let slots = picks.slice(0, 5).map((p) => toSlot(p.module, p.intensity));
  const total = slots.reduce((s, x) => s + x.weight, 0);
  if (total > BRAIN_WEIGHT_BUDGET) {
    // Scale to just under the cap and round DOWN. Rounding each weight to 2dp after
    // scaling can add back up to 0.005 per slot, which is enough to push a five-slot
    // brain over the budget and get it rejected by the schema — invisible in the UI,
    // and it would only show up as a launch that silently failed.
    const k = (BRAIN_WEIGHT_BUDGET - 0.05) / total;
    slots = slots.map((s) => ({
      ...s,
      weight: Math.max(0.05, Math.floor(s.weight * k * 100) / 100),
    }));
  }
  return {
    slots: slots.length ? slots : [toSlot("LC10A", 0.6)],
    membraneLeak: opts.leak ?? 0.2,
    refractoryTicks: opts.refractory ?? 3,
  };
}

/** Budget left, 0..1, for a spend bar. */
export const budgetUsed = (b: BrainSpec) =>
  b.slots.reduce((s, x) => s + x.weight, 0) / BRAIN_WEIGHT_BUDGET;
