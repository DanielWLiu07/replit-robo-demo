import type { BotSpec, BrainSpec, NeuronModule } from "@workspace/contract";
import { CHAMPION_BRAIN } from "./modules";

/**
 * The five levels, and the fly waiting at each one.
 *
 * Escalation is in the wiring, not in hidden multipliers: each opponent spends
 * more of the same synaptic budget the player spends, on the same six circuits,
 * so every fight is against a brain you could legally have built. Level five is
 * the evolved champion, the one neuroevolution actually produced.
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
    // A DRONE: 70 hull, the fragile frame, wired barely enough to come at you.
    // This was a HORNET and it beat the TANK four times in five, level one
    // cannot be the fight that ends a run.
    bot: {
      id: "lvl1", name: "MIDGE", chassis: "DRONE",
      // Low thresholds so it commits and dies; weak WEIGHTS make it harmless,
      // but a high threshold just makes it inert, and an inert fly cannot be
      // finished: that read as a 73-second stalemate, not an easy first fight.
      brain: brain([
        { module: "DNA02", weight: 0.8, threshold: 0.75 },
        { module: "LC10A", weight: 0.65, threshold: 0.8 },
      ], 0.3, 6),
    },
  },
  {
    round: 2,
    title: "THE SWARM",
    bot: {
      id: "lvl2", name: "GNAT", chassis: "DRONE",
      brain: brain([
        { module: "DNA02", weight: 1.5, threshold: 0.9 },
        { module: "LC10A", weight: 1.3, threshold: 1.0 },
        { module: "LC11", weight: 0.8, threshold: 1.15 },
      ], 0.26, 6),
    },
  },
  {
    round: 3,
    title: "DEEP CRATER",
    bot: {
      id: "lvl3", name: "HUSK", chassis: "HORNET",
      brain: brain([
        { module: "DNA02", weight: 1.8, threshold: 0.85 },
        { module: "LC10A", weight: 1.6, threshold: 0.95 },
        { module: "P1", weight: 1.0, threshold: 1.3 },
      ], 0.22, 5),
    },
  },
  {
    round: 4,
    title: "THE WALL",
    /**
     * Still a wall, but a wall you can get through.
     *
     * This was a TANK, 150 hull against a DRONE's 70, with a strong brain on
     * top, and it measured 0% for both DRONE and HORNET: the campaign simply
     * ended here. Hull is the single most decisive stat in this sim, so the
     * heavy frame IS the challenge and its wiring has to give ground to pay for
     * it. Slow, durable, and beatable if you keep working.
     */
    bot: {
      id: "lvl4", name: "BULWARK", chassis: "TANK",
      brain: brain([
        { module: "DNA02", weight: 1.35, threshold: 1.0 },
        { module: "LC10A", weight: 1.15, threshold: 1.1 },
        { module: "P1", weight: 0.7, threshold: 1.4 },
      ], 0.3, 7),
    },
  },
  {
    round: 5,
    title: "CHAMPION",
    /**
     * The real evolved champion, 14 generations against the archetypes, but
     * flying a DRONE frame rather than its native one.
     *
     * Measured on the heavier frame it beat every class AND a fully tuned build
     * at least 92% of the time: a boss nobody can pass is not a boss, it is the
     * end of the game. The wiring is untouched, because that brain is the thing
     * worth showing; what it gives up is 30 hull. It still wins more often than
     * it loses, which is what a final level should do.
     */
    bot: { ...CHAMPION_BRAIN, id: "lvl5", name: "CHAMPION", chassis: "DRONE" },
  },
];

export const CAMPAIGN_LEVELS = CAMPAIGN.length;

export const levelFor = (round: number): CampaignLevel =>
  CAMPAIGN[Math.min(Math.max(1, round), CAMPAIGN_LEVELS) - 1]!;
