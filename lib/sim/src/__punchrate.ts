import { runMatch } from "./index.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
const [a, b] = DEFAULT_BOTS;
let punches = 0, hits = 0, ko = 0, draw = 0, ticks = 0;
for (let s = 0; s < 14; s++) {
  const g = runMatch(`pr${s}`, a, b);
  let r = g.next(); let prev: any = null; let n = 0;
  while (!r.done) {
    const f: any = r.value; n++; hits += f.hits?.length ?? 0;
    for (const u of f.bots) {
      const p = prev?.[u.botId];
      if (p !== undefined) {
        const j = Math.max(Math.abs(u.armLv) - Math.abs(p[0]), Math.abs(u.armRv) - Math.abs(p[1]));
        if (j > 5) punches++;
      }
    }
    prev = {}; for (const u of f.bots) prev[u.botId] = [Math.abs(u.armLv), Math.abs(u.armRv)];
    r = g.next();
  }
  ticks += n; if (r.value.winnerBotId) ko++; else draw++;
}
console.log(`  punches ${(punches/14).toFixed(1)}/match | landed ${(hits/14).toFixed(1)} | decisive ${ko}/${ko+draw} | avg ${Math.round(ticks/14)}t (${(ticks/14/60).toFixed(0)}s)`);
