import { z } from "zod";

/**
 * FLYWEIGHT shared contract.
 * Single source of truth for sim core (1.1), API+DB (1.2) and client (1.3).
 * Nothing crosses a process boundary without passing through a schema here.
 */

// ── Brain ────────────────────────────────────────────────────────────────────
// Each module is a real Drosophila circuit. See docs/PLAN.md for provenance.
export const NeuronModule = z.enum([
  "LPLC2_DNP01", // looming -> Giant Fiber escape. one spike, no deliberation.
  "LC10A",       // small-target visual pursuit (courtship tracking) -> chase
  "LC11",        // small-object detection -> target acquisition
  "DNA02",       // steering descending neuron -> turn rate
  "MDN",         // moonwalker descending neuron -> reverse
  "P1",          // arousal / aggression -> global gain
]);
export type NeuronModule = z.infer<typeof NeuronModule>;

export const ModuleSlot = z.object({
  module: NeuronModule,
  /** synaptic gain, clamped. higher = stronger drive downstream. */
  weight: z.number().min(0).max(4),
  /** mV above rest the cell must reach to spike. lower = twitchier. */
  threshold: z.number().min(0.1).max(5),
});
export type ModuleSlot = z.infer<typeof ModuleSlot>;

export const BRAIN_MAX_SLOTS = 5;
/** Total weight a brain may spend. Forces real loadout tradeoffs. */
export const BRAIN_WEIGHT_BUDGET = 8;

export const BrainSpec = z
  .object({
    slots: z.array(ModuleSlot).min(1).max(BRAIN_MAX_SLOTS),
    /** leak per tick, 0..1. higher = forgets input faster. */
    membraneLeak: z.number().min(0.01).max(0.99).default(0.2),
    /** ticks a cell is deaf after firing. */
    refractoryTicks: z.number().int().min(0).max(30).default(4),
  })
  .refine(
    (b) => b.slots.reduce((s, x) => s + x.weight, 0) <= BRAIN_WEIGHT_BUDGET,
    { message: `total slot weight must not exceed ${BRAIN_WEIGHT_BUDGET}` },
  )
  .refine(
    (b) => new Set(b.slots.map((s) => s.module)).size === b.slots.length,
    { message: "each neuron module may only be equipped once" },
  );
export type BrainSpec = z.infer<typeof BrainSpec>;

// ── Bot ──────────────────────────────────────────────────────────────────────
export const Chassis = z.enum(["DRONE", "HORNET", "TANK"]);
export type Chassis = z.infer<typeof Chassis>;

/** Chassis trade speed against hull. Sim core owns the authoritative numbers. */
export const CHASSIS_STATS: Record<Chassis, { hull: number; accel: number; turn: number }> = {
  DRONE:  { hull: 82,  accel: 1.4,  turn: 1.6 },
  HORNET: { hull: 100, accel: 1.0,  turn: 1.0 },
  TANK:   { hull: 150, accel: 0.7,  turn: 0.65 },
};


/**
 * The physical build — four measurements of an actual body.
 *
 * These are not stat bars with invented consequences. Every number downstream is
 * derived from these by mechanics that hold in the real world (see `bodyMechanics`
 * in the sim), which is what makes tuning them interesting: you cannot raise one
 * without paying for it somewhere the physics decides, not somewhere we chose.
 *
 * The sharpest of those trades: a longer arm reaches further but, for the same
 * shoulder torque, moves SLOWER at the fist — rotational inertia goes with L², so
 * tip speed goes with 1/L. Reach and power are genuinely opposed.
 */
export const BodySpec = z.object({
  /** total mass, kg */
  mass: z.number().min(48).max(124),
  /** shoulder to fist, metres */
  reach: z.number().min(0.40).max(0.76),
  /** peak shoulder torque driving a swing, N·m */
  torque: z.number().min(55).max(200),
  /** distance between the feet, metres — the base you balance over */
  stance: z.number().min(0.24).max(0.64),
});
export type BodySpec = z.infer<typeof BodySpec>;

/**
 * The build each chassis arrives with. A bot that never visits the bench uses
 * exactly these, and the arena applies body physics as a RATIO against them — so
 * an untuned bot computes 1.0 everywhere and fights identically to before the
 * bench existed. That is what keeps the existing balance runs meaningful.
 */
