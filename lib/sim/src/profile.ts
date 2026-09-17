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

export function profileBrain(brain: BrainSpec, chassis: BotSpec["chassis"]): BotProfile {
  const w = (m: NeuronModule) => brain.slots.find((s) => s.module === m)?.weight ?? 0;
  const thr = (m: NeuronModule) => brain.slots.find((s) => s.module === m)?.threshold ?? 5;

  const aggression = clamp100((w("LC10A") * 26) + (w("P1") * 18));
  const evasion    = clamp100((w("LPLC2_DNP01") * 28) + (w("MDN") * 14));
  const tracking   = clamp100((w("LC11") * 24) + (w("DNA02") * 20));
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
