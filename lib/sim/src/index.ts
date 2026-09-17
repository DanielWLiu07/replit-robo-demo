export { runMatch, arenaHalfAt, arenaHalfFor, ARENA_SIZE, ARENA_MIN_HALF, BOT_RADIUS } from "./arena.js";
export { Brain, type Senses, type MotorIntent } from "./brain.js";
export { LifNeuron } from "./neuron.js";
export { makeRng } from "./rng.js";
export { CONNECTOME, populationNoise, isInhibitory, type CellPopulation } from "./connectome.js";

export { evolve, mutate, crossover, fitness, randomBrain, DEFAULT_CONFIG,
         type EvolveConfig, type GenerationReport } from "./evolve.js";
export { profileBrain, profileBot, type BotProfile } from "./profile.js";
export { buildBrainGeometry, totalFibres, BRAIN_EXTENT,
         type PopulationGeometry, type Fibre, type Vec3 } from "./brainviz.js";
export { poseBot, rigHeight, hullFraction, type Pose, type Bone } from "./rig.js";
export { simpleBrain, toSlot, toIntensity, budgetUsed } from "./simple.js";
