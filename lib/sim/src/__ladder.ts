/**
 * Is the pool worth spending in more than one way?
 *
 * The player now starts with nothing spent and distributes a 140-point pool, so the
 * question balance has to answer is no longer "are the three chassis even" but "is
 * there a way to spend the pool that is simply correct". A dominant distribution
 * means the choice the lab exists for is fake.
 */
import { runMatch } from "./index.js";
import { solveBrain } from "./optimize.js";
import { profileBrain } from "./profile.js";
import { ROSTER } from "../../../artifacts/mockup-sandbox/src/flyweight/roster.js";
import { CHAMPION_BRAIN } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
import type { BotSpec, Chassis } from "@workspace/contract";

const POOL = 140;
const SHAPES: Array<[string, [number, number, number]]> = [
  ["all pressure",  [100, 40, 0]],
  ["all evasion",   [0, 100, 40]],
  ["all tracking",  [40, 0, 100]],
  ["balanced",      [47, 47, 46]],
  ["press+track",   [70, 0, 70]],
  ["press+evade",   [70, 70, 0]],
];
const CHASSIS: Chassis[] = ["DRONE", "HORNET", "TANK"];
const foes: BotSpec[] = [...ROSTER.map((r) => r.bot), { ...CHAMPION_BRAIN, id: "champ" }];
const SEEDS = 5;

console.log(`player pool ${POOL} pts · ${SHAPES.length} shapes × ${CHASSIS.length} chassis` +
  ` vs ${foes.length} opponents × ${SEEDS} seeds\n`);
console.log(`${"".padEnd(15)}${CHASSIS.map((c) => c.padStart(8)).join("")}    overall`);

const rows: Array<[string, number]> = [];
const perFoe = new Map<string, { w: number; n: number }>();
for (const [label, [a, e, t]] of SHAPES) {
  const sol = solveBrain({ aggression: a, evasion: e, tracking: t }, {});
  const got = profileBrain(sol.brain, "HORNET");
  const cells: string[] = [];
  let wins = 0, total = 0;
  for (const chassis of CHASSIS) {
    let w = 0, n = 0;
    const me: BotSpec = { id: "player", name: "player", chassis, brain: sol.brain };
    for (const foe of foes) for (let s = 0; s < SEEDS; s++) {
      // play both corners so spawn side cannot flatter a build
      for (const [A, B] of [[me, foe], [foe, me]] as const) {
        const g = runMatch(`ld-${label}-${chassis}-${foe.id}-${s}-${A.id}`, A, B);
        let r = g.next(); while (!r.done) r = g.next();
        n++; if (r.value.winnerBotId === "player") w++;
        const f = perFoe.get(foe.name) ?? { w: 0, n: 0 };
        f.n++; if (r.value.winnerBotId === "player") f.w++;
        perFoe.set(foe.name, f);
      }
    }
    cells.push(`${((w / n) * 100).toFixed(0)}%`.padStart(8));
    wins += w; total += n;
  }
  const overall = (wins / total) * 100;
  rows.push([label, overall]);
  console.log(`${label.padEnd(15)}${cells.join("")}    ${overall.toFixed(0).padStart(3)}%` +
    `   (got ${got.aggression}/${got.evasion}/${got.tracking})`);
}
const best = Math.max(...rows.map((r) => r[1])), worst = Math.min(...rows.map((r) => r[1]));
console.log(`\nspread ${worst.toFixed(0)}% – ${best.toFixed(0)}%  =  ${(best - worst).toFixed(0)} points` +
  `   ${best - worst > 30 ? "← one shape dominates" : "← no dominant shape"}`);

console.log(`\nhow hard is each opponent (player win rate over ALL shapes and chassis):`);
const diff = [...perFoe.entries()].map(([k, v]) => [k, (v.w / v.n) * 100] as const)
  .sort((a, b) => a[1] - b[1]);
for (const [name, pct] of diff)
  console.log(`  ${name.padEnd(10)} ${pct.toFixed(0).padStart(3)}% ${"#".repeat(Math.round(pct / 3))}`);
const dspread = diff[diff.length - 1]![1] - diff[0]![1];
console.log(`  ladder spread ${dspread.toFixed(0)} points` +
  `   ${dspread > 35 ? "← opponents are not equally hard" : "← reasonably even"}`);
