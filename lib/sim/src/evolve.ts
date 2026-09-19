import {
  BRAIN_MAX_SLOTS, BRAIN_WEIGHT_BUDGET, NeuronModule,
  type BotSpec, type BrainSpec, type Chassis, type ModuleSlot,
} from "@workspace/contract";
import { runMatch } from "./arena.js";
import { makeRng } from "./rng.js";

/**
 * Neuroevolution over spiking brains.
 *
 * Spikes are not differentiable, so there is no gradient to descend, evolution is
 * the standard tool for training spiking networks, and it is what the fly's own
 * circuits were shaped by. The deterministic simulator is what makes it work: a
 * (brain, opponent, seed) triple always yields the same match, so fitness is an
 * exact reproducible number rather than a noisy sample.
 */

const ALL_MODULES = NeuronModule.options;

export interface EvolveConfig {
  populationSize: number;
  generations: number;
  /** matches per opponent; more = less seed luck, linearly more cost */
  seedsPerOpponent: number;
  mutationRate: number;
  eliteCount: number;
  chassis: Chassis;
}

export const DEFAULT_CONFIG: EvolveConfig = {
  populationSize: 24, generations: 12, seedsPerOpponent: 2,
  mutationRate: 0.35, eliteCount: 3, chassis: "HORNET",
};

/** Force a loadout back inside the contract's rules after mutation. */
function repair(slots: ModuleSlot[]): ModuleSlot[] {
  const seen = new Set<NeuronModule>();
  let out = slots.filter((s) => (seen.has(s.module) ? false : (seen.add(s.module), true)))
                 .slice(0, BRAIN_MAX_SLOTS);
  if (out.length === 0) out = [{ module: "LC10A", weight: 2, threshold: 0.8 }];
  out = out.map((s) => ({
    module: s.module,
    weight: Math.min(4, Math.max(0.05, s.weight)),
    threshold: Math.min(5, Math.max(0.1, s.threshold)),
  }));
  const sum = (xs: ModuleSlot[]) => xs.reduce((a, s) => a + s.weight, 0);
  let total = sum(out);
  if (total > BRAIN_WEIGHT_BUDGET) {
    const k = BRAIN_WEIGHT_BUDGET / total;
    // Round DOWN, not to nearest. Rounding five slots to the nearest milli-unit can
    // round *up*, the schema's cap is inclusive, and the repaired brain is then
    // rejected by exactly the gate that is meant to keep evolution inside the
    // contract, an evolved champion that cannot be saved. Latent until a physics
    // change made a five-slot genome win: the boxing pass is what surfaced it.
    out = out.map((s) => ({ ...s, weight: Math.max(0.05, Math.floor(s.weight * k * 1000) / 1000) }));
    // The 0.05 floor can put a wide loadout back over on its own, so shave the
    // heaviest slot until it fits. Deterministic, and it always terminates: the
    // floor caps a full loadout at 0.25 total.
    while ((total = sum(out)) > BRAIN_WEIGHT_BUDGET) {
      const i = out.reduce((best, s, idx) => (s.weight > out[best]!.weight ? idx : best), 0);
      const shaved = out[i]!.weight - (total - BRAIN_WEIGHT_BUDGET) - 0.001;
      out[i] = { ...out[i]!, weight: Math.max(0.05, Math.floor(shaved * 1000) / 1000) };
    }
  }
  return out;
}

export function randomBrain(rng: () => number): BrainSpec {
  const n = 2 + Math.floor(rng() * (BRAIN_MAX_SLOTS - 1));
  const pool = [...ALL_MODULES].sort(() => rng() - 0.5).slice(0, n);
  return {
    slots: repair(pool.map((m) => ({
      module: m, weight: 0.5 + rng() * 2.5, threshold: 0.4 + rng() * 1.2,
    }))),
    membraneLeak: +(0.1 + rng() * 0.35).toFixed(3),
    refractoryTicks: 2 + Math.floor(rng() * 10),
  };
}

