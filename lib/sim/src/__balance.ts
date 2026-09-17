import { runMatch } from "@workspace/sim";
import type { BotSpec, BrainSpec } from "@workspace/contract";
const B = (slots: BrainSpec["slots"], leak = 0.2, refr = 4): BrainSpec => ({ slots, membraneLeak: leak, refractoryTicks: refr });
const builds: Record<string, { chassis: BotSpec["chassis"]; brain: BrainSpec }> = {
  RUSHER:  { chassis: "HORNET", brain: B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) },
  DODGER:  { chassis: "DRONE",  brain: B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) },
  BRAWLER: { chassis: "TANK",   brain: B([{module:"LC10A",weight:2.4,threshold:0.7},{module:"DNA02",weight:1.6,threshold:0.8},{module:"MDN",weight:1.4,threshold:0.8},{module:"P1",weight:1.2,threshold:1.1}]) },
  SNIPER:  { chassis: "HORNET", brain: B([{module:"LC11",weight:2.0,threshold:0.6},{module:"LC10A",weight:2.2,threshold:0.7},{module:"DNA02",weight:2.0,threshold:0.7}]) },
};
const names = Object.keys(builds);
const wins: Record<string, number> = Object.fromEntries(names.map(n => [n, 0]));
let kos = 0, draws = 0, total = 0, tickSum = 0; const drawDetail: string[] = [];
for (const a of names) for (const b of names) {
  if (a === b) continue;
  for (const seed of ["p","q","r"]) {
    const specA: BotSpec = { id: a, name: a, ...builds[a]! };
    const specB: BotSpec = { id: b, name: b, ...builds[b]! };
    const g = runMatch(`${a}-${b}-${seed}`, specA, specB);
    let r = g.next(); let lastA = 0, lastB = 0, hitCount = 0;
    while (!r.done) { lastA = r.value.bots[0].hull; lastB = r.value.bots[1].hull; hitCount += r.value.hits.length; r = g.next(); }
    total++; tickSum += r.value.ticks;
    if (r.value.outcome === "KO") kos++;
    if (!r.value.winnerBotId) { draws++; drawDetail.push(`${a} vs ${b}/${seed}: hullA=${lastA.toFixed(1)} hullB=${lastB.toFixed(1)} hits=${hitCount}`); }
    else wins[r.value.winnerBotId] = (wins[r.value.winnerBotId] ?? 0) + 1;
  }
}
console.log(`${total} matches | KO ${kos} | draws ${draws} | avg ${(tickSum/total/60).toFixed(1)}s`);
for (const [n, w] of Object.entries(wins).sort((x,y)=>y[1]-x[1]))
  console.log(`  ${n.padEnd(8)} ${String(w).padStart(2)} wins  ${"#".repeat(w)}`);
console.log("\ndraw breakdown:");
for (const d of drawDetail.slice(0, 10)) console.log("  " + d);
