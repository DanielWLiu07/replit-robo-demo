import type {
  BrainSpec,
  Chassis,
  FitnessPoint,
  TrainConfig,
  TrainStatus,
} from "@workspace/contract";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { botsTable } from "./bots";
import { newId } from "./ids";
import { usersTable } from "./users";

/**
 * A neuroevolution run. Spikes are not differentiable, so there is no gradient
 * to descend and training means evolution, which is CPU-bound, synchronous and
 * takes half a minute. It therefore runs in a forked process, and this table is
 * how the HTTP side watches it: the row is the job, the client polls it.
 *
 * `curve` is the chartable fitness history, appended a generation at a time, so
 * a chart can fill in live rather than appearing all at once at the end. The
 * per-generation champion brain is deliberately *not* kept, only `bestBrain`
 * at the end, because storing 24 BrainSpecs per run to draw one line is waste.
 */
export const trainingRunsTable = pgTable(
  "training_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("trn")),
    ownerUserId: integer("owner_user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    ownerGuestId: text("owner_guest_id"),

    /** name the evolved bot will be given if the run succeeds. */
    name: text("name").notNull(),
    status: text("status").$type<TrainStatus>().notNull().default("PENDING"),
    /** evolution is seeded too, a run is as reproducible as a match. */
    seed: text("seed").notNull(),
    simVersion: text("sim_version").notNull().default("unknown"),
    config: jsonb("config").$type<TrainConfig>().notNull(),
    chassis: text("chassis").$type<Chassis>().notNull(),
    /** the opponents fitness was measured against. */
    panelBotIds: jsonb("panel_bot_ids").$type<string[]>().notNull(),

    curve: jsonb("curve").$type<FitnessPoint[]>().notNull().default([]),
    generationsDone: integer("generations_done").notNull().default(0),
    generationsTotal: integer("generations_total").notNull(),

    bestBrain: jsonb("best_brain").$type<BrainSpec | null>(),
    /** the bot created from `bestBrain` once the run completes. */
    botId: text("bot_id").references(() => botsTable.id, { onDelete: "set null" }),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("training_runs_owner_user_idx").on(t.ownerUserId),
    index("training_runs_owner_guest_idx").on(t.ownerGuestId),
    index("training_runs_status_idx").on(t.status),
    index("training_runs_created_idx").on(t.createdAt),
  ],
);

export const trainingRunsRelations = relations(trainingRunsTable, ({ one }) => ({
  bot: one(botsTable, {
    fields: [trainingRunsTable.botId],
    references: [botsTable.id],
  }),
}));

export type InsertTrainingRun = typeof trainingRunsTable.$inferInsert;
export type TrainingRunRow = typeof trainingRunsTable.$inferSelect;
