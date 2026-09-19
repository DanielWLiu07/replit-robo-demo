import { profileBot } from "@workspace/sim";
import {
  Bot as BotDto,
  type BotSpec,
  type BrainSpec,
  type CreateBotRequest,
  type UpdateBotRequest,
} from "@workspace/contract";
import {
  botsTable,
  brainsTable,
  db,
  leaderboardTable,
  type BotRow,
  type BrainRow,
} from "@workspace/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Identity } from "../middlewares/identity";
import { forbidden, notFound } from "../lib/http";

export interface LoadedBot {
  bot: BotRow;
  brain: BrainRow;
}

export function owns(identity: Identity, bot: BotRow): boolean {
  if (bot.isSeed) return false; // roster bots belong to the house
  if (bot.ownerUserId !== null && identity.userId !== null) {
    return bot.ownerUserId === identity.userId;
  }
  if (bot.ownerGuestId !== null) return bot.ownerGuestId === identity.guestId;
  return false;
}

export function assertOwns(identity: Identity, bot: BotRow): void {
  if (!owns(identity, bot)) {
    throw forbidden(
      bot.isSeed
        ? "Roster bots can't be edited. Clone one instead"
        : "That bot belongs to someone else",
    );
  }
}

/** The BotSpec the sim is handed. Bot identity + the brain revision it fought with. */
export function toBotSpec(bot: BotRow, brain: BrainRow): BotSpec {
  return { id: bot.id, name: bot.name, chassis: bot.chassis, brain: brain.spec };
}

export function toBotDto(bot: BotRow, brain: BrainRow, identity: Identity) {
  const spec = toBotSpec(bot, brain);
  return BotDto.parse({
    id: bot.id,
    name: bot.name,
    chassis: bot.chassis,
    brain: brain.spec,
    brainVersion: brain.version,
    brainId: brain.id,
    isSeed: bot.isSeed,
    mine: owns(identity, bot),
    createdAt: bot.createdAt.toISOString(),
    // Derived here rather than in the client: the sim owns what a loadout means,
    // and two implementations of that would disagree the moment one changes.
    profile: profileBot(spec),
  });
}

/**
 * Head revision = highest version per bot. Two queries and a reduce rather
 * than a lateral join: the roster is small and this stays readable.
 */
async function headBrains(botIds: string[]): Promise<Map<string, BrainRow>> {
  if (botIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(brainsTable)
    .where(inArray(brainsTable.botId, botIds))
    .orderBy(brainsTable.botId, brainsTable.version);
  const head = new Map<string, BrainRow>();
  for (const row of rows) head.set(row.botId, row); // ascending, so last wins
  return head;
}

export async function loadBot(botId: string): Promise<LoadedBot> {
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
  if (!bot) throw notFound(`No bot ${botId}`);
  const [brain] = await db
    .select()
    .from(brainsTable)
    .where(eq(brainsTable.botId, botId))
    .orderBy(desc(brainsTable.version))
    .limit(1);
  if (!brain) throw notFound(`Bot ${botId} has no brain revision`);
  return { bot, brain };
}

export async function listBots(
  identity: Identity,
  opts: { mineOnly?: boolean } = {},
): Promise<LoadedBot[]> {
  const rows = await db
    .select()
    .from(botsTable)
    // Ladder opponents are real rows so their matches have real foreign keys,
    // but this list is about bots somebody actually built.
    .where(eq(botsTable.isGenerated, false))
    .orderBy(desc(botsTable.isSeed), desc(botsTable.createdAt));
  const visible = opts.mineOnly ? rows.filter((b) => owns(identity, b)) : rows;
  const head = await headBrains(visible.map((b) => b.id));
  return visible.flatMap((bot) => {
    const brain = head.get(bot.id);
    return brain ? [{ bot, brain }] : [];
  });
}

export async function listBrainRevisions(botId: string): Promise<BrainRow[]> {
  return db
    .select()
    .from(brainsTable)
    .where(eq(brainsTable.botId, botId))
    .orderBy(desc(brainsTable.version));
}

export async function loadBrainRevision(
  botId: string,
  version: number,
): Promise<BrainRow> {
  const [brain] = await db
    .select()
    .from(brainsTable)
    .where(and(eq(brainsTable.botId, botId), eq(brainsTable.version, version)));
  if (!brain) throw notFound(`Bot ${botId} has no brain v${version}`);
  return brain;
}

export async function createBot(
  identity: Identity,
  input: CreateBotRequest,
  opts: { isSeed?: boolean } = {},
): Promise<LoadedBot> {
  return db.transaction(async (tx) => {
    const [bot] = await tx
      .insert(botsTable)
      .values({
        name: input.name,
        chassis: input.chassis,
        isSeed: opts.isSeed ?? false,
        ownerUserId: opts.isSeed ? null : identity.userId,
        ownerGuestId: opts.isSeed || identity.userId !== null ? null : identity.guestId,
      })
      .returning();
    if (!bot) throw new Error("bot insert returned nothing");

    const [brain] = await tx
      .insert(brainsTable)
      .values({ botId: bot.id, version: 1, spec: input.brain })
      .returning();
    if (!brain) throw new Error("brain insert returned nothing");

    await tx.insert(leaderboardTable).values({ botId: bot.id }).onConflictDoNothing();
    return { bot, brain };
  });
}

export async function updateBot(
  identity: Identity,
  botId: string,
  input: UpdateBotRequest,
): Promise<LoadedBot> {
  const current = await loadBot(botId);
  assertOwns(identity, current.bot);

  return db.transaction(async (tx) => {
    let bot = current.bot;
    if (input.name !== undefined || input.chassis !== undefined) {
      const [updated] = await tx
        .update(botsTable)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.chassis !== undefined ? { chassis: input.chassis } : {}),
          updatedAt: new Date(),
        })
        .where(eq(botsTable.id, botId))
        .returning();
      if (updated) bot = updated;
    }

    let brain = current.brain;
    if (input.brain !== undefined) {
      // Append, never mutate. Past matches point at the old row and keep replaying.
      const [inserted] = await tx
        .insert(brainsTable)
        .values({
          botId,
          version: sql`(select coalesce(max(${brainsTable.version}), 0) + 1 from ${brainsTable} where ${brainsTable.botId} = ${botId})`,
          spec: input.brain as BrainSpec,
        })
        .returning();
      if (inserted) brain = inserted;
    }

    return { bot, brain };
  });
}

export async function deleteBot(identity: Identity, botId: string): Promise<void> {
  const { bot } = await loadBot(botId);
  assertOwns(identity, bot);
  await db.delete(botsTable).where(eq(botsTable.id, botId));
}

/** Matchmaking: anyone but yourself, picked by the seed so it stays reproducible-ish. */
export async function pickOpponent(excludeBotId: string): Promise<LoadedBot> {
  const [bot] = await db
    .select()
    .from(botsTable)
    .where(and(ne(botsTable.id, excludeBotId), eq(botsTable.isGenerated, false)))
    .orderBy(sql`random()`)
    .limit(1);
  if (!bot) throw notFound("No opponent available: the roster is empty");
  return loadBot(bot.id);
}
