import { runMatch } from "./index.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
const [A, B] = DEFAULT_BOTS;
console.log(`p1 = ${A.name} (${A.chassis})  circuits: ${A.brain.slots.map(s => s.module).join(",")}`);
console.log(`p2 = ${B.name} (${B.chassis})  circuits: ${B.brain.slots.map(s => s.module).join(",")}\n`);
let zeroSide = 0;
for (let s = 0; s < 10; s++) {
  const g = runMatch(`wd${s}`, A, B);
  let r = g.next();
  const dealt: Record<string, number> = {}; const punches: Record<string, number> = {};
  let prev: any = null;
  while (!r.done) {
    const f: any = r.value;
    for (const h of (f.hits ?? [])) dealt[h.attacker] = (dealt[h.attacker] ?? 0) + h.damage;
    for (const u of f.bots) {
      const p = prev?.[u.botId];
      if (p && Math.max(Math.abs(u.armLv) - p[0], Math.abs(u.armRv) - p[1]) > 5)
        punches[u.botId] = (punches[u.botId] ?? 0) + 1;
    }
    prev = {}; for (const u of f.bots) prev[u.botId] = [Math.abs(u.armLv), Math.abs(u.armRv)];
    r = g.next();
  }
  const a = dealt[A.id] ?? 0, b = dealt[B.id] ?? 0;
  if (a === 0 || b === 0) zeroSide++;
  console.log(`  seed ${s}: ${A.id} dealt ${a.toFixed(0)} (${punches[A.id] ?? 0} punches) | ` +
              `${B.id} dealt ${b.toFixed(0)} (${punches[B.id] ?? 0} punches)` +
              (a === 0 || b === 0 ? "   <-- ONE SIDE DEALT ZERO" : ""));
}
console.log(`\nmatches where a side dealt zero damage: ${zeroSide}/10`);
