import { runMatch } from "./index.js";
import type { BotSpec } from "@workspace/contract";
const SL = [{ module: "LC10A", weight: 1.8, threshold: 0.6 }, { module: "DNA02", weight: 1.4, threshold: 0.7 },
            { module: "LPLC2_DNP01", weight: 1.2, threshold: 0.8 }];
const mk = (id: string, ch: any): BotSpec => ({ id, name: id, chassis: ch, brain: { slots: SL, membraneLeak: 0.2, refractoryTicks: 6 } });
const CH = ["DRONE", "HORNET", "TANK"] as const;
console.log("matchup        KO/10  avg    hits   winner split");
for (let i = 0; i < CH.length; i++) for (let j = i; j < CH.length; j++) {
  const A = mk("a", CH[i]), B = mk("b", CH[j]);
  let ko = 0, ticks = 0, hits = 0, aw = 0;
  for (let s = 0; s < 10; s++) {
    const g = runMatch(`ch${s}`, A, B); let r = g.next(), n = 0;
    while (!r.done) { n++; hits += (r.value as any).hits?.length ?? 0; r = g.next(); }
    ticks += n; if (n < 5398) ko++;
    if (r.value.winnerBotId === "a") aw++;
  }
  console.log(`${CH[i]} v ${CH[j]}`.padEnd(16) + `${ko}/10  ${(ticks/10/60).toFixed(0)}s`.padEnd(8) +
              `${(hits/10).toFixed(1)}`.padEnd(7) + `${aw}-${10-aw}`);
}