export const BODY_BY_CHASSIS: Record<Chassis, BodySpec> = {
  DRONE:  { mass: 62,  reach: 0.50, torque: 96,  stance: 0.32 },
  HORNET: { mass: 80,  reach: 0.55, torque: 120, stance: 0.40 },
  TANK:   { mass: 106, reach: 0.62, torque: 165, stance: 0.52 },
};

export const BotSpec = z.object({
  id: z.string(),
  name: z.string().min(1).max(24),
  chassis: Chassis,
  brain: BrainSpec,
  /** Absent means "stock for this chassis" — see BODY_BY_CHASSIS. */
  body: BodySpec.optional(),
});
export type BotSpec = z.infer<typeof BotSpec>;

// ── Simulation ───────────────────────────────────────────────────────────────
export const TICK_HZ = 60;
export const MATCH_MAX_TICKS = TICK_HZ * 90; // 90s hard cap
/** After this the walls close in, so nobody can simply outrun the fight. */
export const SUDDEN_DEATH_TICK = TICK_HZ * 25;

export const ArenaBotState = z.object({
  botId: z.string(),
  x: z.number(), y: z.number(), heading: z.number(),
  vx: z.number(), vy: z.number(),
  hull: z.number(),
  /** modules that fired this tick — this is what the spike raster renders. */
  spiked: z.array(NeuronModule),
  /** membrane potential per module, for the trace plot. */
  potentials: z.record(NeuronModule, z.number()),
  /** P1 arousal gain, 1.0 at rest, rises with damage taken. Multiplies every circuit. */
  arousal: z.number(),
  /** Giant Fiber habituation, 0..1 normalised. Climbs with each escape, recovers when
   *  the looming stops — this is why a dodging bot stops being able to dodge. */
  gfFatigue: z.number(),
  /** Arm swing angles in radians, relative to the torso. Driven by motor output,
   *  integrated with angular momentum — a swing that connects fast does damage. */
  armL: z.number(),
  armR: z.number(),
  /** Angular velocity of each arm; tip speed is what decides a strike. */
  armLv: z.number(),
  armRv: z.number(),
  /** Procedural gait phase for the two-legged stance, 0..1. */
  gait: z.number(),
  /** true on the tick a strike lands, for hit sparks and screen shake. */
  struck: z.boolean(),
  /** 0..1 guard. Arms up blunts an incoming strike, but you cannot punch while
   *  blocking and you cannot block during punch recovery. */
  guard: z.number(),
  /** ticks of recovery left after a swing — the window where you are open. */
  recovery: z.number(),
  /** true on the tick a strike was blocked, for a parry effect. */
  blocked: z.boolean(),
  /** forward/back torso lean in radians. Responds to acceleration and to being hit —
   *  a swing you commit to and miss nearly puts you on your face. */
  lean: z.number(),
  /** lateral tilt in radians, from knockback and from legs buckling. */
  tilt: z.number(),
  /** ticks left on the floor. 0 = standing. Cannot punch or block while down. */
  down: z.number(),
  /** true on the tick this bot was hit while still inside its own punch recovery —
   *  a counter, which lands for bonus damage. Worth its own flag so the UI can
   *  punctuate it differently from an ordinary hit. */
  countered: z.boolean(),
  /** 0..1 stamina. Every punch spends from it; a held guard and time spent out of
   *  punching range refill it. Empty does not stop a swing, it slows it — and a slow
   *  fist misses the strike threshold, so a gassed bot whiffs on its own punches. */
  stamina: z.number(),
});
export type ArenaBotState = z.infer<typeof ArenaBotState>;

/** Max units a player may deploy per side. */
export const MAX_SQUAD = 5;

export const MatchFrame = z.object({
  tick: z.number().int().min(0),
  /** half-width of the arena this tick. Shrinks after SUDDEN_DEATH_TICK. */
  arenaHalf: z.number(),
  /** All units, both teams, in deploy order. 1v1 is simply a squad of one each. */
  bots: z.array(ArenaBotState).min(2),
  /** How many units team A has; everything from this index on is team B. */
  teamSplit: z.number().int().min(1),
  /** collisions resolved this tick, for hit sparks + camera shake. */
  hits: z.array(z.object({ attacker: z.string(), damage: z.number() })),
});
export type MatchFrame = z.infer<typeof MatchFrame>;

