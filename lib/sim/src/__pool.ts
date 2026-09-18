/** What the instinct pool can ACTUALLY buy, and what the roster spends. */
import { solveBrain } from "./optimize.js";
import { profileBrain } from "./profile.js";
import { ROSTER } from "../../../artifacts/mockup-sandbox/src/flyweight/roster.js";
import { DEFAULT_BOTS, CHAMPION_BRAIN } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
import { BotSpec, BRAIN_WEIGHT_BUDGET } from "@workspace/contract";

const spendOf = (b: any, chassis: any) => {
  const p = profileBrain(b, chassis);
  return { spent: p.aggression + p.evasion + p.tracking, p,
           weight: b.slots.reduce((a: number, s: any) => a + s.weight, 0) };
};

console.log("── what the roster spends ──");
for (const e of ROSTER) {
  const s = spendOf(e.bot.brain, e.bot.chassis);
  console.log(`  ${e.bot.name.padEnd(9)} ${s.p.aggression}/${s.p.evasion}/${s.p.tracking}` +
    ` = ${String(s.spent).padStart(3)} pts,  weight ${s.weight.toFixed(2)}/${BRAIN_WEIGHT_BUDGET}`);
}
for (const [label, spec] of [["GHOST", DEFAULT_BOTS[0]!], ["CHAMPION", CHAMPION_BRAIN]] as const) {
  const s = spendOf(spec.brain, spec.chassis);
  console.log(`  ${label.padEnd(9)} ${s.p.aggression}/${s.p.evasion}/${s.p.tracking}` +
    ` = ${String(s.spent).padStart(3)} pts,  weight ${s.weight.toFixed(2)}/${BRAIN_WEIGHT_BUDGET}`);
}

console.log("\n── the real ceiling: best total the weight budget can buy ──");
let best = { total: -1, t: "" };
for (let a = 0; a <= 100; a += 4) for (let e = 0; e <= 100; e += 4) for (let t = 0; t <= 100; t += 4) {
  const sol = solveBrain({ aggression: a, evasion: e, tracking: t }, {});
  const ok = BotSpec.safeParse({ id:"x", name:"x", chassis:"HORNET", brain: sol.brain }).success;
  if (!ok) continue;
  const got = sol.achieved.aggression + sol.achieved.evasion + sol.achieved.tracking;
  if (got > best.total) best = { total: got, t: `${a}/${e}/${t} -> ${sol.achieved.aggression}/${sol.achieved.evasion}/${sol.achieved.tracking}` };
}
console.log(`  max spendable ${best.total} pts   (${best.t})`);

console.log("\n── asks the solver cannot honour, or that produce an INVALID spec ──");
let short = 0, invalid = 0, n = 0;
for (let a = 0; a <= 100; a += 10) for (let e = 0; e <= 100; e += 10) for (let t = 0; t <= 100; t += 10) {
  const sol = solveBrain({ aggression: a, evasion: e, tracking: t }, {});
  const got = sol.achieved.aggression + sol.achieved.evasion + sol.achieved.tracking;
  const ok = BotSpec.safeParse({ id:"x", name:"x", chassis:"HORNET", brain: sol.brain }).success;
  n++; if (!ok) invalid++; else if (got < a + e + t - 2) short++;
}
console.log(`  of ${n} asks: ${invalid} produce a spec the schema REJECTS, ${short} silently under-deliver`);
console.log(`  blank ask 0/0/0 -> ${JSON.stringify(solveBrain({aggression:0,evasion:0,tracking:0},{}).achieved)}`);
