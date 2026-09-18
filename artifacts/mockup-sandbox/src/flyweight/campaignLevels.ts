import type { BotSpec, BrainSpec, NeuronModule } from "@workspace/contract";
import { CHAMPION_BRAIN } from "./modules";

/**
 * The five levels, and the fly waiting at each one.
 *
 * Escalation is in the wiring, not in hidden multipliers: each opponent spends
 * more of the same synaptic budget the player spends, on the same six circuits,
 * so every fight is against a brain you could legally have built. Level five is
 * the evolved champion — the one neuroevolution actually produced.
 *
 * Every bot here carries DNa02 and a target cell. That is not decoration: a fly
 * with no steering neuron cannot turn toward anything, drifts until the walls
 * close in, and hands you a ninety-second staring contest instead of a fight.
 */
export interface CampaignLevel {
  round: number;
  title: string;
  bot: BotSpec;
}

const brain = (
  slots: Array<{ module: NeuronModule; weight: number; threshold: number }>,
  membraneLeak = 0.2,
  refractoryTicks = 4,
): BrainSpec => ({ slots, membraneLeak, refractoryTicks });

export const CAMPAIGN: CampaignLevel[] = [
  {
    round: 1,
    title: "FIRST CONTACT",
    // Commits, but lightly wired: something to land a punch on.
    bot: {
      id: "lvl1", name: "MIDGE", chassis: "HORNET",
      brain: brain([
        { module: "DNA02", weight: 1.4, threshold: 0.9 },
        { module: "LC10A", weight: 1.2, threshold: 1.0 },
      ], 0.26, 6),
    },
  },
  {
    round: 2,
    title: "THE SWARM",
    bot: {
      id: "lvl2", name: "GNAT", chassis: "DRONE",
      brain: brain([
        { module: "DNA02", weight: 1.9, threshold: 0.8 },
        { module: "LC10A", weight: 1.7, threshold: 0.9 },
        { module: "LC11", weight: 1.0, threshold: 1.1 },
      ], 0.22, 5),
    },
  },
  {
    round: 3,
    title: "DEEP CRATER",
    bot: {
      id: "lvl3", name: "HUSK", chassis: "HORNET",
      brain: brain([
        { module: "DNA02", weight: 2.3, threshold: 0.7 },
        { module: "LC10A", weight: 2.1, threshold: 0.8 },
        { module: "P1", weight: 1.4, threshold: 1.2 },
      ], 0.18, 4),
    },
  },
  {
    round: 4,
    title: "THE WALL",
    // A TANK: 150 hull. Attrition, and it does not get tired first.
    bot: {
      id: "lvl4", name: "BULWARK", chassis: "TANK",
      brain: brain([
        { module: "DNA02", weight: 2.4, threshold: 0.65 },
        { module: "LC10A", weight: 2.2, threshold: 0.75 },
        { module: "P1", weight: 1.8, threshold: 1.0 },
        { module: "LC11", weight: 1.2, threshold: 1.0 },
      ], 0.16, 3),
    },
  },
  {
    round: 5,
    title: "CHAMPION",
    // Not hand-built: 14 generations of neuroevolution against the archetypes.
    bot: { ...CHAMPION_BRAIN, id: "lvl5", name: "CHAMPION" },
  },
];

export const CAMPAIGN_LEVELS = CAMPAIGN.length;

export const levelFor = (round: number): CampaignLevel =>
  CAMPAIGN[Math.min(Math.max(1, round), CAMPAIGN_LEVELS) - 1]!;
