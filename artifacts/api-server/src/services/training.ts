import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FitnessPoint,
  SIM_VERSION,
  TrainConfig,
  TrainerMessage,
  TrainingRun,
  TRAIN_MATCH_BUDGET,
  type BotSpec,
  type BrainSpec,
  type TrainRequest,
} from "@workspace/contract";
import {
  botsTable,
  db,
  leaderboardTable,
  newSeed,
  trainingRunsTable,
  type TrainingRunRow,
} from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { badRequest, notFound } from "../lib/http";
import { logger } from "../lib/logger";
import type { Identity } from "../middlewares/identity";
import { createBot, listBots, loadBot, toBotSpec } from "./bots";

/**
 * One core's worth of training at a time.
 *
 * Each run pins a CPU for ~30 seconds. Autoscale containers are small, and two
 * concurrent runs do not finish in half the time: they finish in the same
 * total time while making every *other* request slower. Queueing is out of
 * scope tonight, so the honest answer is a 429 that says when to come back.
 */
export const MAX_CONCURRENT_RUNS = 1;
const running = new Map<string, ChildProcess>();

/** Belt and braces: a wedged trainer must not hold the slot forever. */
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

export function toTrainingRunDto(row: TrainingRunRow) {
  return TrainingRun.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    seed: row.seed,
    simVersion: row.simVersion,
    config: row.config,
    chassis: row.chassis,
    panelBotIds: row.panelBotIds,
    curve: row.curve,
    generationsDone: row.generationsDone,
    generationsTotal: row.generationsTotal,
    bestBrain: row.bestBrain ?? null,
    botId: row.botId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

function ownsRun(identity: Identity, row: TrainingRunRow): boolean {
  if (row.ownerUserId !== null && identity.userId !== null) {
    return row.ownerUserId === identity.userId;
  }
  if (row.ownerGuestId !== null) return row.ownerGuestId === identity.guestId;
  return false;
}

export async function getTrainingRun(runId: string): Promise<TrainingRunRow> {
  const [row] = await db
    .select()
    .from(trainingRunsTable)
    .where(eq(trainingRunsTable.id, runId));
  if (!row) throw notFound(`No training run ${runId}`);
  return row;
}

export async function listTrainingRuns(identity: Identity, limit = 20) {
  const rows = await db
    .select()
    .from(trainingRunsTable)
    .where(
      identity.userId !== null
        ? or(
            eq(trainingRunsTable.ownerUserId, identity.userId),
            eq(trainingRunsTable.ownerGuestId, identity.guestId),
          )
        : eq(trainingRunsTable.ownerGuestId, identity.guestId),
    )
    .orderBy(desc(trainingRunsTable.createdAt))
    .limit(limit);
  return rows.map(toTrainingRunDto);
}

/** Default panel: the house roster, which is what a new bot has to beat anyway. */
async function resolvePanel(
  identity: Identity,
  opponentBotIds: string[] | undefined,
): Promise<BotSpec[]> {
  if (opponentBotIds?.length) {
    const loaded = await Promise.all(opponentBotIds.map((id) => loadBot(id)));
    return loaded.map(({ bot, brain }) => toBotSpec(bot, brain));
  }
  const roster = (await listBots(identity)).filter(({ bot }) => bot.isSeed);
  if (roster.length === 0) {
    throw badRequest("No opponents to train against. Seed the roster first");
  }
  return roster.slice(0, 4).map(({ bot, brain }) => toBotSpec(bot, brain));
}

/**
 * Starts a run and returns immediately. The row is the job: poll
 * `GET /api/train/:id` and watch `curve` fill in.
 */
export async function startTraining(
  identity: Identity,
  input: TrainRequest,
): Promise<TrainingRun> {
  if (running.size >= MAX_CONCURRENT_RUNS) {
    throw new TrainingBusyError();
  }

  const config = TrainConfig.parse(input.config ?? {});
  const panel = await resolvePanel(identity, input.opponentBotIds);

  const matches =
    config.generations * config.populationSize * panel.length * config.seedsPerOpponent;
  if (matches > TRAIN_MATCH_BUDGET) {
    throw badRequest(
      `That config is ${matches.toLocaleString()} simulated matches; the ceiling is ` +
        `${TRAIN_MATCH_BUDGET.toLocaleString()}. Lower generations, population or seeds.`,
    );
  }

  const [row] = await db
    .insert(trainingRunsTable)
    .values({
      ownerUserId: identity.userId,
      ownerGuestId: identity.userId === null ? identity.guestId : null,
      name: input.name,
      status: "PENDING",
      seed: newSeed(),
      simVersion: SIM_VERSION,
      config,
      chassis: config.chassis,
      panelBotIds: panel.map((p) => p.id),
      generationsTotal: config.generations,
    })
    .returning();
  if (!row) throw new Error("training run insert returned nothing");

  spawnTrainer(row, panel);
  return toTrainingRunDto(row);
}

export class TrainingBusyError extends Error {
  readonly status = 429;
  constructor() {
    super(
      "A training run is already using the CPU. Evolution is not parallel work. " +
        "Wait for the current run to finish (about 30 seconds).",
    );
    this.name = "TrainingBusyError";
  }
}

/**
 * Resolve the trainer's path in both worlds: under tsx this module *is*
 * `src/services/training.ts`, and in production it has been bundled into
 * `dist/index.mjs`, so `import.meta.url` points somewhere else entirely.
 */
function trainerPath(): string {
  const here = import.meta.url;
  return fileURLToPath(
    here.endsWith(".mjs")
      ? new URL("./train/worker.mjs", here) // dist/index.mjs -> dist/train/worker.mjs
      : new URL("../train/worker.ts", here), // src/services/ -> src/train/
  );
}

function spawnTrainer(row: TrainingRunRow, panel: BotSpec[]): void {
  const payload = JSON.stringify({ seed: row.seed, config: row.config, panel });

  // Inheriting execArgv is what makes one code path work in dev and prod: under
  // tsx it carries the TypeScript loader flags the child needs, and in the
  // container it is just --enable-source-maps.
  const child = fork(trainerPath(), [payload], {
    execArgv: process.execArgv,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  running.set(row.id, child);

  let best: BrainSpec | null = null;
  let settled = false;

  const timeout = setTimeout(() => {
    logger.error({ runId: row.id }, "trainer timed out, killing");
    child.kill("SIGKILL");
  }, RUN_TIMEOUT_MS).unref();

  void db
    .update(trainingRunsTable)
    .set({ status: "RUNNING", startedAt: new Date() })
    .where(eq(trainingRunsTable.id, row.id))
    .catch((err) => logger.error({ err, runId: row.id }, "failed to mark run RUNNING"));

  child.on("message", (raw) => {
    const parsed = TrainerMessage.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ runId: row.id }, "trainer sent a message that failed validation");
      return;
    }
    const msg = parsed.data;
    if (msg.type === "generation") {
      // Append in SQL so a slow write can't drop a generation that landed while
      // it was in flight.
      void db
        .update(trainingRunsTable)
        .set({
          curve: sql`${trainingRunsTable.curve} || ${JSON.stringify([
            FitnessPoint.parse(msg.point),
          ])}::jsonb`,
          generationsDone: msg.point.generation + 1,
        })
        .where(eq(trainingRunsTable.id, row.id))
        .catch((err) => logger.error({ err, runId: row.id }, "failed to append curve point"));
    } else if (msg.type === "done") {
      best = msg.best;
    } else {
      settled = true;
      void finishRun(row, { error: msg.message });
    }
  });

  child.on("error", (err) => {
    settled = true;
    void finishRun(row, { error: `trainer process error: ${err.message}` });
  });

  child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    running.delete(row.id);
    if (settled) return;
    if (best) {
      void finishRun(row, { best });
    } else {
      void finishRun(row, {
        error: `trainer exited without a result (code ${code}, signal ${signal})`,
      });
    }
  });
}

