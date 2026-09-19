/**
 * Does the saved champion still hold up?
 *
 * champion.json was evolved against these four archetypes under the physics of the
 * day, and the pitch makes a measured claim about it ("20W 0L 0D on seeds it never
 * trained on"). Any change to the arena can invalidate that, and the brain is also
 * transcribed into the API seed and the client roster, so re-evolving is expensive
 * in more than CPU. This re-measures the claim instead of assuming it.
 */
import { runMatch } from "@workspace/sim";
import type { BotSpec, BrainSpec } from "@workspace/contract";
import champion from "./champion.json" with { type: "json" };

const B = (slots: BrainSpec["slots"], leak = 0.2, refr = 4): BrainSpec => ({ slots, membraneLeak: leak, refractoryTicks: refr });
const PANEL: BotSpec[] = [
  { id:"RUSHER",  name:"RUSHER",  chassis:"HORNET", brain:B([{module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},{module:"P1",weight:1.4,threshold:1.0}]) },
  { id:"DODGER",  name:"DODGER",  chassis:"DRONE",  brain:B([{module:"LPLC2_DNP01",weight:2.4,threshold:0.5},{module:"DNA02",weight:2.2,threshold:0.7},{module:"LC10A",weight:1.6,threshold:0.9}]) },
  { id:"BRAWLER", name:"BRAWLER", chassis:"TANK",   brain:B([{module:"LC10A",weight:2.4,threshold:0.7},{module:"DNA02",weight:1.6,threshold:0.8},{module:"MDN",weight:1.4,threshold:0.8},{module:"P1",weight:1.2,threshold:1.1}]) },
  { id:"SNIPER",  name:"SNIPER",  chassis:"HORNET", brain:B([{module:"LC11",weight:2.0,threshold:0.6},{module:"LC10A",weight:2.2,threshold:0.7},{module:"DNA02",weight:2.0,threshold:0.7}]) },
];
const champ: BotSpec = { id: "champ", name: "CHAMPION", chassis: "HORNET", brain: champion.brain as BrainSpec };

let w = 0, l = 0, d = 0, tickSum = 0, n = 0;
for (const foe of PANEL) {
  let fw = 0, fl = 0, fd = 0;
  for (const s of ["u1","u2","u3","u4","u5"]) {
    // champion on both sides of the draw, so spawn position cannot flatter it
    for (const [a, b] of [[champ, foe], [foe, champ]] as const) {
      const g = runMatch(`unseen-${foe.id}-${s}`, a, b);
      let r = g.next(); while (!r.done) r = g.next();
      n++; tickSum += r.value.ticks;
      if (r.value.winnerBotId === "champ") { w++; fw++; }
      else if (r.value.winnerBotId === null) { d++; fd++; }
      else { l++; fl++; }
    }
  }
  console.log(`  vs ${foe.id.padEnd(8)} ${fw}W ${fl}L ${fd}D`);
}
console.log(`champion: ${w}W ${l}L ${d}D of ${n} on unseen seeds | avg ${(tickSum/n/60).toFixed(1)}s`);
