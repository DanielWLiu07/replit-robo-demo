import { evolve } from "./index.js";
import type { BotSpec, BrainSpec } from "@workspace/contract";
import { writeFileSync } from "node:fs";
const B = (slots: BrainSpec["slots"], leak = 0.2, refr = 4): BrainSpec => ({ slots, membraneLeak: leak, refractoryTicks: refr });
const PANEL: BotSpec[] = [
  { id:"RUSHER",  name:"RUSHER",  chassis:"HORNET", brain:B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) },
  { id:"DODGER",  name:"DODGER",  chassis:"DRONE",  brain:B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) },
  { id:"BRAWLER", name:"BRAWLER", chassis:"TANK",   brain:B([{module:"LC10A",weight:2.4,threshold:0.7},{module:"DNA02",weight:1.6,threshold:0.8},{module:"MDN",weight:1.4,threshold:0.8},{module:"P1",weight:1.2,threshold:1.1}]) },
  { id:"SNIPER",  name:"SNIPER",  chassis:"HORNET", brain:B([{module:"LC11",weight:2.0,threshold:0.6},{module:"LC10A",weight:2.2,threshold:0.7},{module:"DNA02",weight:2.0,threshold:0.7}]) },
];
const { best, history } = evolve(PANEL, { populationSize: 24, generations: 14, seedsPerOpponent: 2 }, "flyweight-v1");
writeFileSync(new URL("./champion.json", import.meta.url),
  JSON.stringify({
    note: "Evolved by neuroevolution against the four hand-designed archetypes. See evolve.ts.",
    seed: "flyweight-v1",
    generations: history.length,
    fitness: { first: history[0]!.bestScore, last: history.at(-1)!.bestScore },
    curve: history.map(h => ({ gen: h.generation, best: h.bestScore, mean: h.meanScore })),
    brain: best,
  }, null, 2) + "\n");
console.log("wrote champion.json, fitness", history[0]!.bestScore, "->", history.at(-1)!.bestScore);
