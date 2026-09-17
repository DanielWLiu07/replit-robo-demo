import { evolve, fitness, runMatch } from "./index.js";
import type { BotSpec, BrainSpec } from "@workspace/contract";

const B = (slots: BrainSpec["slots"], leak = 0.2, refr = 4): BrainSpec =>
  ({ slots, membraneLeak: leak, refractoryTicks: refr });

// The hand-designed panel the evolved brain has to beat.
const PANEL: BotSpec[] = [
  { id:"RUSHER",  name:"RUSHER",  chassis:"HORNET", brain:B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) },
  { id:"DODGER",  name:"DODGER",  chassis:"DRONE",  brain:B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) },
  { id:"BRAWLER", name:"BRAWLER", chassis:"TANK",   brain:B([{module:"LC10A",weight:2.4,threshold:0.7},{module:"DNA02",weight:1.6,threshold:0.8},{module:"MDN",weight:1.4,threshold:0.8},{module:"P1",weight:1.2,threshold:1.1}]) },
  { id:"SNIPER",  name:"SNIPER",  chassis:"HORNET", brain:B([{module:"LC11",weight:2.0,threshold:0.6},{module:"LC10A",weight:2.2,threshold:0.7},{module:"DNA02",weight:2.0,threshold:0.7}]) },
];

const t0 = Date.now();
console.log("generation   best   mean   wins/8");
const { best, history } = evolve(PANEL, { populationSize: 24, generations: 14, seedsPerOpponent: 2 },
  "flyweight-v1", (r) => {
    const bar = "#".repeat(Math.max(0, Math.round(r.bestScore)));
    console.log(`  gen ${String(r.generation).padStart(2)}    ${String(r.bestScore).padStart(6)} ${String(r.meanScore).padStart(6)}   ${r.bestWins}/${r.matches}  ${bar}`);
  });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\nevolved in ${secs}s over ${history.length} generations`);
const first = history[0]!, last = history.at(-1)!;
console.log(`best score ${first.bestScore} -> ${last.bestScore}   mean ${first.meanScore} -> ${last.meanScore}`);

console.log("\nchampion loadout:");
for (const s of best.slots)
  console.log(`  ${s.module.padEnd(14)} weight ${s.weight.toFixed(2)}  threshold ${s.threshold.toFixed(2)}`);
console.log(`  leak ${best.membraneLeak}  refractory ${best.refractoryTicks} ticks`);

console.log("\nchampion vs each hand-designed archetype (fresh seeds):");
let w = 0, l = 0, d = 0;
for (const foe of PANEL) {
  let fw = 0, fl = 0, fd = 0;
  for (const s of ["t1","t2","t3","t4","t5"]) {
    const g = runMatch(`test-${foe.id}-${s}`, { id:"champ", name:"champ", chassis:"HORNET", brain:best }, foe);
    let r = g.next(); while (!r.done) r = g.next();
    if (r.value.winnerBotId === "champ") fw++; else if (!r.value.winnerBotId) fd++; else fl++;
  }
  w += fw; l += fl; d += fd;
  console.log(`  vs ${foe.id.padEnd(8)} ${fw}W ${fl}L ${fd}D`);
}
console.log(`  overall ${w}W ${l}L ${d}D  (${((w/(w+l+d))*100).toFixed(0)}% win rate)`);
