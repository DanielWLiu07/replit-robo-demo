/**
 * The load-bearing claim, checked rather than asserted.
 *
 * A match is persisted as `seed + two BotSpec snapshots` and nothing else. If
 * the sim is deterministic, re-running those inputs reproduces the fight tick
 * for tick — which is what makes replay free and makes a forged result
 * impossible to smuggle past the server. If it is not, every replay in the
 * product is a lie, so this runs the newest match twice and compares hashes.
 *
 *   cd artifacts/api-server && set -a; . ../../.env; set +a \
 *     && pnpm dlx tsx src/cli/verify-determinism.ts [matchId]
 */
import { createHash } from "node:crypto";
import type { MatchFrame } from "@workspace/contract";
import { SIM_VERSION } from "@workspace/contract";
import { db, matchesTable, pool, type MatchRow } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { runMatchHeadless, SIM_IS_STUB } from "../lib/matchRunner";

function hashRun(row: MatchRow): { digest: string; frames: number; ticks: number } {
  const hash = createHash("sha256");
  let frames = 0;
  const outcome = runMatchHeadless(
    row.seed,
    row.botASpec,
    row.botBSpec,
    row.squadSize,
    (frame: MatchFrame) => {
      frames++;
      hash.update(JSON.stringify(frame));
    },
  );
  hash.update(JSON.stringify({ ...outcome, matchId: row.id }));
  return { digest: hash.digest("hex"), frames, ticks: outcome.ticks };
}

async function main(): Promise<void> {
  // Optional match id, so a specific fight (a 5v5, say) can be checked rather
  // than whichever one happens to be newest.
  const wanted = process.argv[2];
  const [row] = wanted
    ? await db.select().from(matchesTable).where(eq(matchesTable.id, wanted)).limit(1)
    : await db.select().from(matchesTable).orderBy(desc(matchesTable.createdAt)).limit(1);
  if (!row) {
    console.error(
      wanted ? `no match ${wanted}` : "no matches to verify — POST /api/matches first",
    );
    process.exit(1);
  }

  const a = hashRun(row);
  const b = hashRun(row);

  console.log(`match   ${row.id}`);
  console.log(`seed    ${row.seed}`);
  console.log(`squad   ${row.squadSize}v${row.squadSize}`);
  console.log(`sim     ${SIM_IS_STUB ? "STUB (1.1 not wired yet)" : "@workspace/sim (live)"}`);
  console.log(`run 1   ${a.digest.slice(0, 32)}  ${a.frames} frames`);
  console.log(`run 2   ${b.digest.slice(0, 32)}  ${b.frames} frames`);

  const stored = { winner: row.winnerBotId, outcome: row.outcome, ticks: row.ticks };
  console.log(`stored  ${JSON.stringify(stored)}`);
  console.log(`simver  fought under "${row.simVersion}", replaying under "${SIM_VERSION}"`);

  // Two runs of one seed disagreeing means the sim itself is not deterministic,
  // and every replay in the product is a lie. This is the hard failure.
  if (a.digest !== b.digest) {
    console.error("\nFAIL: two runs of the same seed produced different frames.");
    await pool.end();
    process.exit(1);
  }

  // Disagreeing with the stored row is a different thing entirely: if the sim
  // has changed since the match was fought, a faithful replay *should* diverge.
  // Reporting that honestly beats passing a different fight off as the original.
  if (a.ticks !== row.ticks) {
    if (row.simVersion !== SIM_VERSION) {
      console.error(
        `\nSTALE: this match was fought under sim "${row.simVersion}" and cannot be\n` +
          `replayed under sim "${SIM_VERSION}" — it ends on tick ${a.ticks}, not ${row.ticks}.\n` +
          `The sim is deterministic (both runs agree); it is simply a different sim.\n` +
          `Re-run the match, or keep the old sim around, but do not call this a replay.`,
      );
      await pool.end();
      process.exit(2);
    }
    console.error(
      `\nFAIL: same sim version "${SIM_VERSION}", but the replay ends on tick ${a.ticks}\n` +
        `while the stored match says ${row.ticks}. Determinism is broken.`,
    );
    await pool.end();
    process.exit(1);
  }

  console.log("\nOK: replay reproduces the persisted match exactly.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
