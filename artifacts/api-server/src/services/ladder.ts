import {
  LadderLeaderboardRow,
  LadderRound,
  LadderRoundResult,
  LadderRun,
  LADDER_CLEAR_ROUND,
  LADDER_MAX_ROUND,
  SIM_VERSION,
  type BotSpec,
} from "@workspace/contract";
import {
  botsTable,
  brainsTable,
  db,
  ladderRoundsTable,
  ladderRunsTable,
  matchEventsTable,
  matchesTable,
  newSeed,
  type LadderRoundRow,
  type LadderRunRow,
} from "@workspace/db";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { forkJob } from "../lib/forkJob";
import { badRequest, forbidden, HttpError, notFound } from "../lib/http";
import type { Identity } from "../middlewares/identity";
import { loadBot, toBotSpec } from "./bots";

const ROUND_TIMEOUT_MS = 60_000;
/** Opponent search is CPU-bound; cap children the same way verification does. */
const MAX_CONCURRENT_ROUNDS = 2;
let inFlight = 0;

export class LadderBusyError extends HttpError {
  constructor() {
    super(429, "Too many ladder rounds running. Try again in a moment.");
    this.name = "LadderBusyError";
  }
}

function ownsRun(identity: Identity, row: LadderRunRow): boolean {
  if (row.ownerUserId !== null && identity.userId !== null) {
    return row.ownerUserId === identity.userId;
  }
  if (row.ownerGuestId !== null) return row.ownerGuestId === identity.guestId;
  return false;
}

function toRoundDto(row: LadderRoundRow) {
  return LadderRound.parse({
    round: row.round,
    matchId: row.matchId,
    opponent: row.opponentSpec,
    won: row.won,
    outcome: row.outcome,
    ticks: row.ticks,
    difficulty: row.difficulty,
    createdAt: row.createdAt.toISOString(),
  });
}

function toRunDto(row: LadderRunRow, rounds: LadderRoundRow[]) {
  return LadderRun.parse({
    id: row.id,
    seed: row.seed,
    status: row.status,
    bot: row.botSpec,
    botId: row.botId,
    round: row.round,
    clearTicks: row.totalTicks,
    simVersion: row.simVersion,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    rounds: rounds.map(toRoundDto),
  });
}

async function roundsFor(runId: string): Promise<LadderRoundRow[]> {
  return db
    .select()
    .from(ladderRoundsTable)
    .where(eq(ladderRoundsTable.runId, runId))
    .orderBy(ladderRoundsTable.round);
}

export async function getRun(runId: string): Promise<LadderRunRow> {
  const [row] = await db
    .select()
    .from(ladderRunsTable)
    .where(eq(ladderRunsTable.id, runId));
  if (!row) throw notFound(`No ladder run ${runId}`);
  return row;
}

export async function getRunDto(runId: string): Promise<LadderRun> {
  const row = await getRun(runId);
  return toRunDto(row, await roundsFor(runId));
}

export async function listRuns(identity: Identity, limit = 20): Promise<LadderRun[]> {
  const rows = await db
    .select()
    .from(ladderRunsTable)
    .where(
      identity.userId !== null
        ? or(
            eq(ladderRunsTable.ownerUserId, identity.userId),
            eq(ladderRunsTable.ownerGuestId, identity.guestId),
          )
        : eq(ladderRunsTable.ownerGuestId, identity.guestId),
    )
    .orderBy(desc(ladderRunsTable.createdAt))
    .limit(limit);
  return Promise.all(rows.map(async (r) => toRunDto(r, await roundsFor(r.id))));
}

/**
 * Starts a run. Your fly is snapshotted here and never re-read: retuning it
 * mid-run cannot retroactively change the rounds you already cleared.
 */
