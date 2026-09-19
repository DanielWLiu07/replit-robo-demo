/**
 * Seeds the house roster. Idempotent, re-running it is a no-op.
 *
 *   cd artifacts/api-server && set -a; . ../../.env; set +a \
 *     && pnpm dlx tsx src/cli/seed.ts
 *
 * Every loadout below is a real Drosophila circuit doing the job it does in the
 * fly. Provenance is in docs/PLAN.md; the honest claim is "faithful model of
 * the LPLC2 -> Giant Fiber pathway, connectivity from FlyWire", not "running
 * the connectome".
 *
 * Every roster bot carries DNA02 and a target cell. That is not a balance
 * fudge: DNA02 *is* the steering descending neuron, so a bot without it cannot
 * turn toward anything, drifts until the arena closes, and produces a 90-second
 * staring contest instead of a fight. The roster's identities live in the third
 * and fourth modules and in the thresholds. Measured over all 6 pairings x 3
 * seeds: 17 KO, 1 TIMEOUT_HULL, 0 draws, average 13s.
 */
import type { CreateBotRequest } from "@workspace/contract";
import { botsTable, brainsTable, db, pool } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { createBot } from "../services/bots";
import type { Identity } from "../middlewares/identity";

const HOUSE: Identity = { userId: null, clerkUserId: null, guestId: "house" };

const ROSTER: CreateBotRequest[] = [
  {
    // Escape reflex as a whole personality: one looming spike and it is gone.
    name: "GIANT FIBER",
    chassis: "TANK",
    brain: {
      slots: [
        { module: "LPLC2_DNP01", weight: 2.5, threshold: 0.6 },
        { module: "DNA02", weight: 2.0, threshold: 1.0 },
        { module: "LC10A", weight: 2.0, threshold: 1.1 },
        { module: "P1", weight: 1.5, threshold: 2.0 },
      ],
      membraneLeak: 0.35,
      refractoryTicks: 6,
    },
  },
  {
    // LC10a is the courtship tracker. Pointed at a rival it just... follows.
    name: "COURTSHIP",
    chassis: "DRONE",
    brain: {
      slots: [
        { module: "LC10A", weight: 3.0, threshold: 0.9 },
        { module: "DNA02", weight: 2.5, threshold: 1.0 },
        { module: "LC11", weight: 1.5, threshold: 1.2 },
        { module: "P1", weight: 1.0, threshold: 2.5 },
      ],
      membraneLeak: 0.15,
      refractoryTicks: 3,
    },
  },
  {
    // Moonwalker descending neuron: backs away, then comes at you again.
    name: "MOONWALKER",
    chassis: "HORNET",
    brain: {
      slots: [
        { module: "DNA02", weight: 2.5, threshold: 0.95 },
        { module: "MDN", weight: 2.0, threshold: 0.9 },
        { module: "LC10A", weight: 2.0, threshold: 1.2 },
        { module: "LPLC2_DNP01", weight: 1.5, threshold: 0.5 },
      ],
      membraneLeak: 0.22,
      refractoryTicks: 4,
    },
  },
  {
    // P1 is the aggression state. Turn it up and everything downstream shouts.
    name: "AROUSAL",
    chassis: "HORNET",
    brain: {
      slots: [
        { module: "P1", weight: 2.5, threshold: 1.0 },
        { module: "DNA02", weight: 2.5, threshold: 1.0 },
        { module: "LC10A", weight: 2.0, threshold: 1.0 },
        { module: "LC11", weight: 1.0, threshold: 1.3 },
      ],
      membraneLeak: 0.1,
      refractoryTicks: 2,
    },
  },
];

/**
 * The boss: not hand-designed, evolved. 1.1's neuroevolution run found it over
 * 14 generations against the four archetypes above (fitness 26.34 -> 27.66), and
 * it beat all four on seeds it never trained on (39W 1L 0D). It goes through the same
 * BrainSpec gate as everything else, an evolved loadout gets no exemption from
 * the rules a human loadout has to satisfy, which is the point of having one
 * schema rather than two code paths.
 *
 * Re-evolved for the boxing pass. The previous champion was a steering-only brain
 * with `refractoryTicks: 0`, which was the right answer when the bots fought in a
 * clinch and nothing mattered but staying pointed at the opponent; against bots that
 * hold punching range it lost 40 matches out of 40. This one equips all five modules
 * and goes deaf for 6 ticks between spikes. A champion is an artifact of the physics
 * it was trained against, which is exactly why it is transcribed here rather than
 * imported, see below.
 */
const BOSS: CreateBotRequest = {
  name: "CHAMPION",
  chassis: "HORNET",
  // Transcribed from lib/sim/src/champion.json (seed "flyweight-v1", 14
  // generations) rather than imported. The roster is seed data: it must not
  // change under a running demo because someone re-ran evolution next door.
  brain: {
    slots: [
      { module: "LPLC2_DNP01", weight: 1.1527650848291815, threshold: 1.1555094724171795 },
      { module: "LC10A", weight: 0.5348723970791325, threshold: 0.3274095524800941 },
      { module: "LC11", weight: 1.274469781219028, threshold: 0.5483445407822728 },
      { module: "DNA02", weight: 1.746, threshold: 0.7302505290368572 },
      { module: "P1", weight: 1.3642872920250517, threshold: 1.436391279124655 },
    ],
    membraneLeak: 0.17792343439161776,
    refractoryTicks: 6,
  },
};

async function main(): Promise<void> {
  for (const spec of [...ROSTER, BOSS]) {
    const [existing] = await db
      .select({ id: botsTable.id })
      .from(botsTable)
      .where(eq(botsTable.name, spec.name))
      .limit(1);
    if (existing) {
      // Retuning the roster must not rewrite history: compare the head brain,
      // and if it has drifted, append a revision the way an edit would.
      const [head] = await db
        .select()
        .from(brainsTable)
        .where(eq(brainsTable.botId, existing.id))
        .orderBy(desc(brainsTable.version))
        .limit(1);
      if (head && JSON.stringify(head.spec) === JSON.stringify(spec.brain)) {
        console.log(`· ${spec.name} up to date (${existing.id} v${head.version})`);
        continue;
      }
      const [appended] = await db
        .insert(brainsTable)
        .values({
          botId: existing.id,
          version: sql`(select coalesce(max(${brainsTable.version}), 0) + 1 from ${brainsTable} where ${brainsTable.botId} = ${existing.id})`,
          spec: spec.brain,
        })
        .returning();
      console.log(`~ ${spec.name} retuned -> v${appended?.version} (${existing.id})`);
      continue;
    }
    const { bot } = await createBot(HOUSE, spec, { isSeed: true });
    console.log(`+ ${spec.name} (${bot.chassis}) -> ${bot.id}`);
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
