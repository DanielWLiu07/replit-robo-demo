/**
 * The two matchups the demo actually ships: the stock Brain Lab build against the
 * default opponent, and the same build against the boss. The client's copy states how
 * long each takes and why the boss is opt-in — a stranger opening the link sees
 * exactly these two fights, so the claim has to be re-measured when the arena changes.
 */
import { runMatch } from "@workspace/sim";
import type { BotSpec, BrainSpec } from "@workspace/contract";
import champion from "./champion.json" with { type: "json" };

const B = (slots: BrainSpec["slots"], leak = 0.2, refr = 4): BrainSpec => ({ slots, membraneLeak: leak, refractoryTicks: refr });
const GHOST: BotSpec = { id:"ghost", name:"GHOST", chassis:"DRONE", brain: B([
  {module:"LC10A",weight:2,threshold:0.55},{module:"DNA02",weight:2,threshold:0.6},
  {module:"LPLC2_DNP01",weight:2,threshold:0.8},{module:"P1",weight:1,threshold:0.8}], 0.12, 4) };
const RUSHER: BotSpec = { id:"rusher", name:"RUSHER", chassis:"HORNET", brain: B([
  {module:"LC10A",weight:2.6,threshold:0.6},{module:"DNA02",weight:2.4,threshold:0.6},
  {module:"P1",weight:1.4,threshold:1.0}]) };
const CHAMP: BotSpec = { id:"champion", name:"CHAMPION", chassis:"HORNET", brain: champion.brain as BrainSpec };

for (const [a, b] of [[GHOST, RUSHER], [GHOST, CHAMP]] as const) {
  let aw = 0, bw = 0, d = 0, t = 0, n = 0;
  for (const s of ["d1","d2","d3","d4","d5","d6"]) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const g = runMatch(`demo-${s}`, x, y);
      let r = g.next(); while (!r.done) r = g.next();
      n++; t += r.value.ticks;
      if (!r.value.winnerBotId) d++;
      else if (r.value.winnerBotId === a.id) aw++; else bw++;
    }
  }
  console.log(`${a.name} vs ${b.name}: ${aw}-${bw}${d ? ` (${d}D)` : ""} over ${n} | avg ${(t/n/60).toFixed(0)}s`);
}