export async function startRun(
  identity: Identity,
  botId: string,
): Promise<LadderRun> {
  const { bot, brain } = await loadBot(botId);
  const spec = toBotSpec(bot, brain);

  const [row] = await db
    .insert(ladderRunsTable)
    .values({
      ownerUserId: identity.userId,
      ownerGuestId: identity.userId === null ? identity.guestId : null,
      botId: bot.id,
      botSpec: spec,
      seed: newSeed(),
      status: "ACTIVE",
      round: 0,
      simVersion: SIM_VERSION,
    })
    .returning();
  if (!row) throw new Error("ladder run insert returned nothing");
  return toRunDto(row, []);
}

/**
 * Fight the next round.
 *
 * The generated fly becomes a real `bots` row with a real brain revision, and
 * the fight becomes a real `matches` row. That is deliberate: it means a ladder
 * round is watchable on the ordinary /ws/match/:id socket, checkable with
 * /api/matches/:id/verify, and inspectable at /api/bots/:id: you can go and
 * read the brain that just knocked you out. The ladder adds no transport and no
 * second replay path of its own.
 *
 * Generated bots are flagged so they stay out of the bot list and the Elo
 * board, which are about bots somebody actually built.
 */
export async function playNextRound(
  identity: Identity,
  runId: string,
): Promise<{ run: LadderRun; round: LadderRound }> {
  const run = await getRun(runId);
  if (!ownsRun(identity, run)) throw forbidden("That ladder run isn't yours");
  if (run.status !== "ACTIVE") {
    throw badRequest(
      run.status === "CLEARED"
        ? "You already cleared this campaign. Start a new run"
        : "That run is over. Start a new one",
    );
  }
  if (run.round >= LADDER_MAX_ROUND) {
    throw badRequest(`Round ${LADDER_MAX_ROUND} is the top of the ladder`);
  }
  if (run.simVersion !== SIM_VERSION) {
    throw badRequest(
      `This run was started under sim v${run.simVersion} and the server now runs ` +
        `v${SIM_VERSION}. Continuing it would mix two different simulations in one ` +
        `run, start a new run.`,
    );
  }
  if (inFlight >= MAX_CONCURRENT_ROUNDS) throw new LadderBusyError();

  const round = run.round + 1;
  const matchSeed = `${run.seed}:m:${round}`;

  inFlight++;
  let result: LadderRoundResult;
  try {
    result = LadderRoundResult.parse(
      await forkJob<unknown>(
        "ladder",
        { runSeed: run.seed, round, player: run.botSpec, matchSeed },
        { timeoutMs: ROUND_TIMEOUT_MS },
      ),
    );
  } finally {
    inFlight--;
  }

  const playerSpec = run.botSpec;
  const won = result.winnerBotId === playerSpec.id;
  const finishedAt = new Date();

  const saved = await db.transaction(async (tx) => {
    // The generated fly, as a real bot with a real brain revision.
    const [oppBot] = await tx
      .insert(botsTable)
      .values({
        name: result.opponent.name,
        chassis: result.opponent.chassis,
        isSeed: false,
        isGenerated: true,
        ownerUserId: null,
        ownerGuestId: null,
      })
      .returning();
    if (!oppBot) throw new Error("opponent bot insert returned nothing");

    const [oppBrain] = await tx
      .insert(brainsTable)
      .values({ botId: oppBot.id, version: 1, spec: result.opponent.brain })
      .returning();
    if (!oppBrain) throw new Error("opponent brain insert returned nothing");

    // Re-point the snapshot at the real row id so the match replays to exactly
    // the ids the frames carry.
    const opponentSpec: BotSpec = { ...result.opponent, id: oppBot.id };
    const winnerBotId = won ? playerSpec.id : result.winnerBotId === null ? null : oppBot.id;

    const [playerBrainRow] = await tx
      .select()
      .from(brainsTable)
      .where(eq(brainsTable.botId, run.botId))
      .orderBy(desc(brainsTable.version))
      .limit(1);

    const [match] = await tx
      .insert(matchesTable)
      .values({
        seed: matchSeed,
        status: "COMPLETE",
        botAId: run.botId,
        botBId: oppBot.id,
        botABrainId: playerBrainRow!.id,
        botBBrainId: oppBrain.id,
        botASpec: playerSpec,
        botBSpec: opponentSpec,
        winnerBotId,
        outcome: result.outcome,
        ticks: result.ticks,
        squadSize: 1,
        survivors: result.survivors,
        simVersion: SIM_VERSION,
        finishedAt,
      })
      .returning();
    if (!match) throw new Error("ladder match insert returned nothing");

    await tx.insert(matchEventsTable).values([
      ...result.hits.map((h) => ({
        matchId: match.id,
        tick: h.tick,
        kind: "HIT" as const,
        payload: { attacker: h.attacker, damage: h.damage },
      })),
      {
        matchId: match.id,
        tick: result.ticks,
        kind:
          result.outcome === "KO"
            ? ("KO" as const)
            : result.outcome === "DRAW"
              ? ("DRAW" as const)
              : ("TIMEOUT" as const),
        payload: { winnerBotId, round, ladderRunId: run.id },
      },
    ]);

    const [roundRow] = await tx
      .insert(ladderRoundsTable)
      .values({
        runId: run.id,
        round,
        matchId: match.id,
        opponentBotId: oppBot.id,
        opponentSpec,
        opponentChassis: result.opponent.chassis,
        won,
        outcome: result.outcome,
        ticks: result.ticks,
        difficulty: result.difficulty,
      })
      .returning();
    if (!roundRow) throw new Error("ladder round insert returned nothing");

    // Clear time accrues on every round fought, won or lost, so a run cannot be
    // made to look faster by throwing the last fight.
    const totalTicks = run.totalTicks + result.ticks;
    // A draw is not a win: the run ends. Otherwise the ladder would stall on any
    // pairing that cannot resolve.
    const cleared = won && round >= LADDER_CLEAR_ROUND;
    const [updatedRun] = await tx
      .update(ladderRunsTable)
      .set(
        won
          ? cleared
            ? {
                round,
                totalTicks,
                status: "CLEARED" as const,
                endedAt: finishedAt,
              }
            : { round, totalTicks }
          : { status: "ENDED" as const, totalTicks, endedAt: finishedAt },
      )
      .where(eq(ladderRunsTable.id, run.id))
      .returning();

    return { runRow: updatedRun ?? run, roundRow };
  });

  return {
    run: toRunDto(saved.runRow, await roundsFor(run.id)),
    round: toRoundDto(saved.roundRow),
  };
}

