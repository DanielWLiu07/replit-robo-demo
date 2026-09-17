import type { BrainSpec } from "@workspace/contract";
import { relations } from "drizzle-orm";
import {
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

/**
 * Append-only. An edit to a bot's brain inserts version N+1; nothing ever
 * UPDATEs `spec`. `matches` stores the brain id it was fought with, so a match
 * from an hour ago still replays against the brain that actually fought it.
 *
 * `spec` is validated against BrainSpec (contract) at the API edge before it
 * gets here — the schema gate. Invalid loadouts cannot reach the simulation.
 */
export const brainsTable = pgTable(
  "brains",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("brn")),
    botId: text("bot_id")
      .notNull()
      .references(() => botsTable.id, { onDelete: "cascade" }),
    /** 1-based, monotonic per bot. */
    version: integer("version").notNull(),
    spec: jsonb("spec").$type<BrainSpec>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("brains_bot_version_uq").on(t.botId, t.version),
    index("brains_bot_idx").on(t.botId),
  ],
);

export const brainsRelations = relations(brainsTable, ({ one }) => ({
  bot: one(botsTable, {
    fields: [brainsTable.botId],
    references: [botsTable.id],
  }),
}));

export type InsertBrain = typeof brainsTable.$inferInsert;
export type BrainRow = typeof brainsTable.$inferSelect;
