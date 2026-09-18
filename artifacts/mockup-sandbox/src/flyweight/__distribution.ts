/** Does distributing actually decide fights? Unspent vs spread vs focused. */
import { solveBrain, runMatch } from "@workspace/sim";
import { weightBudgetFor, type BotSpec } from "@workspace/contract";
import { CAMPAIGN } from "./campaignLevels";

const build = (name: string, t: {aggression:number;evasion:number;tracking:number}, rounds: number): BotSpec => ({
  id: name, name, chassis: "HORNET",
  brain: solveBrain(t, {}, weightBudgetFor(rounds)).brain,
});

const SEEDS = 10;
const vs = (me: BotSpec) => {
  const cells: string[] = []; let w = 0, n = 0;
  for (const lvl of CAMPAIGN) {
    let lw = 0;
    for (let s = 0; s < SEEDS; s++) {
      const g = runMatch(`dist-${lvl.round}-${s}`, me, lvl.bot);
      let r = g.next(); while (!r.done) r = g.next();
      if (r.value.winnerBotId === me.id) { lw++; w++; }
      n++;
    }
    cells.push(`${Math.round((lw / SEEDS) * 100)}%`.padStart(6));
  }
  return { cells, overall: Math.round((w / n) * 100) };
};

const rows: [string, BotSpec][] = [
  ["unspent      ", build("p", { aggression: 4, evasion: 4, tracking: 4 }, 0)],
  ["thin spread  ", build("p", { aggression: 25, evasion: 25, tracking: 25 }, 0)],
  ["half spent   ", build("p", { aggression: 55, evasion: 40, tracking: 55 }, 0)],
  // maxed, so the ask EXCEEDS the budget and the campaign's weight decides
  ["maxed rd0    ", build("p", { aggression: 100, evasion: 100, tracking: 100 }, 0)],
  ["maxed rd3    ", build("p", { aggression: 100, evasion: 100, tracking: 100 }, 3)],
  ["maxed rd5    ", build("p", { aggression: 100, evasion: 100, tracking: 100 }, 5)],
];
console.log(`${"build".padEnd(14)}${CAMPAIGN.map(l => l.bot.name.slice(0,5).padStart(6)).join("")}  overall  weight`);
for (const [label, bot] of rows) {
  const r = vs(bot);
  const wt = bot.brain.slots.reduce((a, x) => a + x.weight, 0);
  console.log(`${label}${r.cells.join("")}  ${String(r.overall+"%").padStart(6)}   ${wt.toFixed(1)}`);
}
