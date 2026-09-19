import type {
  BotSpec,
  Chassis,
  LadderDifficulty,
  LadderStatus,
  MatchOutcome,
} from "@workspace/contract";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { botsTable } from "./bots";
import { newId } from "./ids";
import { matchesTable } from "./matches";
import { usersTable } from "./users";

/**
 * A ladder run: successive rounds against generated flies, each harder than the
 * last. Losing ends the run and the round you reached is the score.
 *
 * `bot_spec` pins your fly at the moment the run started. Retuning mid-run must
 * not retroactively change the rounds you already cleared, the same rule that
 * makes brain revisions append-only, applied one level up.
 */
export const ladderRunsTable = pgTable(
  "ladder_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("run")),
    ownerUserId: integer("owner_user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    ownerGuestId: text("owner_guest_id"),

    botId: text("bot_id")
      .notNull()
      .references(() => botsTable.id, { onDelete: "cascade" }),
    botSpec: jsonb("bot_spec").$type<BotSpec>().notNull(),

    /** every opponent in the run derives from (seed, round). */
    seed: text("seed").notNull(),
    status: text("status").$type<LadderStatus>().notNull().default("ACTIVE"),
    /** furthest round cleared. */
    round: integer("round").notNull().default(0),
    /** summed match ticks across the run, the clear-time ranking key. */
    totalTicks: integer("total_ticks").notNull().default(0),
    simVersion: text("sim_version").notNull().default("unknown"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("ladder_runs_owner_user_idx").on(t.ownerUserId),
    index("ladder_runs_owner_guest_idx").on(t.ownerGuestId),
    index("ladder_runs_round_idx").on(t.round),
    index("ladder_runs_status_idx").on(t.status),
  ],
);

/**
 * One round. The opponent is snapshotted rather than only derived, for the same
 * reason matches snapshot their BotSpecs: generation depends on the sim's
 * `randomBrain`, so a change there would otherwise silently rewrite what you
 * fought. `match_id` points at a real match row, so a ladder fight replays on
 * the ordinary socket and passes through the ordinary verifier.
 */
export const ladderRoundsTable = pgTable(
  "ladder_rounds",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rnd")),
    runId: text("run_id")
      .notNull()
      .references(() => ladderRunsTable.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    matchId: text("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    opponentBotId: text("opponent_bot_id")
      .notNull()
      .references(() => botsTable.id, { onDelete: "cascade" }),
    opponentSpec: jsonb("opponent_spec").$type<BotSpec>().notNull(),
    opponentChassis: text("opponent_chassis").$type<Chassis>().notNull(),

    won: boolean("won").notNull(),
    outcome: text("outcome").$type<MatchOutcome>().notNull(),
    ticks: integer("ticks").notNull(),
    /** how the opponent was built, search depth and budget. Inspectable, not folklore. */
    difficulty: jsonb("difficulty").$type<LadderDifficulty>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("ladder_rounds_run_round_uq").on(t.runId, t.round),
    index("ladder_rounds_run_idx").on(t.runId),
  ],
);

export const ladderRunsRelations = relations(ladderRunsTable, ({ one, many }) => ({
  bot: one(botsTable, { fields: [ladderRunsTable.botId], references: [botsTable.id] }),
  rounds: many(ladderRoundsTable),
}));

export const ladderRoundsRelations = relations(ladderRoundsTable, ({ one }) => ({
  run: one(ladderRunsTable, {
    fields: [ladderRoundsTable.runId],
    references: [ladderRunsTable.id],
  }),
  match: one(matchesTable, {
    fields: [ladderRoundsTable.matchId],
    references: [matchesTable.id],
  }),
}));

export type InsertLadderRun = typeof ladderRunsTable.$inferInsert;
export type LadderRunRow = typeof ladderRunsTable.$inferSelect;
export type InsertLadderRound = typeof ladderRoundsTable.$inferInsert;
export type LadderRoundRow = typeof ladderRoundsTable.$inferSelect;
