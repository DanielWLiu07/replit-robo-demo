import type { Chassis } from "@workspace/contract";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { newId } from "./ids";
import { usersTable } from "./users";

/**
 * A bot is the durable identity — name, chassis, owner. Its brain lives in
 * `brains` as an append-only revision list, because matches point at a brain
 * *version* and editing a bot must not rewrite the past.
 *
 * Ownership is deliberately two-headed. Clerk keys are placeholders on the
 * demo path, so a visitor who never signs in still gets to build and fight a
 * bot: they are identified by a signed guest cookie (`owner_guest_id`).
 * Signing in later is a matter of stamping `owner_user_id` onto those rows.
 * Exactly one of the two is set, unless the row is part of the seed roster.
 */
export const botsTable = pgTable(
  "bots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("bot")),
    ownerUserId: integer("owner_user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    ownerGuestId: text("owner_guest_id"),
    name: text("name").notNull(),
    chassis: text("chassis").$type<Chassis>().notNull(),
    /** built-in roster: always fightable, never editable. */
    isSeed: boolean("is_seed").notNull().default(false),
    /**
     * Spawned by the ladder rather than by a person. Real rows — so a ladder
     * fight is an ordinary match with ordinary foreign keys and replays on the
     * ordinary socket — but hidden from the bot list and the Elo board, which
     * are about bots somebody actually built.
     */
    isGenerated: boolean("is_generated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("bots_owner_user_idx").on(t.ownerUserId),
    index("bots_owner_guest_idx").on(t.ownerGuestId),
    index("bots_is_seed_idx").on(t.isSeed),
    index("bots_is_generated_idx").on(t.isGenerated),
  ],
);

export const botsRelations = relations(botsTable, ({ one }) => ({
  owner: one(usersTable, {
    fields: [botsTable.ownerUserId],
    references: [usersTable.id],
  }),
}));

export type InsertBot = typeof botsTable.$inferInsert;
export type BotRow = typeof botsTable.$inferSelect;
