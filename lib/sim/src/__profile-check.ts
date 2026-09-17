import { profileBot } from "./index.js";
import type { BotSpec, BrainSpec } from "@workspace/contract";
import champ from "./champion.json" with { type: "json" };
const B = (slots: BrainSpec["slots"], leak = 0.2, refr = 4): BrainSpec => ({ slots, membraneLeak: leak, refractoryTicks: refr });
const bots: BotSpec[] = [
  { id:"r", name:"RUSHER",  chassis:"HORNET", brain:B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) },
  { id:"d", name:"DODGER",  chassis:"DRONE",  brain:B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) },
  { id:"b", name:"BRAWLER", chassis:"TANK",   brain:B([{module:"LC10A",weight:2.4,threshold:0.7},{module:"DNA02",weight:1.6,threshold:0.8},{module:"MDN",weight:1.4,threshold:0.8},{module:"P1",weight:1.2,threshold:1.1}]) },
  { id:"s", name:"SNIPER",  chassis:"HORNET", brain:B([{module:"LC11",weight:2.0,threshold:0.6},{module:"LC10A",weight:2.2,threshold:0.7},{module:"DNA02",weight:2.0,threshold:0.7}]) },
  { id:"c", name:"CHAMPION",chassis:"HORNET", brain: champ.brain as BrainSpec },
];
const bar = (v: number) => "█".repeat(Math.round(v/7)).padEnd(15, "·");
console.log("NAME       AGGR            EVAS            TRACK           REFLEX          CELLS");
for (const b of bots) {
  const p = profileBot(b);
  console.log(`${b.name.padEnd(9)} ${bar(p.aggression)} ${bar(p.evasion)} ${bar(p.tracking)} ${bar(p.reflex)} ${String(p.neuronCount).padStart(4)}`);
}
console.log("\nplaystyles:");
for (const b of bots) console.log(`  ${b.name.padEnd(9)} ${profileBot(b).playstyle}`);
console.log("\nchassis bars:");
for (const b of bots) { const p = profileBot(b);
  console.log(`  ${b.name.padEnd(9)} hull ${String(p.hull).padStart(3)}  speed ${String(p.speed).padStart(3)}  agility ${String(p.agility).padStart(3)}`); }
