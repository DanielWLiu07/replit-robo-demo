/**
 * Does the campaign's point income actually buy anything?
 *
 * The pool grows 140 -> 180 over five rounds. If the extra points do not move the
 * win rate, the progression is decoration; if they swamp it, the ladder is over
 * after round two. Same build shape at each pool size, against the whole ladder.
 */
import { runMatch } from "./index.js";
import { solveBrain } from "./optimize.js";
import { ROSTER } from "../../../artifacts/mockup-sandbox/src/flyweight/roster.js";
import { CHAMPION_BRAIN } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
import type { BotSpec } from "@workspace/contract";

const foes: BotSpec[] = [...ROSTER.map((r) => r.bot), { ...CHAMPION_BRAIN, id: "champ" }];
const SEEDS = 6;

const rate = (brain: any, tag: string) => {
  const out: string[] = [];
  let wins = 0, total = 0;
  for (const foe of foes) {
    let w = 0, n = 0;
    const me: BotSpec = { id: "player", name: "player", chassis: "HORNET", brain };
    for (let s = 0; s < SEEDS; s++) for (const [A, B] of [[me, foe], [foe, me]] as const) {
      const g = runMatch(`pr-${tag}-${foe.id}-${s}-${A.id}`, A, B);
      let r = g.next(); while (!r.done) r = g.next();
      n++; if (r.value.winnerBotId === "player") w++;
    }
    out.push(`${((w / n) * 100).toFixed(0)}%`.padStart(7));
    wins += w; total += n;
  }
  return { cells: out, overall: (wins / total) * 100 };
};

console.log(`balanced build, HORNET, vs the ladder (${SEEDS} seeds each corner)\n`);
console.log(`${"pool".padEnd(14)}${foes.map((f) => f.name.slice(0, 6).padStart(7)).join("")}   overall`);
for (const [rounds, pool] of [[0, 140], [1, 148], [2, 156], [3, 164], [4, 172], [5, 180]] as const) {
  const each = Math.floor(pool / 3);
  const sol = solveBrain({ aggression: each, evasion: each, tracking: pool - 2 * each }, {});
  const r = rate(sol.brain, `p${pool}`);
  console.log(`${`${pool} (rd ${rounds})`.padEnd(14)}${r.cells.join("")}   ${r.overall.toFixed(0).padStart(3)}%`);
}