/**
 * Cleared runs first, fastest clear time wins. Everyone who did not finish is
 * ranked below them by how far they got, because "nearly cleared" still beats
 * "died on round two" and there is no clear time to compare.
 */
export async function ladderLeaderboard(limit = 25): Promise<LadderLeaderboardRow[]> {
  const rows = await db
    .select({
      runId: ladderRunsTable.id,
      round: ladderRunsTable.round,
      status: ladderRunsTable.status,
      clearTicks: ladderRunsTable.totalTicks,
      simVersion: ladderRunsTable.simVersion,
      createdAt: ladderRunsTable.createdAt,
      botName: botsTable.name,
      chassis: botsTable.chassis,
    })
    .from(ladderRunsTable)
    .innerJoin(botsTable, eq(botsTable.id, ladderRunsTable.botId))
    // Finished attempts only. A run still in progress has no result to rank and
    // would sit on the board claiming a place it has not earned yet.
    .where(and(eq(botsTable.isGenerated, false), ne(ladderRunsTable.status, "ACTIVE")))
    .orderBy(
      // CLEARED above everything, then ascending clear time within it.
      sql`case when ${ladderRunsTable.status} = 'CLEARED' then 0 else 1 end`,
      sql`case when ${ladderRunsTable.status} = 'CLEARED' then ${ladderRunsTable.totalTicks} end asc`,
      desc(ladderRunsTable.round),
      ladderRunsTable.createdAt,
    )
    .limit(limit);
  return rows.map((r) =>
    LadderLeaderboardRow.parse({
      ...r,
      cleared: r.status === "CLEARED",
      createdAt: r.createdAt.toISOString(),
    }),
  );
}

export { ownsRun };
