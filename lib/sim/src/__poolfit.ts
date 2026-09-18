/**
 * The largest pool that is FULLY spendable at each earned weight budget.
 *
 * Points and weight have to rise together or the progression lies: hand out
 * points the budget cannot buy and the solver quietly scales the ask down,
 * which is the renormalisation the pool exists to abolish. This finds the
 * honest pairing rather than assuming one.
 */
import { solveBrain } from "./optimize.js";

const worstShortfall = (pool: number, budget: number) => {
  let worst = 0;
  for (let a = 0; a <= 100; a += 5) for (let e = 0; e <= 100; e += 5) {
    const t = pool - a - e;
    if (t < 0 || t > 100) continue;
    const got = solveBrain({ aggression: a, evasion: e, tracking: t }, {}, budget).achieved;
    worst = Math.max(worst, pool - (got.aggression + got.evasion + got.tracking));
  }
  return worst;
};

console.log("budget   max pool fully spendable");
for (let budget = 8; budget <= 16; budget++) {
  let best = 0;
  for (let pool = 120; pool <= 300; pool += 4) {
    if (worstShortfall(pool, budget) === 0) best = pool; else break;
  }
  console.log(`  ${String(budget).padStart(2)}     ${best}`);
}
