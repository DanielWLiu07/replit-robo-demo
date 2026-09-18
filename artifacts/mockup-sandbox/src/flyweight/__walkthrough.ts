/** Can the game actually be finished? Every class against every level. */
import type { BotSpec } from "@workspace/contract";
import { runMatch } from "@workspace/sim";
import { ROSTER } from "./roster";
import { CAMPAIGN } from "./campaignLevels";

const play = (a: BotSpec, b: BotSpec, seed: string) => {
  const g = runMatch(seed, a, b);
  for (;;) { const s = g.next(); if (s.done) return s.value; }
};

const SEEDS = Array.from({ length: 12 }, (_, i) => `s${i}`);
console.log("class      level  opponent    win%  median  timeouts");
// A player who reached level 5 has been spending the growing pool in the lab.
// Testing only stock roster brains measures someone who never opened it.
const TUNED: BotSpec = {
  id: "tuned", name: "TUNED", chassis: "HORNET",
  brain: {
    slots: [
      { module: "LC10A", weight: 3.0, threshold: 0.7 },
      { module: "DNA02", weight: 2.6, threshold: 0.7 },
      { module: "P1", weight: 1.4, threshold: 1.0 },
      { module: "LC11", weight: 1.0, threshold: 1.1 },
    ],
    membraneLeak: 0.16, refractoryTicks: 3,
  },
};
for (const entry of [...ROSTER, { bot: TUNED, tag: "" }]) {
  let reachable = 0;
  for (const lvl of CAMPAIGN) {
    let wins = 0, to = 0; const len: number[] = [];
    for (const s of SEEDS) {
      const r = play(entry.bot, lvl.bot, `walk-${entry.bot.id}-${lvl.round}-${s}`);
      len.push(r.ticks);
      if (r.outcome !== "KO") to++;
      if (r.winnerBotId === entry.bot.id) wins++;
    }
    len.sort((x, y) => x - y);
    const rate = wins / SEEDS.length;
    if (rate >= 0.5) reachable = lvl.round;
    console.log(
      `${entry.bot.name.padEnd(9)}  ${String(lvl.round).padStart(2)}    ${lvl.bot.name.padEnd(10)}  ${String(Math.round(rate*100)+"%").padStart(4)}  ${(len[Math.floor(len.length/2)]!/60).toFixed(1).padStart(5)}s  ${to}/${SEEDS.length}`);
  }
  console.log(`${entry.bot.name.padEnd(9)}  -> clears up to level ${reachable} at >=50% win rate\n`);
}
