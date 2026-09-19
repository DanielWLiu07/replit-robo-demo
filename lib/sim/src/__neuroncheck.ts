import { runMatch } from "./index.js";
import type { BotSpec } from "@workspace/contract";

const mk = (id: string, slots: any[]): BotSpec =>
  ({ id, name: id, chassis: "HORNET", brain: { slots, membraneLeak: 0.2, refractoryTicks: 6 } });
const FULL = [
  { module: "LC10A", weight: 2.0, threshold: 0.55 },
  { module: "DNA02", weight: 1.8, threshold: 0.6 },
  { module: "LPLC2_DNP01", weight: 1.6, threshold: 0.8 },
  { module: "P1", weight: 1.2, threshold: 0.8 },
];
const NO_PURSUIT = FULL.filter(s => s.module !== "LC10A");
const NO_GF      = FULL.filter(s => s.module !== "LPLC2_DNP01");

/** A punch is a large jump in an arm's angular velocity, the impulse landing. */
function scan(me: BotSpec, foe: BotSpec, seeds = 6) {
  let punches = 0, punchOnPursuitTick = 0, guardRises = 0, guardOnGfTick = 0;
  const armWithArousal: Array<[number, number]> = [];
  for (let s = 0; s < seeds; s++) {
    const g = runMatch(`n-${s}`, me, foe);
    let r = g.next(); let prev: any = null;
    while (!r.done) {
      const u: any = (r.value as any).bots[0];
      if (prev) {
        const jump = Math.max(Math.abs(u.armLv) - Math.abs(prev.armLv),
                              Math.abs(u.armRv) - Math.abs(prev.armRv));
        if (jump > 5) {
          punches++;
          if (u.spiked.includes("LC10A")) punchOnPursuitTick++;
          armWithArousal.push([prev.arousal, jump / (0.45 + 0.55 * prev.stamina)]);
        }
        if (u.guard - prev.guard > 0.05) {
          guardRises++;
          if (u.spiked.includes("LPLC2_DNP01")) guardOnGfTick++;
        }
      }
      prev = u; r = g.next();
    }
  }
  return { punches, punchOnPursuitTick, guardRises, guardOnGfTick, armWithArousal };
}

const foe = mk("foe", FULL);
const full = scan(mk("full", FULL), foe);
const noPur = scan(mk("nopur", NO_PURSUIT), foe);
const noGf  = scan(mk("nogf",  NO_GF), foe);

console.log("── 1. is a punch caused by the PURSUIT circuit firing? ──");
console.log(`   punches thrown: ${full.punches}`);
console.log(`   thrown on a tick LC10a spiked: ${full.punchOnPursuitTick} (${(full.punchOnPursuitTick/full.punches*100).toFixed(1)}%)`);
console.log("\n── 2. remove LC10a entirely ──");
console.log(`   punches with pursuit: ${full.punches}   without it: ${noPur.punches}`);

console.log("\n── 3. does P1 AROUSAL scale the impulse? ──");
const lo = full.armWithArousal.filter(([a]) => a < 1.05).map(([, j]) => j);
const hi = full.armWithArousal.filter(([a]) => a > 1.25).map(([, j]) => j);
const mean = (v: number[]) => v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
console.log(`   low arousal (<1.05): ${lo.length} punches, mean impulse ${mean(lo).toFixed(2)} rad/s (stamina-corrected)`);
console.log(`   high arousal (>1.25): ${hi.length} punches, mean impulse ${mean(hi).toFixed(2)} rad/s (stamina-corrected)`);

console.log("\n── 4. is the GUARD driven by the Giant Fiber? ──");
console.log(`   guard raises: ${full.guardRises}, of which on an LPLC2->DNp01 spike: ${full.guardOnGfTick} (${(full.guardOnGfTick/full.guardRises*100).toFixed(1)}%)`);
console.log(`   guard raises with the Giant Fiber removed: ${noGf.guardRises}`);
