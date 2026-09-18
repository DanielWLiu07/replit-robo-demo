/** Is a clean 1-5 clear reachable on the seeds the client actually uses? */
import { runMatch } from "@workspace/sim";
import type { BotSpec, NeuronModule } from "@workspace/contract";
import { CAMPAIGN } from "./campaignLevels";

const mk = (name: string, slots: Array<[NeuronModule, number, number]>, leak: number, refr: number): BotSpec => ({
  id: "pt", name, chassis: "HORNET",
  brain: { slots: slots.map(([module, weight, threshold]) => ({ module, weight, threshold })),
           membraneLeak: leak, refractoryTicks: refr },
});

const CANDIDATES: BotSpec[] = [];
for (const refr of [3, 6, 10, 14, 18, 22])
  for (const thr of [0.6, 0.75, 0.9])
    for (const leak of [0.14, 0.2, 0.28])
      CANDIDATES.push(mk(`r${refr}t${thr}l${leak}`, [
        ["LC10A", 2.8, thr], ["DNA02", 2.5, thr], ["P1", 1.5, thr + 0.3], ["LC11", 1.0, thr + 0.3],
      ], leak, refr));

// the client seeds its local match `flyweight-demo-${round}`, and round starts at
// 1 for the first fight, so a run of five uses rounds 1..5 in order
let best = { name: "none", cleared: 0 };
for (const me of CANDIDATES) {
  let cleared = 0;
  for (let lvl = 1; lvl <= 5; lvl++) {
    const g = runMatch(`flyweight-demo-${lvl}`, me, CAMPAIGN[lvl - 1]!.bot);
    let r = g.next(); while (!r.done) r = g.next();
    if (r.value.winnerBotId !== me.id) break;
    cleared = lvl;
  }
  if (cleared > best.cleared) best = { name: me.name, cleared };
  if (cleared === 5) { console.log(`CLEARS ALL FIVE: ${me.name}`); break; }
}
console.log(`best: ${best.name} cleared ${best.cleared}/5`);
