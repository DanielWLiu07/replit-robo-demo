import type { BotSpec, BrainSpec, NeuronModule } from "@workspace/contract";
import { CHAMPION_BRAIN } from "./modules";

/**
 * The selectable roster. These are the same four hand-designed archetypes the
 * balance pass in `lib/sim` measures its round robin against, plus the evolved
 * champion as the boss — so a card's numbers are the numbers that fight.
 */
const brain = (
  slots: Array<{ module: NeuronModule; weight: number; threshold: number }>,
  membraneLeak = 0.2,
  refractoryTicks = 4,
): BrainSpec => ({ slots, membraneLeak, refractoryTicks });

export interface RosterEntry {
  bot: BotSpec;
  /** short read on the archetype, shown under the name */
  tag: string;
  boss?: boolean;
}

export const ROSTER: RosterEntry[] = [
  {
    tag: "FORWARD PRESSURE",
    bot: {
      id: "rusher",
      name: "RUSHER",
      chassis: "HORNET",
      brain: brain([
        { module: "LC10A", weight: 2.6, threshold: 0.6 },
        { module: "DNA02", weight: 2.4, threshold: 0.6 },
        { module: "P1", weight: 1.4, threshold: 1.0 },
      ]),
    },
  },
  {
    tag: "ESCAPE REFLEX",
    bot: {
      id: "dodger",
      name: "DODGER",
      chassis: "DRONE",
      brain: brain([
        { module: "LPLC2_DNP01", weight: 2.4, threshold: 0.5 },
        { module: "DNA02", weight: 2.2, threshold: 0.7 },
        { module: "LC10A", weight: 1.6, threshold: 0.9 },
      ]),
    },
  },
  {
    tag: "ATTRITION",
    bot: {
      id: "brawler",
      name: "BRAWLER",
      chassis: "TANK",
      brain: brain([
        { module: "LC10A", weight: 2.4, threshold: 0.7 },
        { module: "DNA02", weight: 1.6, threshold: 0.8 },
        { module: "MDN", weight: 1.4, threshold: 0.8 },
        { module: "P1", weight: 1.2, threshold: 1.1 },
      ]),
    },
  },
  {
    tag: "TARGET ACQUISITION",
    bot: {
      id: "sniper",
      name: "SNIPER",
      chassis: "HORNET",
      brain: brain([
        { module: "LC11", weight: 2.0, threshold: 0.6 },
        { module: "LC10A", weight: 2.2, threshold: 0.7 },
        { module: "DNA02", weight: 2.0, threshold: 0.7 },
      ]),
    },
  },
  {
    tag: "14 GENERATIONS / 20W 0L 0D",
    boss: true,
    bot: { ...CHAMPION_BRAIN, id: "champion", name: "CHAMPION" },
  },
];