export function mutate(b: BrainSpec, rng: () => number, rate: number): BrainSpec {
  const slots = b.slots.map((s) => ({ ...s }));
  for (const s of slots) {
    if (rng() < rate) s.weight += (rng() - 0.5) * 1.1;
    if (rng() < rate) s.threshold += (rng() - 0.5) * 0.45;
    if (rng() < rate * 0.25) {
      const unused = ALL_MODULES.filter((m) => !slots.some((x) => x.module === m));
      if (unused.length) s.module = unused[Math.floor(rng() * unused.length)]!;
    }
  }
  if (rng() < rate * 0.4 && slots.length < BRAIN_MAX_SLOTS) {
    const unused = ALL_MODULES.filter((m) => !slots.some((x) => x.module === m));
    if (unused.length) slots.push({
      module: unused[Math.floor(rng() * unused.length)]!,
      weight: 0.5 + rng() * 1.5, threshold: 0.5 + rng() * 0.8,
    });
  }
  if (rng() < rate * 0.25 && slots.length > 1) slots.splice(Math.floor(rng() * slots.length), 1);
  return {
    slots: repair(slots),
    membraneLeak: Math.min(0.9, Math.max(0.05, b.membraneLeak! + (rng() < rate ? (rng() - 0.5) * 0.12 : 0))),
    refractoryTicks: Math.min(30, Math.max(0,
      b.refractoryTicks! + (rng() < rate ? Math.round((rng() - 0.5) * 5) : 0))),
  };
}

export function crossover(a: BrainSpec, b: BrainSpec, rng: () => number): BrainSpec {
  const merged: ModuleSlot[] = [];
  for (const m of ALL_MODULES) {
    const fromA = a.slots.find((s) => s.module === m);
    const fromB = b.slots.find((s) => s.module === m);
    const pick = fromA && fromB ? (rng() < 0.5 ? fromA : fromB) : (fromA ?? fromB);
    if (pick && rng() < 0.75) merged.push({ ...pick });
  }
  return {
    slots: repair(merged.length ? merged : a.slots.map((s) => ({ ...s }))),
    membraneLeak: rng() < 0.5 ? a.membraneLeak! : b.membraneLeak!,
    refractoryTicks: rng() < 0.5 ? a.refractoryTicks! : b.refractoryTicks!,
  };
}

/** Exact, reproducible fitness: total score over a fixed panel and fixed seeds. */
export function fitness(
  brain: BrainSpec, chassis: Chassis, panel: BotSpec[], seedsPerOpponent: number,
): { score: number; wins: number; losses: number } {
  const me: BotSpec = { id: "cand", name: "cand", chassis, brain };
  let score = 0, wins = 0, losses = 0;
  for (const foe of panel) {
    for (let k = 0; k < seedsPerOpponent; k++) {
      const g = runMatch(`ev-${foe.id}-${k}`, me, foe);
      let r = g.next(), lastA = 0, lastB = 0;
      while (!r.done) { lastA = r.value.bots[0].hull; lastB = r.value.bots[1].hull; r = g.next(); }
      const res = r.value;
      if (res.winnerBotId === "cand") { score += 3; wins++; }
      else if (res.winnerBotId === null) score += 1;
      else losses++;
      // margin breaks ties between brains with the same record
      score += Math.max(-1, Math.min(1, (lastA - lastB) / 120));
    }
  }
  return { score, wins, losses };
}

export interface GenerationReport {
  generation: number; bestScore: number; meanScore: number;
  bestWins: number; matches: number; best: BrainSpec;
}

export function evolve(
  panel: BotSpec[], cfg: Partial<EvolveConfig> = {}, seed = "evolution",
  onGeneration?: (r: GenerationReport) => void,
): { best: BrainSpec; history: GenerationReport[] } {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const rng = makeRng(seed);
  let pop = Array.from({ length: c.populationSize }, () => randomBrain(rng));
  const history: GenerationReport[] = [];
  let best = pop[0]!, bestScore = -Infinity;

  for (let gen = 0; gen < c.generations; gen++) {
    const scored = pop.map((b) => ({ b, ...fitness(b, c.chassis, panel, c.seedsPerOpponent) }))
                      .sort((x, y) => y.score - x.score);
    const top = scored[0]!;
    if (top.score > bestScore) { bestScore = top.score; best = top.b; }
    const report: GenerationReport = {
      generation: gen, bestScore: +top.score.toFixed(2),
      meanScore: +(scored.reduce((s, x) => s + x.score, 0) / scored.length).toFixed(2),
      bestWins: top.wins, matches: panel.length * c.seedsPerOpponent, best: top.b,
    };
    history.push(report); onGeneration?.(report);

    const elites = scored.slice(0, c.eliteCount).map((s) => s.b);
    const pool = scored.slice(0, Math.max(2, Math.floor(c.populationSize / 2)));
    const pick = () => pool[Math.floor(rng() * pool.length)]!.b;
    const next = [...elites];
    while (next.length < c.populationSize)
      next.push(mutate(crossover(pick(), pick(), rng), rng, c.mutationRate));
    pop = next;
  }
  return { best, history };
}
