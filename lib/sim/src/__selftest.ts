import { runMatch } from "@workspace/sim";
import type { BotSpec, NeuronModule } from "@workspace/contract";

const AGGRO: BotSpec = { id: "aggro", name: "Hornet", chassis: "HORNET", brain: {
  slots: [
    { module: "LC10A", weight: 2.2, threshold: 0.7 },
    { module: "DNA02", weight: 2.0, threshold: 0.7 },
    { module: "LC11",  weight: 1.2, threshold: 0.8 },
    { module: "P1",    weight: 1.4, threshold: 1.0 },
  ], membraneLeak: 0.2, refractoryTicks: 4 } };

const SKITTISH: BotSpec = { id: "skit", name: "Drone", chassis: "DRONE", brain: {
  slots: [
    { module: "LPLC2_DNP01", weight: 2.6, threshold: 0.5 },
    { module: "DNA02",       weight: 1.8, threshold: 0.8 },
    { module: "LC10A",       weight: 1.4, threshold: 1.0 },
    { module: "MDN",         weight: 1.0, threshold: 0.9 },
  ], membraneLeak: 0.25, refractoryTicks: 6 } };

function play(seed: string, verbose = false) {
  const spikes = new Map<NeuronModule, number>();
  let frames = 0, hits = 0, totalDmg = 0, maxPot = 0;
  const gen = runMatch(seed, AGGRO, SKITTISH);
  let r = gen.next();
  while (!r.done) {
    const f = r.value; frames++;
    for (const b of f.bots) {
      for (const m of b.spiked) spikes.set(m, (spikes.get(m) ?? 0) + 1);
      for (const v of Object.values(b.potentials)) maxPot = Math.max(maxPot, v as number);
    }
    hits += f.hits.length;
    totalDmg += f.hits.reduce((s, h) => s + h.damage, 0);
    if (verbose && f.tick % 240 === 0)
      console.log(`  t=${String(f.tick).padStart(4)} hullA=${f.bots[0].hull.toFixed(0).padStart(3)} hullB=${f.bots[1].hull.toFixed(0).padStart(3)}  spiked=[${[...new Set([...f.bots[0].spiked, ...f.bots[1].spiked])].join(",") || "-"}]`);
    r = gen.next();
  }
  return { result: r.value, frames, hits, totalDmg, spikes, maxPot };
}

console.log("=== match on seed 'alpha' ===");
const a = play("alpha", true);
console.log(`  outcome=${a.result.outcome} winner=${a.result.winnerBotId} ticks=${a.result.ticks}`);
console.log(`  frames=${a.frames} hits=${a.hits} damage=${a.totalDmg.toFixed(1)} maxPotential=${a.maxPot.toFixed(2)}`);
console.log("  spikes by module:");
for (const [m, n] of [...a.spikes].sort((x, y) => y[1] - x[1])) console.log(`    ${m.padEnd(14)} ${n}`);

console.log("\n=== determinism: same seed twice ===");
const d1 = play("determinism"), d2 = play("determinism");
const same = d1.result.winnerBotId === d2.result.winnerBotId && d1.result.ticks === d2.result.ticks && d1.hits === d2.hits;
console.log(`  run1 ${d1.result.outcome}/${d1.result.ticks}t/${d1.hits}hits  run2 ${d2.result.outcome}/${d2.result.ticks}t/${d2.hits}hits  -> ${same ? "IDENTICAL" : "DIVERGED (BUG)"}`);

console.log("\n=== 8 seeds: do matches actually resolve? ===");
const out: Record<string, number> = {};
for (const s of ["s1","s2","s3","s4","s5","s6","s7","s8"]) {
  const r = play(s).result;
  out[r.outcome] = (out[r.outcome] ?? 0) + 1;
  console.log(`  ${s}: ${r.outcome.padEnd(13)} winner=${r.winnerBotId ?? "none"} in ${r.ticks}t`);
}
console.log("  totals:", JSON.stringify(out));
