export { runMatch, arenaHalfAt, arenaHalfFor, ARENA_SIZE, ARENA_MIN_HALF, BOT_RADIUS } from "./arena.js";
export { KNOCKDOWN_TICKS } from "@workspace/contract";
export { RANGES } from "./arena.js";
export { Brain, type Senses, type MotorIntent } from "./brain.js";
export { LifNeuron } from "./neuron.js";
export { makeRng } from "./rng.js";
export { CONNECTOME, populationNoise, isInhibitory, type CellPopulation } from "./connectome.js";

export { evolve, mutate, crossover, fitness, randomBrain, DEFAULT_CONFIG,
         type EvolveConfig, type GenerationReport } from "./evolve.js";
export { profileBrain, profileBot, STAT_GAINS, type BotProfile, type StatName } from "./profile.js";
export { solveBrain, planStat, statCeiling, statCost, STAT_NAMES, REFRACTORY_WINS,
         bestRefractory, nearestMeasured, type StatTargets, type Solution } from "./optimize.js";
export { buildBrainGeometry, totalFibres, BRAIN_EXTENT,
         type PopulationGeometry, type Fibre, type Vec3 } from "./brainviz.js";
export { poseBot, rigHeight, hullFraction, strideFor, footReach, armReach, fistLocal, type Pose, type Bone, type ArmState } from "./rig.js";
export { simpleBrain, toSlot, toIntensity, budgetUsed, WEIGHT_MIN, WEIGHT_MAX } from "./simple.js";
export { bodyMechanics, bodyRatios, resolveBody, type Mechanics } from "./body.js";
export { tuneBody, stockBody, type TuneStep } from "./tune.js";
