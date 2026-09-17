import { runMatch } from "./index.js";
import type { BotSpec, BrainSpec } from "@workspace/contract";
const B = (slots: BrainSpec["slots"]): BrainSpec => ({ slots, membraneLeak: 0.2, refractoryTicks: 4 });
const A: BotSpec = { id:"a", name:"RUSHER", chassis:"HORNET", brain:B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) };
const D: BotSpec = { id:"d", name:"DODGER", chassis:"DRONE",  brain:B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) };
const g = runMatch("hud", A, D);
let r = g.next();
console.log("tick   RUSHER arousal   DODGER gfFatigue   hullA  hullD");
while (!r.done) {
  const f = r.value;
  if (f.tick % 60 === 0 && f.tick <= 900)
    console.log(`${String(f.tick).padStart(4)}   ${f.bots[0].arousal.toFixed(3).padStart(13)}   ${f.bots[1].gfFatigue.toFixed(3).padStart(15)}   ${f.bots[0].hull.toFixed(0).padStart(5)}  ${f.bots[1].hull.toFixed(0).padStart(5)}`);
  r = g.next();
}
