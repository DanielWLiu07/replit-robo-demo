import { runMatch } from "./index.js";
import type { BotSpec, BrainSpec } from "@workspace/contract";
const B = (slots: BrainSpec["slots"]): BrainSpec => ({ slots, membraneLeak: 0.2, refractoryTicks: 4 });
const A: BotSpec = { id:"RUSHER", name:"RUSHER", chassis:"HORNET", brain:B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) };
const D: BotSpec = { id:"DODGER", name:"DODGER", chassis:"DRONE",  brain:B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) };

for (const n of [1, 2, 3, 5]) {
  let kos = 0, draws = 0, ticks = 0, hits = 0, maxBots = 0;
  for (const s of ["s1","s2","s3","s4"]) {
    const g = runMatch(`squad-${n}-${s}`, A, D, n);
    let r = g.next(); let h = 0;
    while (!r.done) { h += r.value.hits.length; maxBots = Math.max(maxBots, r.value.bots.length); r = g.next(); }
    hits += h; ticks += r.value.ticks;
    if (r.value.outcome === "KO") kos++;
    if (!r.value.winnerBotId) draws++;
  }
  console.log(`${n}v${n}: units=${maxBots}  KO ${kos}/4  draws ${draws}  avg ${(ticks/4/60).toFixed(1)}s  hits ${Math.round(hits/4)}`);
}
console.log("\ndeterminism at 4v4:");
const run = () => { const g = runMatch("det-squad", A, D, 4); let r = g.next(); let h=0;
  while (!r.done) { h += r.value.hits.length; r = g.next(); } return `${r.value.outcome}/${r.value.ticks}t/${h}hits/${r.value.survivors}`; };
const x = run(), y = run();
console.log(`  ${x}\n  ${y}\n  -> ${x === y ? "IDENTICAL" : "DIVERGED (BUG)"}`);

console.log("\n5v5 frame shape:");
const g = runMatch("shape", A, D, 5); const f = g.next().value as any;
console.log(`  bots in frame: ${f.bots.length}  teamSplit: ${f.teamSplit}`);
console.log(`  team A ids: ${f.bots.slice(0, f.teamSplit).map((b:any)=>b.botId).join(", ")}`);
console.log(`  team B ids: ${f.bots.slice(f.teamSplit).map((b:any)=>b.botId).join(", ")}`);
