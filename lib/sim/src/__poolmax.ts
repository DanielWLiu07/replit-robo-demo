/**
 * The largest pool the player can spend IN ANY DISTRIBUTION and actually receive.
 *
 * The pool is a single scalar; the real constraint is synaptic weight, and the three
 * stats are not priced the same (evasion buys at 28 points per unit of weight,
 * aggression 26, tracking 24). So a pool that is affordable spread across evasion can
 * be unaffordable poured into tracking — and the solver answers that by scaling the
 * whole ask down, which is the silent renormalisation the pool exists to abolish.
 * The honest pool is therefore the WORST case, not the best.
 */
import { solveBrain } from "./optimize.js";

const shortBy = (a: number, e: number, t: number) => {
  const got = solveBrain({ aggression: a, evasion: e, tracking: t }, {}).achieved;
  return (a + e + t) - (got.aggression + got.evasion + got.tracking);
};

for (const pool of [140, 150, 160, 170, 180, 190, 195, 200, 205, 211]) {
  let worstShort = 0, worst = "", checked = 0, bigShort = 0;
  // every way of spending EXACTLY the pool, in steps of 5
  for (let a = 0; a <= 100; a += 5) for (let e = 0; e <= 100; e += 5) {
    const t = pool - a - e;
    if (t < 0 || t > 100) continue;
    checked++;
    const d = shortBy(a, e, t);
    if (d > 10) bigShort++;
    if (d > worstShort) { worstShort = d; worst = `${a}/${e}/${t}`; }
  }
  console.log(`pool ${String(pool).padStart(3)}  ${String(checked).padStart(3)} ways to spend it` +
    `  |  worst shortfall ${String(worstShort).padStart(3)} pts (${worst || "none"})` +
    `  |  ${String(bigShort).padStart(3)} distributions lose >10 pts`);
}
