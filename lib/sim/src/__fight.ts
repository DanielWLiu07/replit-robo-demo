/**
 * Fight-feel diagnostics. __balance.ts answers "is the roster fair"; this answers
 * "does it read as boxing". The numbers that matter are spatial and temporal:
 * where the bots stand, how often they commit, and what fraction of a match is
 * spent glued together. Same 36-match round robin, so it is directly comparable.
 */
import { runMatch } from "@workspace/sim";
import type { BotSpec, BrainSpec } from "@workspace/contract";

const B = (slots: BrainSpec["slots"], leak = 0.2, refr = 4): BrainSpec =>
  ({ slots, membraneLeak: leak, refractoryTicks: refr });
const builds: Record<string, { chassis: BotSpec["chassis"]; brain: BrainSpec }> = {
  RUSHER:  { chassis: "HORNET", brain: B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) },
  DODGER:  { chassis: "DRONE",  brain: B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) },
  BRAWLER: { chassis: "TANK",   brain: B([{module:"LC10A",weight:2.4,threshold:0.7},{module:"DNA02",weight:1.6,threshold:0.8},{module:"MDN",weight:1.4,threshold:0.8},{module:"P1",weight:1.2,threshold:1.1}]) },
  SNIPER:  { chassis: "HORNET", brain: B([{module:"LC11",weight:2.0,threshold:0.6},{module:"LC10A",weight:2.2,threshold:0.7},{module:"DNA02",weight:2.0,threshold:0.7}]) },
};
const names = Object.keys(builds);

let ticks = 0, clinch = 0, pocket = 0, outside = 0, distSum = 0;
let recoveryTicks = 0, guardTicks = 0, thrown = 0, landed = 0, blocked = 0, countered = 0;
let staminaSum = 0, staminaSeen = 0, lateralSum = 0;
// gap histogram, 0.15m buckets up to 3m, where do they actually stand?
const HIST = 20, HIST_W = 0.15;
const hist = new Array(HIST + 1).fill(0);
let kos = 0, draws = 0, total = 0, tickSum = 0; const nonKo: string[] = [];
const wins: Record<string, number> = Object.fromEntries(names.map(n => [n, 0]));
const h2h: Record<string, number> = {};
// per-build tempo: who throws, who lands, who spends the match on empty
type Per = { thrown: number; landed: number; dealt: number; stam: number; guard: number; ticks: number };
const per: Record<string, Per> = Object.fromEntries(names.map(n =>
  [n, { thrown: 0, landed: 0, dealt: 0, stam: 0, guard: 0, ticks: 0 }]));

for (const a of names) for (const b of names) {
  if (a === b) continue;
  for (const seed of ["p","q","r"]) {
    const specA: BotSpec = { id: a, name: a, ...builds[a]! };
    const specB: BotSpec = { id: b, name: b, ...builds[b]! };
    const g = runMatch(`${a}-${b}-${seed}`, specA, specB);
    let r = g.next();
    let prev: any = null, engaged = false;
    while (!r.done) {
      const f: any = r.value;
      const [u, v] = f.bots;
      const d = Math.hypot(u.x - v.x, u.y - v.y);
      if (d < 2) engaged = true;   // spacing before first contact is just the approach
      if (!engaged) { prev = f; landed += f.hits.length; r = g.next(); continue; }
      ticks++; distSum += d;
      if (d < 1.32) clinch++; else if (d < 1.75) pocket++; else if (d > 2.6) outside++;
      hist[Math.min(HIST, Math.floor(d / HIST_W))]++;
      for (let i = 0; i < f.bots.length; i++) {
        const bot = f.bots[i];
        const who = per[i === 0 ? a : b]!;
        who.ticks++; who.stam += bot.stamina ?? 1; if (bot.guard > 0.45) who.guard++;
        if (bot.recovery > 0) recoveryTicks++;
        if (bot.guard > 0.45) guardTicks++;
        if (bot.blocked) blocked++;
        if ((bot as any).countered) countered++;
        if (typeof (bot as any).stamina === "number") { staminaSum += (bot as any).stamina; staminaSeen++; }
        // lateral speed = component of velocity perpendicular to heading
        lateralSum += Math.abs(-Math.sin(bot.heading) * bot.vx + Math.cos(bot.heading) * bot.vy);
      }
      if (prev) for (let i = 0; i < f.bots.length; i++)
        if (f.bots[i].recovery > prev.bots[i].recovery) { thrown++; per[i === 0 ? a : b]!.thrown++; }
      landed += f.hits.length;
      for (const h of f.hits) {
        const who = per[h.attacker === a ? a : b]!;
        who.landed++; who.dealt += h.damage;
      }
      prev = f;
      r = g.next();
    }
    total++; tickSum += r.value.ticks;
    if (r.value.outcome === "KO") kos++;
    else nonKo.push(`${a} v ${b}/${seed}: ${r.value.outcome} ${(r.value.ticks/60).toFixed(0)}s`);
    if (!r.value.winnerBotId) draws++;
    else {
      wins[r.value.winnerBotId] = (wins[r.value.winnerBotId] ?? 0) + 1;
      const key = [a, b].sort().join(" v ");
      h2h[key] = (h2h[key] ?? 0) + (r.value.winnerBotId === [a,b].sort()[0] ? 1 : 0);
    }
  }
}