export const MatchOutcome = z.enum(["KO", "TIMEOUT_HULL", "DRAW"]);
export const MatchResult = z.object({
  matchId: z.string(),
  seed: z.string(),
  /** id of the surviving team's spec; null on a draw */
  winnerBotId: z.string().nullable(),
  /** units still standing per side when it ended */
  survivors: z.tuple([z.number().int(), z.number().int()]).optional(),
  outcome: MatchOutcome,
  ticks: z.number().int(),
});
export type MatchResult = z.infer<typeof MatchResult>;

// ── Wire protocol: /ws/match/:id ─────────────────────────────────────────────
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("match_start"), matchId: z.string(), seed: z.string(),
             bots: z.array(BotSpec).min(2), teamSplit: z.number().int().min(1) }),
  z.object({ type: z.literal("frame"), frame: MatchFrame }),
  z.object({ type: z.literal("match_end"), result: MatchResult }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ── REST ─────────────────────────────────────────────────────────────────────
export const CreateBotRequest = z.object({
  name: z.string().min(1).max(24),
  chassis: Chassis,
  brain: BrainSpec,
});
export const StartMatchRequest = z.object({
  botId: z.string(),
  opponentBotId: z.string().optional(), // omit = matchmake
  /** units to deploy per side, 1..MAX_SQUAD. Defaults to 1 for a straight duel. */
  squadSize: z.number().int().min(1).max(MAX_SQUAD).optional(),
});
export const LeaderboardRow = z.object({
  botId: z.string(), name: z.string(), chassis: Chassis,
  wins: z.number().int(), losses: z.number().int(), elo: z.number().int(),
  /** added by 1.2 — optional on input so existing callers keep compiling. */
  draws: z.number().int().default(0),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRow>;

// ═════════════════════════════════════════════════════════════════════════════
// Added by 1.2 (backend platform). Everything above this line is unchanged.
// ═════════════════════════════════════════════════════════════════════════════

/** Missing type exports for schemas that already existed above. */
export type MatchOutcome = z.infer<typeof MatchOutcome>;
export type CreateBotRequest = z.infer<typeof CreateBotRequest>;
export type StartMatchRequest = z.infer<typeof StartMatchRequest>;

// ── Sim boundary ─────────────────────────────────────────────────────────────
/**
 * Version of the *simulation*, not of the API or the contract.
 *
 * Brain snapshots are versioned so that editing a bot cannot rewrite the
 * matches it already fought. The same argument applies one level up and was
 * missing: a match replays as `seed + snapshots` fed back through the sim, so
 * the sim is an input to the replay too. Change the physics and every stored
 * match silently replays into a *different fight* — same winner if you are
 * lucky, different tick count, different everything else.
 *
 * So matches record the sim version they were fought under, and a replay across
 * a version boundary is reported as such instead of being passed off as the
 * original fight.
 *
 * **1.1 owns this constant — bump it whenever physics, the neuron model, the
 * arena or the RNG changes.** It is a coarse marker on purpose: it does not
 * need to be a hash, it needs to be honest.
 */
export const SIM_VERSION = "3";
// "3": boxing pass — range discipline (forward drive is governed off inside the
//      pocket, plus a soft break before torsos touch), counter-punch damage on a
//      defender caught in recovery, stamina, and lateral footwork. Physics changed,
//      so a v2 match does NOT replay to the same fight: same shape, different ticks.
// "2": squads (MAX_SQUAD, teamSplit, survivors) plus arousal / gfFatigue per bot.
//      1v1 stayed API-compatible but NOT numerically identical — the brain
//      constructor's RNG draws shifted, so a v1 match replays to a different
//      tick count. Caught by verify-determinism, which is what it is for.

/**
 * The single function 1.2 calls into 1.1 — implemented in `@workspace/sim`.
 *
 * Pull-based on purpose: the caller drives it with `.next()`, so transport
 * decides the pace. A headless run for persistence drains it as fast as the CPU
 * allows (a 90-second match is well under a second), while a socket pulls one
 * frame per wall-clock tick. Same generator, same frames, two very different
 * clocks, and no second implementation to disagree with the first.
 *
 * Server-authoritative: given the same seed and the same two BotSpecs it
 * produces identical frames and an identical result, forever. That is the
 * property that makes replay free — we persist `seed + two BotSpec snapshots`
 * and never store a frame.
 *
 * The returned MatchResult carries `matchId: ""`; the sim does not know its own
 * id, so persistence fills it in.
 *
 * `squadSize` deploys that many copies of each spec per side (1..MAX_SQUAD).
 * It is part of the replay input, so it is persisted on the match row next to
 * the seed — a 5v5 replayed as a 1v1 is not the same fight.
 */
export type MatchRunner = (
  seed: string,
  botA: BotSpec,
  botB: BotSpec,
  squadSize?: number,
) => Generator<MatchFrame, MatchResult, void>;

// ── Persistence-facing shapes ────────────────────────────────────────────────
export const MatchStatus = z.enum(["PENDING", "RUNNING", "COMPLETE", "FAILED"]);
export type MatchStatus = z.infer<typeof MatchStatus>;

/** Append-only. KO and hits, not frames — frames are re-derived from the seed. */
export const MatchEventKind = z.enum(["HIT", "KO", "TIMEOUT", "DRAW"]);
export type MatchEventKind = z.infer<typeof MatchEventKind>;

export const MatchEvent = z.object({
  tick: z.number().int().min(0),
  kind: MatchEventKind,
  payload: z.record(z.string(), z.unknown()),
});
export type MatchEvent = z.infer<typeof MatchEvent>;

/**
 * An immutable brain revision. Editing a bot appends a new version; matches
 * point at the version they were fought with, so old matches keep replaying
 * correctly after you retune your bot.
 */
export const BrainRevision = z.object({
  id: z.string(),
  botId: z.string(),
  version: z.number().int().min(1),
  spec: BrainSpec,
  createdAt: z.string(),
});
export type BrainRevision = z.infer<typeof BrainRevision>;

// ── REST ─────────────────────────────────────────────────────────────────────
export const Bot = z.object({
  id: z.string(),
  name: z.string(),
  chassis: Chassis,
  brain: BrainSpec,
  /** version of `brain` — the head revision. */
  brainVersion: z.number().int().min(1),
  brainId: z.string(),
  /** true for the built-in roster you can fight without signing in. */
  isSeed: z.boolean(),
  /** whether the caller may edit or delete this bot. */
  mine: z.boolean(),
  createdAt: z.string(),
  /**
   * Derived character card — stat bars, playstyle, neuron count. Optional only
   * so older callers keep parsing; the server always sends it.
   */
  profile: z.lazy(() => BotProfile).optional(),
});
export type Bot = z.infer<typeof Bot>;

export const UpdateBotRequest = z
  .object({
    name: z.string().min(1).max(24).optional(),
    chassis: Chassis.optional(),
    /** present = append a new brain revision. absent = leave the brain alone. */
    brain: BrainSpec.optional(),
  })
  .refine((b) => b.name !== undefined || b.chassis !== undefined || b.brain !== undefined, {
    message: "update must change at least one field",
  });
export type UpdateBotRequest = z.infer<typeof UpdateBotRequest>;

export const ListBotsResponse = z.object({ bots: z.array(Bot) });
export type ListBotsResponse = z.infer<typeof ListBotsResponse>;

/**
 * Everything needed to replay a match without touching any other row:
 * the seed plus both BotSpec snapshots as they were at fight time.
 */
export const Match = z.object({
  id: z.string(),
  seed: z.string(),
  status: MatchStatus,
  bots: z.tuple([BotSpec, BotSpec]),
  /** lineage: which brain revision each side fought with. */
  brainIds: z.tuple([z.string(), z.string()]),
  winnerBotId: z.string().nullable(),
  outcome: MatchOutcome.nullable(),
  ticks: z.number().int(),
  /** units per side. Part of the replay input, not a display detail. */
  squadSize: z.number().int().min(1).max(MAX_SQUAD),
  /** units still standing per side when it ended, so a match list needs no replay. */
  survivors: z.tuple([z.number().int(), z.number().int()]).nullable(),
  /** sim version this was fought under. Replaying under a different one is not the same fight. */
  simVersion: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Match = z.infer<typeof Match>;

export const MatchWithEvents = Match.extend({ events: z.array(MatchEvent) });
export type MatchWithEvents = z.infer<typeof MatchWithEvents>;

export const ListMatchesResponse = z.object({ matches: z.array(Match) });
export type ListMatchesResponse = z.infer<typeof ListMatchesResponse>;

export const LeaderboardResponse = z.object({ rows: z.array(LeaderboardRow) });
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;

export const ApiError = z.object({
  error: z.string(),
  /** populated when a body failed schema validation — the gate, made visible. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

// ── Wire protocol, client -> server ──────────────────────────────────────────
export const ClientMessage = z.discriminatedUnion("type", [
  /** start (or restart) streaming this match from tick 0. */
  z.object({ type: z.literal("play"), speed: z.number().min(0.1).max(8).default(1) }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("set_speed"), speed: z.number().min(0.1).max(8) }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ── Training: neuroevolution ─────────────────────────────────────────────────
// Spiking networks have no gradient to descend, so "training" here is evolution
// over brains, scored by actually fighting a panel of opponents. The determinism
// that makes replay free is also what makes fitness an exact number rather than
// a noisy sample: the same brain against the same panel and seeds always scores
// identically.

export const TrainConfig = z.object({
  generations: z.number().int().min(2).max(20).default(12),
  populationSize: z.number().int().min(6).max(32).default(24),
  /** matches per opponent; more = less seed luck, linearly more cost. */
  seedsPerOpponent: z.number().int().min(1).max(4).default(2),
  mutationRate: z.number().min(0).max(1).default(0.35),
  eliteCount: z.number().int().min(1).max(8).default(3),
  chassis: Chassis.default("HORNET"),
});
export type TrainConfig = z.infer<typeof TrainConfig>;

/**
 * Cost ceiling for one run, in simulated matches
 * (generations x populationSize x panel x seedsPerOpponent).
 *
 * Evolution is CPU-bound and synchronous, so an unbounded config is a way to
 * occupy a core for an hour. The default run is ~2,300 matches / ~30s; this caps
 * a deliberate one at roughly four times that. Rejected at the edge with the
 * number, not silently clamped.
 */
export const TRAIN_MATCH_BUDGET = 10_000;

export const TrainRequest = z.object({
  name: z.string().min(1).max(24),
  config: TrainConfig.optional(),
  /** opponents to be scored against. Omit for the house roster. */
  opponentBotIds: z.array(z.string()).min(1).max(6).optional(),
});
export type TrainRequest = z.infer<typeof TrainRequest>;

export const TrainStatus = z.enum(["PENDING", "RUNNING", "COMPLETE", "FAILED"]);
export type TrainStatus = z.infer<typeof TrainStatus>;

/** One generation, trimmed to what a chart needs. */
export const FitnessPoint = z.object({
  generation: z.number().int().min(0),
  bestScore: z.number(),
  meanScore: z.number(),
  bestWins: z.number().int(),
  matches: z.number().int(),
});
export type FitnessPoint = z.infer<typeof FitnessPoint>;

export const TrainingRun = z.object({
  id: z.string(),
  name: z.string(),
  status: TrainStatus,
  seed: z.string(),
  simVersion: z.string(),
  config: TrainConfig,
  chassis: Chassis,
  panelBotIds: z.array(z.string()),
  /** appended a generation at a time, so a chart can fill in live. */
  curve: z.array(FitnessPoint),
  generationsDone: z.number().int(),
  generationsTotal: z.number().int(),
  bestBrain: BrainSpec.nullable(),
  /** the bot evolved by this run, once it completes. */
  botId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type TrainingRun = z.infer<typeof TrainingRun>;

export const ListTrainingRunsResponse = z.object({ runs: z.array(TrainingRun) });
export type ListTrainingRunsResponse = z.infer<typeof ListTrainingRunsResponse>;

/** Messages the forked trainer sends back to the API process. */
export const TrainerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("generation"), point: FitnessPoint }),
  z.object({ type: z.literal("done"), best: BrainSpec }),
  z.object({ type: z.literal("failed"), message: z.string() }),
]);
export type TrainerMessage = z.infer<typeof TrainerMessage>;

// ── Verification ─────────────────────────────────────────────────────────────
// The whole architecture rests on one claim: a seed reproduces a fight exactly.
// Replay is free, cheating is hard and a match costs one row *only* if that is
// true. So it is checkable from the product, not just from a terminal.

export const VerifyVerdict = z.enum([
  /** Two independent replays agreed with each other and with the persisted row. */
  "REPRODUCED",
  /** Replays agreed, but the sim has moved on since. Expected, not a defect. */
  "STALE_SIM",
  /** Replays agreed and the sim has NOT moved — the row and the sim disagree. */
  "DIVERGED",
  /** The two replays disagreed with each other. The sim itself is not deterministic. */
  "NONDETERMINISTIC",
]);
export type VerifyVerdict = z.infer<typeof VerifyVerdict>;

export const VerifyMatchResponse = z.object({
  matchId: z.string(),
  /** the badge: true only for REPRODUCED. */
  reproduced: z.boolean(),
  verdict: VerifyVerdict,
  /** SHA-256 over every frame of the replay, truncated — for eyeballing, not for security. */
  digest: z.string(),
  /** the second, independent replay. Differs from `digest` only if the sim is broken. */
  digestRepeat: z.string(),
  seed: z.string(),
  squadSize: z.number().int(),
  storedTicks: z.number().int(),
  replayTicks: z.number().int(),
  storedWinnerBotId: z.string().nullable(),
  replayWinnerBotId: z.string().nullable(),
  storedOutcome: MatchOutcome.nullable(),
  replayOutcome: MatchOutcome,
  simVersion: z.object({ fought: z.string(), current: z.string() }),
  frames: z.number().int(),
  /** wall-clock cost of both replays, server-side. */
  ms: z.number().int(),
  /** one sentence a UI can show verbatim. */
  explanation: z.string(),
});
export type VerifyMatchResponse = z.infer<typeof VerifyMatchResponse>;

/** What the forked verifier hands back to the API process. */
export const VerifierResult = z.object({
  digest: z.string(),
  digestRepeat: z.string(),
  frames: z.number().int(),
  ticks: z.number().int(),
  winnerBotId: z.string().nullable(),
  outcome: MatchOutcome,
  survivors: z.tuple([z.number().int(), z.number().int()]).nullable(),
});
export type VerifierResult = z.infer<typeof VerifierResult>;

// ── Ladder: rounds against generated opponents ───────────────────────────────
// Take your tuned fly and fight successive rounds against flies that get harder.
// Losing ends the run; the round you reached is the score.
//
// A run is `(runSeed, round)` -> opponent, deterministically, so a run is
// reproducible and shareable exactly like a match. Each round is also persisted
// as a real match row, which means a ladder fight is watchable on the existing
// /ws/match/:id socket and checkable with /api/matches/:id/verify — the ladder
// adds no transport of its own.

/** Safety rail. Nobody is beating this, and it bounds the table. */
export const LADDER_MAX_ROUND = 40;

/**
 * Clear the campaign by winning this many rounds. Measured against the roster,
 * the expected furthest round is about 3 and a strong fly reaches 10, so this
 * is a real finish line rather than a formality.
 */
export const LADDER_CLEAR_ROUND = 10;

export const LadderStatus = z.enum(["ACTIVE", "ENDED", "CLEARED"]);
export type LadderStatus = z.infer<typeof LadderStatus>;

/**
 * How round N was built. Persisted per round so the difficulty curve is
 * inspectable rather than folklore — you can see exactly what beat you.
 */
export const LadderDifficulty = z.object({
  /**
   * Candidates generated and scored against *your* bot, best one kept.
   * This is the real difficulty knob: a higher round is a deeper search, so
   * late opponents are tuned to beat you specifically rather than just random.
   */
  candidatesSearched: z.number().int().min(1),
  /** fraction of BRAIN_WEIGHT_BUDGET the opponent is allowed to spend. */
  budgetFraction: z.number().min(0).max(1),
  /** fitness the chosen candidate scored against your bot while being picked. */
  bestScore: z.number(),
});
export type LadderDifficulty = z.infer<typeof LadderDifficulty>;

export const LadderRound = z.object({
  round: z.number().int().min(1),
  /** a real match row: watch it on /ws/match/:id, check it with /verify. */
  matchId: z.string(),
  /** the generated fly, snapshotted. Authoritative even if generation changes later. */
  opponent: BotSpec,
  won: z.boolean(),
  outcome: MatchOutcome,
  ticks: z.number().int(),
  difficulty: LadderDifficulty,
  createdAt: z.string(),
});
export type LadderRound = z.infer<typeof LadderRound>;

export const LadderRun = z.object({
  id: z.string(),
  seed: z.string(),
  status: LadderStatus,
  /**
   * Your bot as it was when the run started, pinned. Retuning mid-run does not
   * retroactively change the rounds you already cleared — same rule as matches.
   */
  bot: BotSpec,
  botId: z.string(),
  /** furthest round cleared. */
  round: z.number().int().min(0),
  /**
   * Clear time, in simulated ticks summed across every round fought.
   *
   * Deliberately not wall clock: wall clock measures how fast you click and
   * punishes a slow connection, and it is trivially faked. Ticks measure how
   * decisively your fly actually won, are computed server-side, and replay to
   * the same number forever.
   */
  clearTicks: z.number().int().min(0),
  simVersion: z.string(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  rounds: z.array(LadderRound),
});
export type LadderRun = z.infer<typeof LadderRun>;

export const StartLadderRequest = z.object({ botId: z.string() });
export type StartLadderRequest = z.infer<typeof StartLadderRequest>;

export const NextRoundResponse = z.object({
  run: LadderRun,
  /** the round just fought. `run.status` is ENDED when `won` is false. */
  round: LadderRound,
});
export type NextRoundResponse = z.infer<typeof NextRoundResponse>;

export const ListLadderRunsResponse = z.object({ runs: z.array(LadderRun) });
export type ListLadderRunsResponse = z.infer<typeof ListLadderRunsResponse>;

export const LadderLeaderboardRow = z.object({
  runId: z.string(),
  botName: z.string(),
  chassis: Chassis,
  /** furthest round cleared */
  round: z.number().int(),
  status: LadderStatus,
  /** true once the whole campaign is beaten — these rank above unfinished runs. */
  cleared: z.boolean(),
  /** total simulated ticks across the run; the ranking key for cleared runs. */
  clearTicks: z.number().int(),
  simVersion: z.string(),
  createdAt: z.string(),
});
export type LadderLeaderboardRow = z.infer<typeof LadderLeaderboardRow>;

export const LadderLeaderboardResponse = z.object({
  rows: z.array(LadderLeaderboardRow),
});
export type LadderLeaderboardResponse = z.infer<typeof LadderLeaderboardResponse>;

/** What the forked ladder worker hands back: the opponent it built, and the fight. */
export const LadderRoundResult = z.object({
  opponent: BotSpec,
  difficulty: LadderDifficulty,
  winnerBotId: z.string().nullable(),
  outcome: MatchOutcome,
  ticks: z.number().int(),
  survivors: z.tuple([z.number().int(), z.number().int()]).nullable(),
  hits: z.array(z.object({ tick: z.number().int(), attacker: z.string(), damage: z.number() })),
});
export type LadderRoundResult = z.infer<typeof LadderRoundResult>;

// ── Bot profile: the character-select card ───────────────────────────────────
// A fighting game shows you stat bars before you pick. Here they are derived,
// not authored: what a fly will actually *do* falls out of which circuits are
// equipped and how hard they are wired. Computed by `profileBot` in
// @workspace/sim and served alongside every bot, so the client renders one
// rather than re-deriving it and drifting from what the sim believes.

export const ProfileModule = z.object({
  module: NeuronModule,
  weight: z.number(),
  /** real FlyWire cell count for this population. */
  cells: z.number().int(),
  transmitter: z.string(),
});
export type ProfileModule = z.infer<typeof ProfileModule>;

export const BotProfile = z.object({
  /** behavioural bars, 0..100, read off the loadout. */
  aggression: z.number(),
  evasion: z.number(),
  tracking: z.number(),
  reflex: z.number(),
  /** chassis-derived, also 0..100 so every bar shares a scale. */
  hull: z.number(),
  speed: z.number(),
  agility: z.number(),
  /** one-line read on how it fights — the "character type". */
  playstyle: z.string(),
  /** total cells across every equipped population: the brain-size stat. */
  neuronCount: z.number().int(),
  modules: z.array(ProfileModule),
});
export type BotProfile = z.infer<typeof BotProfile>;
