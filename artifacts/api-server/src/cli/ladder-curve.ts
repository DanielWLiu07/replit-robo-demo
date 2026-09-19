/**
 * Measure the ladder difficulty curve.
 *
 *   cd artifacts/api-server && set -a; . ../../.env; set +a \
 *     && pnpm dlx tsx src/cli/ladder-curve.ts
 *
 * Fights every roster bot against the opponent each round would actually
 * generate, across several run seeds, and reports win rate, fight length and
 * how often a fight fails to end in a KO. The curve in docs/API-backend.md came
 * from this; change `src/ladder/difficulty.ts` and re-run it rather than
 * guessing, because difficulty here is not intuitive, see the notes in that
 * file for three plausible-sounding schemes that measurement killed.
 */
import type { BotSpec } from "@workspace/contract";
import { fitness, makeRng, runMatch } from "@workspace/sim";
import { db, pool, botsTable, brainsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { planRound } from "../ladder/difficulty";
import { pickOpponentBrain } from "../ladder/generate";

async function load(name: string): Promise<BotSpec> {
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.name, name)).limit(1);
  const [brain] = await db.select().from(brainsTable).where(eq(brainsTable.botId, bot!.id))
    .orderBy(desc(brainsTable.version)).limit(1);
  return { id: bot!.id, name: bot!.name, chassis: bot!.chassis, brain: brain!.spec };
}

function build(player: BotSpec, runSeed: string, round: number) {
  const plan = planRound(round);
  const rng = makeRng(`${runSeed}:round:${round}`);
  const picked = pickOpponentBrain(rng, plan, round, (brain) =>
    fitness(brain, plan.chassis, [player], 1).score);
  return { brain: picked.brain, plan };
}

const players = await Promise.all(
  ["CHAMPION", "COURTSHIP", "AROUSAL", "MOONWALKER", "GIANT FIBER"].map(load));
const SEEDS = ["a", "b", "c", "d", "e"];

console.log("round  chassis  budget  search   winrate  median  timeouts  survive");
let survive = 1;
const rates: number[] = [];
for (let round = 1; round <= 16; round++) {
  let wins = 0, n = 0, timeouts = 0;
  const lens: number[] = [];
  let plan = planRound(round);
  for (const player of players) {
    for (const sfx of SEEDS) {
      const { brain: ob } = build(player, `tune-${sfx}`, round);
      const opp: BotSpec = { id: "opp", name: "opp", chassis: plan.chassis, brain: ob };
      const gen = runMatch(`tune-${sfx}:m:${round}`, player, opp);
      let res; for (;;) { const st = gen.next(); if (st.done) { res = st.value; break; } }
      n++; lens.push(res.ticks);
      if (res.outcome !== "KO") timeouts++;
      if (res.winnerBotId === player.id) wins++;
    }
  }
  lens.sort((a, b) => a - b);
  const med = lens[Math.floor(lens.length / 2)]! / 60;
  const rate = wins / n;
  rates.push(rate);
  survive *= rate;
  console.log(
    `  ${String(round).padStart(2)}   ${plan.chassis.padEnd(7)}  ${plan.budgetFraction.toFixed(2)}     ${String(plan.candidates).padStart(2)}    ${String(Math.round(100*rate)+"%").padStart(5)}   ${med.toFixed(1).padStart(5)}s  ${String(timeouts+"/"+n).padStart(5)}   ${(100*survive).toFixed(0).padStart(3)}%`);
}
// Expected furthest round = sum over k of P(clearing the first k rounds).
let expected = 0, acc = 1;
for (const r of rates) { acc *= r; expected += acc; }
console.log(`\nexpected furthest round: ${expected.toFixed(1)}`);
await pool.end();
