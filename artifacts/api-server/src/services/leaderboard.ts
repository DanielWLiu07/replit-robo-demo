import {
  LeaderboardRow,
  type MatchOutcome,
} from "@workspace/contract";
import {
  botsTable,
  db,
  leaderboardTable,
  STARTING_ELO,
} from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { eloDelta } from "../lib/elo";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Recomputed inside the same transaction that writes the match result, so the
 * board can never show a win that no match row backs. Elo is plain Elo, K=24,
 * everyone starts at 1200.
 */
export async function applyMatchResult(
  tx: Tx,
  input: {
    botAId: string;
    botBId: string;
    winnerBotId: string | null;
    outcome: MatchOutcome;
    finishedAt: Date;
  },
): Promise<void> {
  const { botAId, botBId, winnerBotId, finishedAt } = input;

  await tx
    .insert(leaderboardTable)
    .values([{ botId: botAId }, { botId: botBId }])
    .onConflictDoNothing();

  const rows = await tx
    .select()
    .from(leaderboardTable)
    .where(inArray(leaderboardTable.botId, [botAId, botBId]));
  const byId = new Map(rows.map((r) => [r.botId, r]));
  const eloA = byId.get(botAId)?.elo ?? STARTING_ELO;
  const eloB = byId.get(botBId)?.elo ?? STARTING_ELO;

  const scoreA = winnerBotId === null ? 0.5 : winnerBotId === botAId ? 1 : 0;
  const deltaA = eloDelta(eloA, eloB, scoreA);
  const deltaB = eloDelta(eloB, eloA, 1 - scoreA);

  for (const [botId, elo, delta, score] of [
    [botAId, eloA, deltaA, scoreA],
    [botBId, eloB, deltaB, 1 - scoreA],
  ] as const) {
    await tx
      .update(leaderboardTable)
      .set({
        elo: elo + delta,
        wins: sql`${leaderboardTable.wins} + ${score === 1 ? 1 : 0}`,
        losses: sql`${leaderboardTable.losses} + ${score === 0 ? 1 : 0}`,
        draws: sql`${leaderboardTable.draws} + ${score === 0.5 ? 1 : 0}`,
        lastMatchAt: finishedAt,
        updatedAt: finishedAt,
      })
      .where(eq(leaderboardTable.botId, botId));
  }
}

export async function getLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
  const rows = await db
    .select({
      botId: leaderboardTable.botId,
      name: botsTable.name,
      chassis: botsTable.chassis,
      wins: leaderboardTable.wins,
      losses: leaderboardTable.losses,
      draws: leaderboardTable.draws,
      elo: leaderboardTable.elo,
    })
    .from(leaderboardTable)
    .innerJoin(botsTable, eq(botsTable.id, leaderboardTable.botId))
    .orderBy(desc(leaderboardTable.elo), desc(leaderboardTable.wins))
    .limit(limit);
  return rows.map((r) => LeaderboardRow.parse(r));
}
