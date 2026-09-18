/**
 * Who wins, how fast, and how one-sided is it?
 *
 * `__matchups` only reports "decisive in N seconds", which hides a blowout: a KO at
 * 11s with one side untouched is decisive AND unwatchable. This reports the split.
 */
import { runMatch } from "./index.js";
import { ROSTER } from "../../../artifacts/mockup-sandbox/src/flyweight/roster.js";
import { DEFAULT_BOTS, CHAMPION_BRAIN } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
import { CHASSIS_STATS, type BotSpec } from "@workspace/contract";

const byId = (id: string) => ROSTER.find((r) => r.bot.id === id)!.bot;

const pairs: Array<[string, BotSpec, BotSpec]> = [
  // the pairing a stranger actually lands on: Flyweight's p1/p2 defaults
  ["SHIPPED  ghost vs hornet", DEFAULT_BOTS[0]!, byId("hornet")],
  ["BOSS     ghost vs champ ", DEFAULT_BOTS[0]!, { ...CHAMPION_BRAIN, name: "CHAMPION / BOSS" }],
  ["         drone vs hornet", byId("drone"), byId("hornet")],
  ["         drone vs tank  ", byId("drone"), byId("tank")],
  ["         hornet vs tank ", byId("hornet"), byId("tank")],
  ["         tank vs champ  ", byId("tank"), { ...CHAMPION_BRAIN }],
];

for (const [name, A, B] of pairs) {
  const wins = [0, 0, 0];  // A, B, draw
  let ticks = 0; let margin = 0;   // winner's remaining hull as a fraction
  const hit = [0, 0], dmg = [0, 0], guard = [0, 0], lock = [0, 0]; let n = 0;
  for (let s = 0; s < 12; s++) {
    const g = runMatch(`lop-${name}-${s}`, A, B);
    let r = g.next(), last: any = null;
    while (!r.done) {
      last = r.value;
      for (const h of (last.hits ?? [])) {
        // a hit is credited to the side that THREW it
        const side = last.bots.findIndex((x: any) => x.botId === h.attacker) < last.teamSplit ? 0 : 1;
        hit[side]!++; dmg[side]! += h.damage;
      }
      const a0 = last.bots[0], b0 = last.bots[last.teamSplit];
      guard[0]! += a0.guard; guard[1]! += b0.guard;
      lock[0]! += a0.potentials?.LC11 ?? 0; lock[1]! += b0.potentials?.LC11 ?? 0;
      n++;
      r = g.next();
    }
    const res = r.value;
    ticks += res.ticks;
    const a = last.bots[0], b = last.bots[last.teamSplit];
    const winner = res.winnerBotId === A.id ? 0 : res.winnerBotId === B.id ? 1 : 2;
    wins[winner]!++;
    // how much of the winner's health bar was left when it ended
    if (winner < 2) {
      const w = winner === 0 ? a : b, spec = winner === 0 ? A : B;
      margin += Math.max(0, w.hull) / CHASSIS_STATS[spec.chassis].hull;
    }
  }
  const dec = wins[0]! + wins[1]!;
  console.log(
    `${name}  ${String(wins[0]).padStart(2)}-${String(wins[1]).padStart(2)}` +
    `${wins[2] ? ` (+${wins[2]} draw)` : "        "}  avg ${(ticks / 12 / 60).toFixed(0).padStart(2)}s` +
    `  winner keeps ${dec ? ((margin / dec) * 100).toFixed(0).padStart(3) : " --"}% hull` +
    `  hits ${(hit[0]! / 12).toFixed(1).padStart(4)}v${(hit[1]! / 12).toFixed(1).padStart(4)}` +
    `  dmg ${(dmg[0]! / 12).toFixed(0).padStart(3)}v${(dmg[1]! / 12).toFixed(0).padStart(3)}` +
    `  per-hit ${(dmg[0]! / Math.max(1, hit[0]!)).toFixed(1).padStart(4)}v${(dmg[1]! / Math.max(1, hit[1]!)).toFixed(1).padStart(4)}` +
    `  guard ${(guard[0]! / n).toFixed(2)}v${(guard[1]! / n).toFixed(2)}`,
  );
}
