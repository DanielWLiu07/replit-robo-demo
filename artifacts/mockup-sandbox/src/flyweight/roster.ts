import type { BotSpec, BrainSpec, NeuronModule } from "@workspace/contract";

/**
 * The selectable roster: one entry per chassis class, and that is the whole list.
 *
 * It used to hold five named archetypes across three chassis — two HORNETs and an
 * evolved boss — which made "pick a fighter" and "pick a class" two different
 * questions with no obvious relationship. There are three models and three
 * chassis, so there are three classes, and each one arrives with the loadout that
 * suits its body: the light frame evades, the middleweight presses, the heavy one
 * grinds. Escalation is the campaign's job now, not the roster's.
 *
 * The evolved champion is not gone — it is still seeded server-side and still the
 * thing to beat on the Elo board; it is simply not one of the three bodies you
 * can wear.
 */
const brain = (
  slots: Array<{ module: NeuronModule; weight: number; threshold: number }>,
  membraneLeak = 0.2,
  refractoryTicks = 4,
): BrainSpec => ({ slots, membraneLeak, refractoryTicks });

export interface RosterEntry {
  bot: BotSpec;
  /** short read on how the class fights, shown under the name */
  tag: string;
  boss?: boolean;
}

export const ROSTER: RosterEntry[] = [
  {
    tag: "ESCAPE REFLEX",
    bot: {
      id: "drone",
      name: "DRONE",
      chassis: "DRONE",
      brain: brain([
        { module: "LPLC2_DNP01", weight: 2.4, threshold: 0.5 },
        { module: "DNA02", weight: 2.2, threshold: 0.7 },
        { module: "LC10A", weight: 1.6, threshold: 0.9 },
      ]),
    },
  },
  {
    tag: "FORWARD PRESSURE",
    bot: {
      id: "hornet",
      name: "HORNET",
      chassis: "HORNET",
      brain: brain([
        { module: "LC10A", weight: 2.6, threshold: 0.6 },
        { module: "DNA02", weight: 2.4, threshold: 0.6 },
        { module: "P1", weight: 1.4, threshold: 1.0 },
      ]),
    },
  },
  {
    tag: "ATTRITION",
    bot: {
      id: "tank",
      name: "TANK",
      chassis: "TANK",
      brain: brain([
        { module: "LC10A", weight: 2.4, threshold: 0.7 },
        { module: "DNA02", weight: 1.6, threshold: 0.8 },
        { module: "MDN", weight: 1.4, threshold: 0.8 },
        { module: "P1", weight: 1.2, threshold: 1.1 },
      ]),
    },
  },
];
