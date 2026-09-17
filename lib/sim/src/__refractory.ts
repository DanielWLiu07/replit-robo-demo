import { runMatch } from "./index.js";
import type { BotSpec, BrainSpec } from "@workspace/contract";
const base: BrainSpec["slots"] = [
  { module: "LC10A", weight: 2.2, threshold: 0.7 },
  { module: "DNA02", weight: 2.4, threshold: 0.5 },
];
const mk = (refr: number): BotSpec => ({ id: `r${refr}`, name: `r${refr}`, chassis: "HORNET",
  brain: { slots: base, membraneLeak: 0.22, refractoryTicks: refr } });
const LEVELS = [0, 1, 2, 4, 6, 9, 14, 20, 30];
const wins: Record<number, number> = Object.fromEntries(LEVELS.map(l => [l, 0]));
let games = 0;
for (const a of LEVELS) for (const b of LEVELS) {
  if (a === b) continue;
  for (const s of ["x","y","z"]) {
    const g = runMatch(`refr-${a}-${b}-${s}`, mk(a), mk(b));
    let r = g.next(); while (!r.done) r = g.next();
    games++;
    if (r.value.winnerBotId === `r${a}`) wins[a]!++;
    else if (r.value.winnerBotId === `r${b}`) wins[b]!++;
  }
}
console.log(`refractory round robin, ${games} matches (identical brains, only refractoryTicks differs)`);
const max = Math.max(...Object.values(wins));
for (const l of LEVELS)
  console.log(`  ${String(l).padStart(2)} ticks: ${String(wins[l]).padStart(2)} wins ${"#".repeat(Math.round(wins[l]!/max*30))}`);
