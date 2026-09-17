import {
  Match as MatchDto,
  MatchEvent,
  MatchWithEvents,
  MAX_SQUAD,
  SIM_VERSION,
  type BotSpec,
  type MatchFrame,
  type MatchResult,
  type StartMatchRequest,
} from "@workspace/contract";
import {
  db,
  matchEventsTable,
  matchesTable,
  newSeed,
  type InsertMatchEvent,
  type MatchRow,
} from "@workspace/db";
import { desc, eq, or } from "drizzle-orm";
import { badRequest, notFound } from "../lib/http";
import { runMatchHeadless } from "../lib/matchRunner";
import type { Identity } from "../middlewares/identity";
import { loadBot, pickOpponent, toBotSpec, type LoadedBot } from "./bots";
import { applyMatchResult } from "./leaderboard";

/** Hits are frequent; the highlight reel is not the frame log. */
const MAX_HIT_EVENTS = 200;

export function toMatchDto(row: MatchRow) {
  return MatchDto.parse({
    id: row.id,
    seed: row.seed,
    status: row.status,
    bots: [row.botASpec, row.botBSpec],
    brainIds: [row.botABrainId, row.botBBrainId],
    winnerBotId: row.winnerBotId,
    outcome: row.outcome,
    ticks: row.ticks,
    squadSize: row.squadSize,
    survivors: row.survivors ?? null,
    simVersion: row.simVersion,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

export async function getMatchRow(matchId: string): Promise<MatchRow> {
  const [row] = await db.select().from(matchesTable).where(eq(matchesTable.id, matchId));
  if (!row) throw notFound(`No match ${matchId}`);
  return row;
}

export async function getMatchEvents(matchId: string): Promise<MatchEvent[]> {
  const rows = await db
    .select()
    .from(matchEventsTable)
    .where(eq(matchEventsTable.matchId, matchId))
    .orderBy(matchEventsTable.tick);
  return rows.map((r) => MatchEvent.parse({ tick: r.tick, kind: r.kind, payload: r.payload }));
}

export async function getMatchWithEvents(matchId: string): Promise<MatchWithEvents> {
  const [row, events] = await Promise.all([getMatchRow(matchId), getMatchEvents(matchId)]);
  return MatchWithEvents.parse({ ...toMatchDto(row), events });
}

export async function listMatches(opts: { botId?: string; limit?: number } = {}) {
  const base = db.select().from(matchesTable);
  const rows = await (opts.botId
    ? base.where(or(eq(matchesTable.botAId, opts.botId), eq(matchesTable.botBId, opts.botId)))
    : base
  )
    .orderBy(desc(matchesTable.createdAt))
    .limit(opts.limit ?? 25);
  return rows.map(toMatchDto);
}

/**
 * Create, fight, persist — in that order, synchronously.
 *
 * The sim runs headless here rather than lazily on the socket, because the
 * result is what the leaderboard and the match list are about and it costs
 * milliseconds. The socket then *replays* the fight from `seed + snapshots`.
 * Live viewing and replay are therefore the same code path, which is the whole
 * point of making the sim deterministic: there is no second implementation to
 * disagree with the first.
 *
 * Both BotSpecs are snapshotted into the row. Retuning your bot after this
 * point appends a new brain revision and leaves this match untouched.
 */
export async function startMatch(
  identity: Identity,
  input: StartMatchRequest,
): Promise<MatchWithEvents> {
  const a: LoadedBot = await loadBot(input.botId);
  const b: LoadedBot = input.opponentBotId
    ? await loadBot(input.opponentBotId)
    : await pickOpponent(input.botId);

  if (a.bot.id === b.bot.id) {
    // Not a 404 — both bots exist, the pairing is the problem.
    throw badRequest("A bot cannot fight itself");
  }

  const seed = newSeed();
  const squadSize = Math.min(Math.max(input.squadSize ?? 1, 1), MAX_SQUAD);
  const specA = toBotSpec(a.bot, a.brain);
  const specB = toBotSpec(b.bot, b.brain);

  const hits: InsertMatchEvent[] = [];
  let hitCount = 0;
  const collect = (frame: MatchFrame) => {
    for (const hit of frame.hits) {
      hitCount++;
      if (hits.length < MAX_HIT_EVENTS) {
        hits.push({
          matchId: "",
          tick: frame.tick,
          kind: "HIT",
          payload: { attacker: hit.attacker, damage: Number(hit.damage.toFixed(3)) },
        });
      }
    }
  };

  // Drained at full speed; `matchId` comes back empty and is filled in below.
  const outcome: MatchResult = runMatchHeadless(seed, specA, specB, squadSize, collect);
  const finishedAt = new Date();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(matchesTable)
      .values({
        seed,
        status: "COMPLETE",
        botAId: a.bot.id,
        botBId: b.bot.id,
        botABrainId: a.brain.id,
        botBBrainId: b.brain.id,
        botASpec: specA satisfies BotSpec,
        botBSpec: specB satisfies BotSpec,
        winnerBotId: outcome.winnerBotId,
        outcome: outcome.outcome,
        ticks: outcome.ticks,
        squadSize,
        survivors: outcome.survivors ?? null,
        simVersion: SIM_VERSION,
        finishedAt,
      })
      .returning();
    if (!row) throw new Error("match insert returned nothing");

    const terminal: InsertMatchEvent = {
      matchId: row.id,
      tick: outcome.ticks,
      kind:
        outcome.outcome === "KO" ? "KO" : outcome.outcome === "DRAW" ? "DRAW" : "TIMEOUT",
      payload: {
        winnerBotId: outcome.winnerBotId,
        totalHits: hitCount,
        truncatedHitLog: hitCount > MAX_HIT_EVENTS,
      },
    };
    await tx
      .insert(matchEventsTable)
      .values([...hits.map((h) => ({ ...h, matchId: row.id })), terminal]);

    await applyMatchResult(tx, {
      botAId: a.bot.id,
      botBId: b.bot.id,
      winnerBotId: outcome.winnerBotId,
      outcome: outcome.outcome,
      finishedAt,
    });

    const events = await tx
      .select()
      .from(matchEventsTable)
      .where(eq(matchEventsTable.matchId, row.id))
      .orderBy(matchEventsTable.tick);

    return MatchWithEvents.parse({
      ...toMatchDto(row),
      events: events.map((e) => ({ tick: e.tick, kind: e.kind, payload: e.payload })),
    });
  });
}