const pc = (x: number, of: number) => `${((x / Math.max(1, of)) * 100).toFixed(1)}%`;
console.log(`${total} matches | KO ${kos} | draws ${draws} | avg ${(tickSum/total/60).toFixed(1)}s`);
console.log(`\nSPACING   mean gap ${(distSum/ticks).toFixed(2)}m`);
console.log(`  touching(<1.32m)     ${pc(clinch, ticks).padStart(6)}   <- want near zero`);
console.log(`  pocket  (1.32-1.75m) ${pc(pocket, ticks).padStart(6)}   <- want high`);
console.log(`  outside (>2.6m)      ${pc(outside, ticks).padStart(6)}`);
const peak = Math.max(...hist);
for (let i = 0; i <= HIST; i++) {
  if (!hist[i]) continue;
  const lo = (i * HIST_W).toFixed(2);
  console.log(`   ${lo.padStart(5)}m ${"#".repeat(Math.round(hist[i] / peak * 44)).padEnd(44)} ${pc(hist[i], ticks)}`);
}
console.log(`\nTEMPO     ${thrown} thrown, ${landed} landed, ${blocked} blocked, ${countered} counters`);
console.log(`  landed/thrown        ${pc(landed, thrown).padStart(6)}`);
console.log(`  blocked/landed       ${pc(blocked, landed).padStart(6)}`);
console.log(`  countered/landed     ${pc(countered, landed).padStart(6)}`);
console.log(`  ticks in recovery    ${pc(recoveryTicks, ticks*2).padStart(6)}`);
console.log(`  ticks guarding       ${pc(guardTicks, ticks*2).padStart(6)}`);
console.log(`  thrown/sec (both)    ${(thrown / (tickSum / 60)).toFixed(2)}`);
console.log(`  landed/sec (both)    ${(landed / (tickSum / 60)).toFixed(2)}`);
console.log(`  mean lateral speed   ${(lateralSum/(ticks*2)).toFixed(2)} m/s   <- footwork`);
if (staminaSeen) console.log(`  mean stamina         ${(staminaSum/staminaSeen).toFixed(2)}`);
if (nonKo.length) console.log(`\nNOT A KO (${nonKo.length}): ` + nonKo.join(", "));
console.log(`\nPER BUILD (per second of fighting)`);
console.log(`  build     thrown  landed  acc    dmg/s  stamina  guard`);
for (const n of names) {
  const q = per[n]!, secs = q.ticks / 60;
  console.log(`  ${n.padEnd(8)}  ${(q.thrown/secs).toFixed(2).padStart(6)}  ${(q.landed/secs).toFixed(2).padStart(6)}  ${((q.landed/Math.max(1,q.thrown))*100).toFixed(0).padStart(3)}%  ${(q.dealt/secs).toFixed(2).padStart(6)}  ${(q.stam/q.ticks).toFixed(2).padStart(7)}  ${((q.guard/q.ticks)*100).toFixed(0).padStart(4)}%`);
}
console.log(`\nROSTER`);
for (const [n, w] of Object.entries(wins).sort((x,y)=>y[1]-x[1]))
  console.log(`  ${n.padEnd(8)} ${String(w).padStart(2)} wins  ${"#".repeat(w)}`);
console.log(`\nHEAD TO HEAD (wins for the first name, of 6)`);
for (const [k, w] of Object.entries(h2h)) console.log(`  ${k.padEnd(20)} ${w}-${6-w}`);