/**
 * Terminal transition. On success the evolved brain becomes a real bot, same
 * table, same brain-revision rules, same leaderboard row as a hand-built one,
 * so it can be fought and inspected like anything else.
 */
async function finishRun(
  row: TrainingRunRow,
  outcome: { best?: BrainSpec; error?: string },
): Promise<void> {
  const finishedAt = new Date();
  try {
    if (outcome.error || !outcome.best) {
      await db
        .update(trainingRunsTable)
        .set({ status: "FAILED", error: outcome.error ?? "no brain produced", finishedAt })
        .where(eq(trainingRunsTable.id, row.id));
      logger.error({ runId: row.id, error: outcome.error }, "training run failed");
      return;
    }

    const identity: Identity = {
      userId: row.ownerUserId,
      clerkUserId: null,
      guestId: row.ownerGuestId ?? "trainer",
    };
    const { bot } = await createBot(identity, {
      name: row.name,
      chassis: row.chassis,
      brain: outcome.best,
    });

    await db
      .update(trainingRunsTable)
      .set({
        status: "COMPLETE",
        bestBrain: outcome.best,
        botId: bot.id,
        generationsDone: row.generationsTotal,
        finishedAt,
      })
      .where(eq(trainingRunsTable.id, row.id));

    logger.info({ runId: row.id, botId: bot.id }, "training run complete");
  } catch (err) {
    logger.error({ err, runId: row.id }, "failed to finalise training run");
    await db
      .update(trainingRunsTable)
      .set({
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
        finishedAt,
      })
      .where(eq(trainingRunsTable.id, row.id))
      .catch(() => {});
  }
}

/** Kill in-flight trainers on shutdown so a redeploy doesn't leave orphans. */
export function stopAllTraining(): void {
  for (const [id, child] of running) {
    logger.info({ runId: id }, "killing trainer on shutdown");
    child.kill("SIGTERM");
  }
  running.clear();
}

export { ownsRun };
