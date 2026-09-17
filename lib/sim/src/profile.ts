import { CHASSIS_STATS, type BotSpec, type BrainSpec, type NeuronModule } from "@workspace/contract";
import { CONNECTOME } from "./connectome.js";

/**
 * Derived stat bars for a roster / character-select screen.
 *
 * A fighting game shows you HP and speed before you pick. Here the interesting
 * numbers are behavioural: what the brain will actually *do* falls out of which
 * circuits are equipped and how hard they are wired, so we read the loadout and
 * turn it into the four bars a player can compare at a glance.
 */

export interface BotProfile {
  /** 0..100 bars */
  aggression: number;
  evasion: number;
  tracking: number;
  reflex: number;
  /** chassis-derived, also 0..100 for consistent bars */
  hull: number;
  speed: number;
  agility: number;
  /** one-line read on how it fights */
  playstyle: string;
  /** total cells across every equipped population — the "brain size" stat */
  neuronCount: number;
  modules: Array<{ module: NeuronModule; weight: number; cells: number; transmitter: string }>;
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * How much of one stat a single unit of synaptic weight buys, per circuit.
 *
 * `solveBrain` in optimize.ts INVERTS this table, so it has to be the only place
 * these numbers live. A coefficient edited here and not there would hand the player
 * a solver that quietly misses its own targets, and nothing would fail loudly.
 *
 * Each stat lists its circuits strongest-first, and the inverse depends on that
 * ordering: buying a point from the higher-gain circuit is always cheaper, so the
 * cheapest plan fills that one before spilling into the weaker one.
 */
export type StatName = "aggression" | "evasion" | "tracking";
export const STAT_GAINS: Record<StatName, ReadonlyArray<readonly [NeuronModule, number]>> = {
  aggression: [["LC10A", 26], ["P1", 18]],
  evasion: [["LPLC2_DNP01", 28], ["MDN", 14]],
  tracking: [["LC11", 24], ["DNA02", 20]],
};

export function profileBrain(brain: BrainSpec, chassis: BotSpec["chassis"]): BotProfile {
  const w = (m: NeuronModule) => brain.slots.find((s) => s.module === m)?.weight ?? 0;
  const thr = (m: NeuronModule) => brain.slots.find((s) => s.module === m)?.threshold ?? 5;

  const stat = (name: StatName) =>
    clamp100(STAT_GAINS[name].reduce((sum, [m, gain]) => sum + w(m) * gain, 0));
  const aggression = stat("aggression");
  const evasion    = stat("evasion");
  const tracking   = stat("tracking");
  // twitchiness: low thresholds and a short refractory period mean it acts sooner
  const eq = brain.slots.length || 1;
  const meanThr = brain.slots.reduce((a, s) => a + s.threshold, 0) / eq;
  const reflex = clamp100(100 - meanThr * 32 - (brain.refractoryTicks ?? 4) * 4.5);

  const stats = CHASSIS_STATS[chassis];
  const hull    = clamp100((stats.hull / 150) * 100);
  const speed   = clamp100((stats.accel / 1.4) * 100);
  const agility = clamp100((stats.turn / 1.6) * 100);

  const neuronCount = brain.slots.reduce((a, s) => a + CONNECTOME[s.module].count, 0);
  const modules = brain.slots.map((s) => ({
    module: s.module, weight: s.weight,
    cells: CONNECTOME[s.module].count,
    transmitter: CONNECTOME[s.module].neurotransmitter,
  }));

  // the dominant trait names the style; ties fall through in priority order
  const top = [
    ["aggression", aggression], ["evasion", evasion], ["tracking", tracking],
  ].sort((a, b) => (b[1] as number) - (a[1] as number))[0]![0] as string;
  const twitchy = reflex > 62;
  const playstyle =
    top === "evasion"
      ? (twitchy ? "Flinches early and often — hard to corner" : "Breaks away under pressure")
      : top === "tracking"
      ? (twitchy ? "Locks on fast and never loses the line" : "Patient, deliberate pursuit")
      : (twitchy ? "Commits instantly — all forward pressure" : "Grinds forward and wears you down");

  return { aggression, evasion, tracking, reflex, hull, speed, agility, playstyle, neuronCount, modules };
}

export const profileBot = (bot: BotSpec): BotProfile => profileBrain(bot.brain, bot.chassis);
