import type {
  BotSpec,
  MatchEventKind,
  MatchOutcome,
  MatchStatus,
} from "@workspace/contract";
import { relations } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { botsTable } from "./bots";
import { brainsTable } from "./brains";
import { newId } from "./ids";

/**
 * A match IS `seed + two BotSpec snapshots`. Not a single frame is stored,
 * replaying means handing those three things back to the deterministic sim and
 * letting it produce the same 5400 frames it produced the first time.
 *
 * `bot_a_spec` / `bot_b_spec` are the snapshots and are the authoritative
 * replay input; `bot_a_brain_id` / `bot_b_brain_id` are lineage, so you can ask
 * "which revision of my bot won that?" and link back to it. Keeping the
 * snapshot rather than only the FK means a replay is one row read with no
 * joins, and it survives a cascade delete of the bot that fought.
 */
export const matchesTable = pgTable(
  "matches",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("mch")),
    /** the entire replay, in one column. */
    seed: text("seed").notNull(),
    status: text("status").$type<MatchStatus>().notNull().default("PENDING"),

    botAId: text("bot_a_id")
      .notNull()
      .references(() => botsTable.id, { onDelete: "cascade" }),
    botBId: text("bot_b_id")
      .notNull()
      .references(() => botsTable.id, { onDelete: "cascade" }),
    botABrainId: text("bot_a_brain_id")
      .notNull()
      .references(() => brainsTable.id),
    botBBrainId: text("bot_b_brain_id")
      .notNull()
      .references(() => brainsTable.id),
    botASpec: jsonb("bot_a_spec").$type<BotSpec>().notNull(),
    botBSpec: jsonb("bot_b_spec").$type<BotSpec>().notNull(),

    winnerBotId: text("winner_bot_id"),
    outcome: text("outcome").$type<MatchOutcome>(),
    ticks: integer("ticks").notNull().default(0),
    /**
     * Units per side. This is replay input, not decoration: the same seed and
     * the same two snapshots produce a completely different fight at 5v5 than
     * at 1v1, so a replay that guessed would be showing a match nobody fought.
     * Rows written before squads existed are 1v1, which is what the default says.
     */
    squadSize: integer("squad_size").notNull().default(1),
    /** [aLeft, bLeft] when it ended. Derivable by replaying; kept so a list view doesn't have to. */
    survivors: jsonb("survivors").$type<[number, number]>(),
    /**
     * The sim that produced this row. A replay is only the *same fight* when it
     * runs under the same sim; rows written before this column existed say
     * "unknown", which is the truthful answer for them.
     */
    simVersion: text("sim_version").notNull().default("unknown"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("matches_created_idx").on(t.createdAt),
    index("matches_bot_a_idx").on(t.botAId),
    index("matches_bot_b_idx").on(t.botBId),
    index("matches_status_idx").on(t.status),
  ],
);

/**
 * Append-only highlight reel: KOs and hits, never frames. This is what lets the
 * match list show "KO on tick 1,832" without re-running the sim, and what a
 * scrubber seeks against.
 */
export const matchEventsTable = pgTable(
  "match_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    tick: integer("tick").notNull(),
    kind: text("kind").$type<MatchEventKind>().notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [index("match_events_match_tick_idx").on(t.matchId, t.tick)],
);

export const matchesRelations = relations(matchesTable, ({ one, many }) => ({
  botA: one(botsTable, {
    fields: [matchesTable.botAId],
    references: [botsTable.id],
    relationName: "botA",
  }),
  botB: one(botsTable, {
    fields: [matchesTable.botBId],
    references: [botsTable.id],
    relationName: "botB",
  }),
  events: many(matchEventsTable),
}));

export const matchEventsRelations = relations(matchEventsTable, ({ one }) => ({
  match: one(matchesTable, {
    fields: [matchEventsTable.matchId],
    references: [matchesTable.id],
  }),
}));

export type InsertMatch = typeof matchesTable.$inferInsert;
export type MatchRow = typeof matchesTable.$inferSelect;
export type InsertMatchEvent = typeof matchEventsTable.$inferInsert;
export type MatchEventRow = typeof matchEventsTable.$inferSelect;
