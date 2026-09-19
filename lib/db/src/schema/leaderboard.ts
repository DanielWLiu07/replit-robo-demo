import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { botsTable } from "./bots";

export const STARTING_ELO = 1200;

/**
 * Derived state, recomputed on match end in the same transaction that writes
 * the result, so the board can never claim a win that no match row backs.
 * One row per bot; the bot id is the primary key.
 */
export const leaderboardTable = pgTable(
  "leaderboard",
  {
    botId: text("bot_id")
      .primaryKey()
      .references(() => botsTable.id, { onDelete: "cascade" }),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    elo: integer("elo").notNull().default(STARTING_ELO),
    lastMatchAt: timestamp("last_match_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("leaderboard_elo_idx").on(t.elo)],
);

export const leaderboardRelations = relations(leaderboardTable, ({ one }) => ({
  bot: one(botsTable, {
    fields: [leaderboardTable.botId],
    references: [botsTable.id],
  }),
}));

export type InsertLeaderboardRow = typeof leaderboardTable.$inferInsert;
export type LeaderboardRowRecord = typeof leaderboardTable.$inferSelect;
