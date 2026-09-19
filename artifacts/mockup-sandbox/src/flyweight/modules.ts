import { NeuronModule } from "@workspace/contract";
import type { BotSpec } from "@workspace/contract";
import { CONNECTOME } from "@workspace/sim";
export const MODULES: Record<
  NeuronModule,
  { label: string; circuit: string; action: string; detail: string }
> = {
  LPLC2_DNP01: {
    label: "Giant fiber",
    circuit: "LPLC2 → DNp01",
    action: "EVADE",
    detail: "Looming-sensitive visual cells drive a fast escape pathway.",
  },
  LC10A: {
    label: "Pursuit",
    circuit: "LC10a",
    action: "CHASE",
    detail: "A visual pursuit circuit inspired by small-target tracking.",
  },
  LC11: {
    label: "Acquisition",
    circuit: "LC11",
    action: "DETECT",
    detail: "Small-object detection gives the brain a target.",
  },
  DNA02: {
    label: "Steering",
    circuit: "DNa02",
    action: "TURN",
    detail: "Descending steering signals turn visual input into movement.",
  },
  MDN: {
    label: "Moonwalker",
    circuit: "MDN",
    action: "REVERSE",
    detail: "A descending pathway associated with backward walking.",
  },
  P1: {
    label: "Arousal",
    circuit: "P1",
    action: "AMPLIFY",
    detail: "A state-setting circuit adjusts the drive of other modules.",
  },
};
export const CONNECTOME_MODULES = NeuronModule.options.map((module) => ({
  module,
  ...MODULES[module],
  ...CONNECTOME[module],
}));
export const CHAMPION_BRAIN: BotSpec = {
  id: "champion",
  name: "CHAMPION / EVOLVED",
  chassis: "HORNET",
  brain: {
    slots: [
      { module: "LPLC2_DNP01", weight: 1.1527650848291815, threshold: 1.1555094724171795 },
      { module: "LC10A", weight: 0.5348723970791325, threshold: 0.3274095524800941 },
      { module: "LC11", weight: 1.274469781219028, threshold: 0.5483445407822728 },
      { module: "DNA02", weight: 1.746, threshold: 0.7302505290368572 },
      { module: "P1", weight: 1.3642872920250517, threshold: 1.436391279124655 },
    ],
    membraneLeak: 0.17792343439161776,
    refractoryTicks: 6,
  },
};
export const DEFAULT_BOTS: [BotSpec, BotSpec] = [
  {
    id: "ghost",
    name: "GHOST / 01",
    chassis: "DRONE",
    brain: {
      slots: [
        { module: "LC10A", weight: 2, threshold: 0.55 },
        { module: "DNA02", weight: 2, threshold: 0.6 },
        { module: "LPLC2_DNP01", weight: 2, threshold: 0.8 },
        { module: "P1", weight: 1, threshold: 0.8 },
      ],
      membraneLeak: 0.12,
      refractoryTicks: 4,
    },
  },
  { ...CHAMPION_BRAIN, name: "CHAMPION / BOSS" },
];

/**
 * The build a new player starts with: a chassis, and not one point spent.
 *
 * Every dial reads zero, the whole instinct pool is unspent, and the fly has a
 * pursuit circuit installed at zero weight — present, wired, and driving nothing.
 * It cannot fight in that state, and that is the point: the loadout is the game, so
 * handing a stranger a pre-solved brain skips the only decision they get to make.
 *
 * Defined here as the literal `solveBrain({0,0,0})` produces, rather than by calling
 * the solver, so a saved build and a fresh one are the same shape and the module
 * stays free of a runtime dependency on the optimiser.
 */
export const UNSPENT_BUILD: BotSpec = {
  id: "recruit",
  name: "RECRUIT / 00",
  chassis: "DRONE",
  brain: {
    slots: [{ module: "LC10A", weight: 0, threshold: 0.8 }],
    membraneLeak: 0.2,
    refractoryTicks: 4,
  },
};

/**
 * Where the player's build is saved, and the version of the RULES it was saved under.
 *
 * A build from before the pool was re-based is still a legal BotSpec, so it loads
 * cleanly and silently — which is how a browser that had played once kept opening
 * the bench already spent, long after a fresh one correctly opened at zero. The
 * stored spec cannot say which rules built it, so the key has to. Bump this whenever
 * the meaning of a saved build changes.
 */
export const BUILD_KEY = "flyweight.bot.v2";

/** True when nothing has been spent yet — nothing to fight with. */
export const isUnspent = (bot: BotSpec) =>
  bot.brain.slots.reduce((a, s) => a + s.weight, 0) <= 0;
