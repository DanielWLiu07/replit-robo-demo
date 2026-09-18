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
import { weightBudgetFor, type BotSpec } from "@workspace/contract";

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
console.log(`${"budget".padEnd(16)}${foes.map((f) => f.name.slice(0, 6).padStart(7)).join("")}   overall`);
// The pool stays generous; what changes is the WEIGHT the campaign has paid for.
for (const rounds of [0, 1, 2, 3, 4, 5]) {
  const budget = weightBudgetFor(rounds);
  // Max the dials: only then does the ask exceed the budget and the ceiling bite.
  const each = 100;
  const sol = solveBrain({ aggression: each, evasion: each, tracking: each }, {}, budget);
  const spent = sol.brain.slots.reduce((a, x) => a + x.weight, 0);
  const r = rate(sol.brain, `b${budget}`);
  console.log(`${`${budget} (rd ${rounds}) ${spent.toFixed(1)}`.padEnd(16)}${r.cells.join("")}   ${r.overall.toFixed(0).padStart(3)}%`);
}
