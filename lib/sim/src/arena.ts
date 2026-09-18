import {
  ARM_REST, CHASSIS_STATS, KNOCKDOWN_TICKS, MATCH_MAX_TICKS, MAX_SQUAD, SUDDEN_DEATH_TICK, TICK_HZ,
  type ArenaBotState, type BotSpec, type MatchFrame, type MatchResult, type NeuronModule,
} from "@workspace/contract";
import { bodyRatios, type Ratios } from "./body.js";
import { armReach, fistLocal, footReach, strideFor } from "./rig.js";
import { Brain, type Senses } from "./brain.js";
import { makeRng } from "./rng.js";

/**
 * Ring size, metres. Scaled with the bodies: at the old 1.2 m torso this was 11.7
 * body-widths across, and keeping 14 m once a torso became 0.4 m turned every match
 * into a long walk — measured 4420 ticks against about 1300 before.
 */
export const ARENA_SIZE = 5.2;   // metres, square — tight enough to force engagement
/**
 * Half-width the walls close to in sudden death.
 *
 * Was a flat 2.6, which happened to equal the whole arena half once ARENA_SIZE came
 * down to match the drawn bodies — so the walls "closed" to exactly where they
 * already were and sudden death did nothing. Kept as the same FRACTION of the ring
 * it used to be (2.6 of 7.0), so it scales with the geometry from here on.
 */
export const ARENA_MIN_HALF = ARENA_SIZE * 0.186;
/** Bigger squads need more floor, or ten bots spawn inside one scrum and wipe
 *  each other out in four seconds. Scales the arena with the number of units. */
export function arenaHalfFor(squad: number): number {
  return (ARENA_SIZE / 2) * (1 + 0.17 * (Math.max(1, squad) - 1));
}

/** Walls close in after sudden death, so evasion buys time but cannot buy a draw. */
export function arenaHalfAt(tick: number, squad = 1): number {
  const base = arenaHalfFor(squad);
  const floor = ARENA_MIN_HALF * (1 + 0.22 * (Math.max(1, squad) - 1));
  if (tick <= SUDDEN_DEATH_TICK) return base;
  const t = (tick - SUDDEN_DEATH_TICK) / (MATCH_MAX_TICKS - SUDDEN_DEATH_TICK);
  return base + (floor - base) * Math.min(1, t);
}
/**
 * Torso radius, metres.
 *
 * Was 0.6 — a 1.2 m wide body on a creature 1.06 m TALL, and 4.1x wider than the
 * one actually drawn (half-shoulder 0.146 m). Bodies therefore could never close
 * inside 1.2 m while the visible arm reaches about 0.5 m, so every punch resolved
 * with the drawn fist a measured 0.94 m — nearly a whole body-height — clear of the
 * target. They looked like they were boxing past each other, because they were.
 *
 * Now it matches the shoulders that are on screen, so closing to contact means the
 * fists arrive where the bodies are.
 */
export const BOT_RADIUS = 0.2;
const DT = 1 / TICK_HZ;
// Spike trains are impulses; muscle tension is graded. A neuromuscular junction
// low-passes one into the other, and that filter is also what makes the plant
// stable — impulses straight into a double integrator can only oscillate.
const NMJ_SMOOTHING = 0.14;     // spike train -> graded drive
const DRIVE_GAIN = 5.0;         // ~20% spike duty -> ~full command
/**
 * Top speed, m/s at full command.
 *
 * Scaled down with the world. The arena went 14 m -> 5.2 m and torsos 1.2 m -> 0.4 m
 * to match the drawn bodies, but these were left alone — so everything moved about
 * three times too fast for its own size. Measured: 4.9 body-lengths per second and
 * 296 deg/s of turn, which on a 1.8 m human is an 8.8 m/s sprint while pirouetting.
 * That is what read as "weird, sometimes backwards, sometimes forwards": not the
 * gait (the planted foot tracks correctly 98.9% of stance ticks) but the pace.
 * Swept 1.00 / 0.55 / 0.40 of the old values: 4.9 / 2.7 / 2.0 body-lengths per sec.
 */
const MAX_SPEED = 1.68;         // m/s at full command, before chassis multiplier
const MAX_OMEGA = 1.36;         // rad/s at full command
const VEL_LAG = 0.16;           // how fast actual velocity chases commanded
/**
 * What the legs can actually put into the ground, m/s^2 at the stock body.
 *
 * Until now the body simply became the velocity it was asked for — kinematics in a
 * physics coat. Mass did nothing to how fast you got going, and the feet were drawn
 * on afterwards. Now the demand is the same, but it has to be DELIVERED by a foot
 * that is on the floor, and there is a ceiling on what one can deliver.
 *
 * Calibrated so a stock body is almost never capped: below the ceiling this is
 * algebraically identical to the old lag, which is what keeps the balance table and
 * the champion's fitness meaningful. What changes is the edges — a heavy body, or
 * anyone demanding a violent direction change, now runs out of traction and slides.
 */
const PUSH_CEILING = 108;
// ── FOOTFALL ────────────────────────────────────────────────────────────────
/** Fraction of the gait cycle a foot spends on the ground. >0.5 so both overlap. */
const STANCE = 0.62;
/** How high the swing foot arcs, metres. */
const STEP_ARC = 0.1;
/**
 * Where to put the foot down, as a fraction of a stride ahead of the hip.
 *
 * A stance runs from here backwards by one stride's worth of body travel, so the
 * midpoint — where the leg is actually loaded — sits at this minus half the stance.
 */
const REACH_AHEAD = 0.58;
/** Half the distance between the feet, metres. */
const HALF_HIP = 0.12;
/** Body rotation on a planted foot past which it takes a fresh step instead. */
const PIVOT_STEP = 0.30;
/** Fraction of the ceiling available at the worst point of the stride. */
const SWING_LOSS = 0.34;
const OMEGA_LAG = 0.30;
const RAM_DAMAGE = 0;          // bodies shove, they do not wound         // per m/s of closing speed
const MIN_RAM_SPEED = 0.8;      // below this a touch does nothing

// ── limbs ───────────────────────────────────────────────────────────────────
// Each bot stands on two legs and swings two arms. The arms are real angular
// bodies: motor output applies torque, momentum carries the swing, and a tip
// that crosses an enemy torso while moving fast enough lands a strike. Damage
// therefore comes from *hitting*, not from driving into someone.
const ARM_LENGTH = 0.55;        // metres from shoulder to fist
const ARM_DAMP = 0.88;
const PUNCH_IMPULSE = 13.5;     // rad/s added to an arm when a punch is thrown
const PUNCH_COOLDOWN = 6;
const PUNCH_RECOVERY = 16;      // ticks you are open after committing to a swing
const GUARD_RISE = 0.30;
const GUARD_HOLD = 14;          // ticks the arms stay up after the reflex fires        // how fast the arms come up
const GUARD_BLOCK = 0.78;       // damage removed by a full guard      // ticks between throws, so it reads as a flurry
/**
 * Pulls the arms back to the guard.
 *
 * Was 3.4, whose effective time constant works out to about 2.4 SECONDS — far
 * longer than the gap between punches, so the arm never got home. Measured, the
 * hands were in the guard only 20% of the time and spent the rest drifting
 * half-extended: no stance to speak of, and a punch was indistinguishable from the
 * drift. Swept 3.4 / 12 / 22 / 34 over 14 seeded matches, guard occupancy
 * 20 / 60 / 80 / 85% against punch travel 0.46 / 0.46 / 0.41 / 0.36 m. 22 is where
 * the hands are up and a strike still reads as a strike.
 */
const ARM_SPRING = 22;

// ── ragdoll ─────────────────────────────────────────────────────────────────
// Not a physics engine: a handful of springs integrated at the same fixed timestep
// as everything else, so a match stays bit-identical for a given seed — which
// replay, the evolution fitness function and six tests all depend on.
const LEAN_FROM_ACCEL = 0.16;   // how hard your own acceleration pitches the torso
const LEAN_SPRING = 4.2;        // pulls you back upright
const LEAN_DAMP = 0.86;
const WHIFF_LEAN = 1.05;        // a committed swing that hits nothing pitches you forward
const HIT_LEAN = 1.9;           // taking one rocks you back
const TILT_DAMP = 0.88;
const KNOCKDOWN_LEAN = 0.82;    // past this angle you are going over
     // time on the floor before you get up
const GETUP_LEAN = 0.5;         // you come up part-way bent, not snapping upright
/**
 * m/s at the fist below which a swing is a nudge, not a punch.
 *
 * Tuned against a 0.55 m arm. Now that the arena uses the arm the rig actually
 * DRAWS, a shorter-armed chassis reaches a lower tip speed for the same shoulder
 * work, and since damage is (tip − threshold) a fixed bar gutted it: median damage
 * fell to 3.2 and matches ran to the 90 s cap instead of ending in a knockout.
 * Scaling the bar with the arm keeps it meaning the same thing on every build.
 */
const STRIKE_MIN_TIP_SPEED = 3.2;   // m/s at the fist, for a 0.55 m arm
const TIP_BAR_ARM = 0.55;
/**
 * Damage per m/s of tip speed over the bar.
 *
 * Retuned from 2.9 when the collision geometry came down to the drawn bodies. The
 * fist radius shrank with BOT_RADIUS, so glancing contact became far more common
 * and the median hit fell to about 3 damage against an 80-100 hull — fights stopped
 * ending in knockouts and ran to the 90 s cap on a hull tiebreak. Swept 4.5 / 5.5 /
 * 6.5 against 16 seeded matches: 47 s / 44 s / 39 s, all decisive.
 */
const STRIKE_DAMAGE = 6.5;
/**
 * How far a fist gets from the body CENTRE. The rig hangs the shoulder on the
 * midline, so this is the arm — adding a torso radius on top, as this did, put the
 * hit half a metre beyond the hand.
 */
const STRIKE_REACH = ARM_LENGTH;
/** How close the fist has to pass to the torso to count. Tight enough that footwork
 *  and a slip can take you off the end of a punch — with a generous hitbox nothing
 *  ever whiffed, and a counter-punch bonus with no whiffs to punish is decoration. */
const FIST_RADIUS = BOT_RADIUS * 1.18;
/** What an LC11 target lock is worth once the fight is in the pocket: a slightly
 *  longer effective reach and a cleaner hit. Acquisition used to buy nothing after
 *  the approach, which left an LC11 build winless in 18 matches. */
const LOCK_REACH = 0.15;
const LOCK_DAMAGE = 0.38;
const PUNCH_RANGE = STRIKE_REACH * 1.43;   // start the swing a little before it lands

// ── range discipline ────────────────────────────────────────────────────────
// A boxer does not walk into his opponent; he stands at the end of his own reach
// and throws from there. Torsos touch at 2*BOT_RADIUS = 1.20m, and before this the
// pair spent 61% of every match welded to exactly that wall, trading from inside a
// clinch — which reads as two bodies colliding, not as a fight. The pocket is the
// band where a fist lands but a torso does not.
// Derived from the reach rather than written as absolutes, so the pocket keeps its
// shape if the geometry moves again. The multipliers are the ratios the hand-tuned
// values had against the old reach, so the FEEL of the pocket is preserved.
const POCKET_FAR = STRIKE_REACH * 1.46;   // stop closing here: your fist already reaches
const POCKET_NEAR = STRIKE_REACH * 1.25;  // forward drive is gone entirely inside this
const CLINCH_RANGE = BOT_RADIUS * 2.3;    // soft break below this — boxers separate, they do not hug

/**
 * The engagement distances, published for the balance tests.
 *
 * They used to be asserted as literals (clinch < 1.3 m, pocket 1.3–2.0 m), which
 * silently encoded a 1.2 m torso and all failed the moment the bodies were scaled
 * to the ones on screen. A test that reads these still means what it says.
 */
export const RANGES = {
  bodyTouch: BOT_RADIUS * 2,
  clinch: CLINCH_RANGE,
  pocketNear: POCKET_NEAR,
  pocketFar: POCKET_FAR,
  strikeReach: STRIKE_REACH,
} as const;
/**
 * Separation acceleration at full penetration, m/s^2.
 *
 * Scaled with the pace. Velocities came down to 0.40 of their old values when the
 * world shrank, but the impulses that CHANGE velocity did not — so a shove became
 * proportionally three times harder and repeatedly tore bodies off their planted
 * feet. Foot slip went from 2.6% of distance travelled to 6.4%.
 */
const BREAK_PUSH = 10.4;

// ── footwork ────────────────────────────────────────────────────────────────
// Holding range is only half of it; standing still at range is not boxing either.
// An uncommitted bot slides sideways around the pocket while its heading stays on
// the target, so the fight circles instead of shuttling in and out on one axis.
const STRAFE_SPEED = 0.72;      // m/s of lateral slide, before the chassis turn stat
const CIRCLE_MIN = 45;          // ticks committed to one direction...
const CIRCLE_SPAN = 120;        // ...plus up to this many more

// ── stamina ─────────────────────────────────────────────────────────────────
// Every commit spends from the tank; a held guard and time spent out of the pocket
// pay it back. Empty does not stop the swing, it slows it — and a slow fist cannot
// clear STRIKE_MIN_TIP_SPEED, so a gassed bot whiffs on its own punches. That is the
// pacing pressure: flurry now and the next exchange is fought on empty.
const PUNCH_COST = 0.22;        // ~4.5 punches in the tank before it starts to bite
const REGEN_BASE = 0.0026;      // always ticking over
const REGEN_GUARD = 0.006;      // arms up, breathing
const REGEN_RANGE = 0.006;      // outside the pocket, resetting
const GAS_FLOOR = 0.45;         // punch power multiplier on an empty tank
const GASSED_RECOVERY = 7;      // extra open ticks when you swing on empty
/** Hysteresis, not a threshold. A bot that empties the tank has to breathe some of
 *  it back before it commits again — otherwise it flails one weak punch per refill
 *  forever, which is exactly what the first measurement showed (4.7% of 10,102
 *  swings landed). Covering up while it recovers is what a blown boxer does. */
const GASSED_RESET = 0.45;

/** A strike landing on a bot still recovering from its own swing is a counter:
 *  you did not just hit him, you hit him with his hands down. This is what makes
 *  baiting a whiff pay better than trading, and what makes the 16 recovery ticks
 *  a real decision rather than a formality. */
const COUNTER_BONUS = 1.6;

// ── rhythm ──────────────────────────────────────────────────────────────────
// Boxers throw in flurries, not on a metronome. Inside a flurry the only gate is
// the gap between punches; at the end of one you eat the whole recovery window and
// then have to reset before starting another. A combo therefore buys pressure and
// pays for it with one long exposure instead of three short ones. Flurry length is
// set by P1 arousal, so a wound-up bot really does open up.
const COMBO_MAX = 3;
const COMBO_GAP = 7;            // ticks between punches inside a flurry
const RESET_TICKS = 26;         // hands back up, feet moving, before the next flurry
/** You do not throw at someone who is not in front of you. The geometric hit cone
 *  at pocket range is about 35 degrees, so swinging outside this is a guaranteed
 *  whiff — and whiffing was 80% of all punches before this gate existed. */
const PUNCH_CONE = 0.50;        // radians of bearing error

interface Body {
  spec: BotSpec;
  /** 0 = team A, 1 = team B */
  team: 0 | 1;
  alive: boolean;
  brain: Brain;
  x: number; y: number; heading: number;
  vx: number; vy: number; omega: number;
  /** NMJ-filtered motor drive, not raw spike impulses */
  driveFwd: number; driveTurn: number;
  /** arm angles and angular velocities, relative to torso heading */
  armL: number; armR: number; armLv: number; armRv: number;
  gait: number; struck: boolean;
  /** world metres, [Lx,Ly,Lz,Rx,Ry,Rz] — where each foot IS, not where it is drawn */
  feet: Float64Array;
  /** was this foot on the ground last tick, so a touchdown can be detected */
  footDown: [boolean, boolean];
  /** where the foot lifted off from, to swing out of */
  footFrom: Float64Array;
  /** recovery steps forced by drift, so the rate can be watched rather than assumed */
  replants: number;
  /** heading when each foot went down, so a pivot can be turned into a step */
  footPlantHeading: Float64Array;
  punchCd: number; punchSide: 0 | 1;
  guard: number; recovery: number; blocked: boolean; guardHold: number;
  lean: number; leanV: number; tilt: number; tiltV: number; down: number; swungAt: number;
  /** true on the tick this bot ate a counter — for the HUD, like `blocked` */
  countered: boolean;
  /** 0..1 gas tank; punching spends it, guarding and range refill it */
  stamina: number;
  /** blown: covering up and breathing until the tank is back over GASSED_RESET */
  gassed: boolean;
  /** punches still owed to the flurry in progress */
  comboLeft: number;
  /** which way this bot is currently circling, and for how many more ticks */
  circleDir: 1 | -1; circleTimer: number;
  hull: number;
  /** every mechanic as a multiple of this chassis's stock build; all 1 when untuned */
  phys: Ratios;
  /** metres shoulder-to-fist, and the ranges that follow from it */
  armLength: number;
  strikeReach: number;
  punchRange: number;
  /** lean angle this body tips over at — wider stance, larger angle */
  knockdownLean: number;
  prevAngularSize: number;
  damageThisTick: number;
  arenaHalf: number;
}

/** Nearest living enemy, or null if that team is wiped out. */
function nearestFoe(self: Body, all: Body[]): Body | null {
  let best: Body | null = null, bestD = Infinity;
  for (const o of all) {
    if (o.team === self.team || !o.alive) continue;
    const d = Math.hypot(o.x - self.x, o.y - self.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function senses(self: Body, foe: Body): Senses {
  const dx = foe.x - self.x;
  const dy = foe.y - self.y;
  const distance = Math.max(0.01, Math.hypot(dx, dy));
  let bearing = Math.atan2(dy, dx) - self.heading;
  while (bearing > Math.PI) bearing -= 2 * Math.PI;
  while (bearing < -Math.PI) bearing += 2 * Math.PI;
  const angularSize = 2 * Math.atan(BOT_RADIUS / distance);
  // A fist coming at your face is a looming edge too — arguably the one LPLC2 is for.
  // Without this the Giant Fiber only ever answers a charge, and once the bots hold
  // their range nobody charges: blocks collapsed to 5.7% of hits. Same channel, same
  // cell, because the fly does not have a separate detector for punches.
  const foeTip = Math.max(Math.abs(foe.armLv), Math.abs(foe.armRv)) * foe.armLength;
  const incoming = distance < foe.punchRange * 1.2 && foeTip > STRIKE_MIN_TIP_SPEED * (foe.armLength / TIP_BAR_ARM) * 0.55
    ? foeTip * 0.22 * (1 - 0.5 * distance / (foe.punchRange * 1.2))
    : 0;
  const half = self.arenaHalf;
  const wallAhead = Math.min(
    half - Math.abs(self.x + Math.cos(self.heading) * 1.5),
    half - Math.abs(self.y + Math.sin(self.heading) * 1.5),
  );
  return {
    distance, bearing, angularSize,
    expansionRate: (angularSize - self.prevAngularSize) * TICK_HZ + incoming,
    hullFraction: self.hull / (CHASSIS_STATS[self.spec.chassis].hull * self.phys.hull),
    wallAhead: Math.max(0, wallAhead),
  };
}

function toState(b: Body, spiked: NeuronModule[]): ArenaBotState {
  return {
    botId: b.spec.id,
    x: +b.x.toFixed(4), y: +b.y.toFixed(4), heading: +b.heading.toFixed(4),
    vx: +b.vx.toFixed(4), vy: +b.vy.toFixed(4),
    hull: +b.hull.toFixed(2),
    spiked,
    potentials: b.brain.potentials() as Record<NeuronModule, number>,
    guard: +b.guard.toFixed(3), recovery: b.recovery, blocked: b.blocked,
    lean: +b.lean.toFixed(3), tilt: +b.tilt.toFixed(3), down: b.down,
    countered: b.countered, stamina: +b.stamina.toFixed(3),
    arousal: +b.brain.arousalLevel.toFixed(3),
    gfFatigue: +b.brain.fatigueLevel.toFixed(3),
    armL: +b.armL.toFixed(3), armR: +b.armR.toFixed(3),
    armLv: +b.armLv.toFixed(3), armRv: +b.armRv.toFixed(3),
    gait: +b.gait.toFixed(3), struck: b.struck,
    feet: Array.from(b.feet, (v) => +v.toFixed(4)),
  };
}

/**
 * Run a whole match deterministically. A match is fully described by
 * (seed, botA, botB) — so replay is just calling this again. Nothing is stored
 * per frame; the server streams what this yields and throws it away.
 */
export function* runMatch(
  seed: string, specA: BotSpec, specB: BotSpec, squadSize = 1,
): Generator<MatchFrame, MatchResult, void> {
  const rng = makeRng(seed);
  const n = Math.max(1, Math.min(MAX_SQUAD, Math.floor(squadSize)));

  const mk = (spec: BotSpec, team: 0 | 1, angle: number, idx: number): Body => {
    /**
     * Spawn radius. They start on opposite sides, so separation is twice this.
     *
     * Was 0.74 of the half-arena plus up to 1.2 m, which put them 3.8-6.2 m apart
     * in a 5.2 m ring. At the pace the bots actually move that is a 2.7 s walk
     * before the first punch lands — nearly a quarter of a 12 s round spent with
     * nothing happening, and it reads as the fighters doing nothing to each other.
     * Closer start, same ring: still an approach, just not a hike.
     */
    const r = arenaHalfFor(n) * 0.45 + rng() * 0.6;
    // fan the squad out along an arc so they do not spawn stacked
    const spread = n === 1 ? 0 : (idx / (n - 1) - 0.5) * 0.9;
    const a = angle + spread;
    // Hoisted so the feet can be placed relative to it. Reconstructing it inside the
    // literal is not possible — it consumes the rng, and the spawn must stay seeded.
    const heading0 = a + Math.PI + (rng() - 0.5) * 0.5;
    const spawnX = Math.cos(a) * r, spawnY = Math.sin(a) * r;
    const latX0 = -Math.sin(heading0) * HALF_HIP, latY0 = Math.cos(heading0) * HALF_HIP;
    return {
      spec: n === 1 ? spec : { ...spec, id: `${spec.id}#${idx}` },
      team, alive: true,
      brain: new Brain(spec.brain, rng),
      x: spawnX, y: spawnY,
      heading: heading0,
      vx: 0, vy: 0, omega: 0,
      driveFwd: 0, driveTurn: 0,
      armL: ARM_REST, armR: -ARM_REST, armLv: 0, armRv: 0, gait: rng(), struck: false,
      // Under the hips from tick zero. Zeroed, these sat at the world ORIGIN while
      // the bot spawned five metres out, so both legs reached across the arena until
      // the first touchdown.
      feet: new Float64Array([
        spawnX - latX0, spawnY - latY0, 0,
        spawnX + latX0, spawnY + latY0, 0,
      ]),
      footDown: [false, false], replants: 0, footPlantHeading: new Float64Array([heading0, heading0]),
      // Seeded like `feet`: a foot that spawns part-way through its SWING is
      // interpolated out of footFrom, and zeroed that is the world origin.
      footFrom: new Float64Array([
        spawnX - latX0, spawnY - latY0, 0,
        spawnX + latX0, spawnY + latY0, 0,
      ]),
      punchCd: 0, punchSide: 0, guard: 0, recovery: 0, blocked: false, guardHold: 0,
      lean: 0, leanV: 0, tilt: 0, tiltV: 0, down: 0, swungAt: -99,
      countered: false, stamina: 1, gassed: false, comboLeft: 0,
      circleDir: rng() < 0.5 ? -1 : 1, circleTimer: CIRCLE_MIN + Math.floor(rng() * CIRCLE_SPAN),
      hull: CHASSIS_STATS[spec.chassis].hull * bodyRatios(spec.chassis, spec.body).hull,
      ...(() => {
        // Derived once per bot, not per tick: the body does not change mid-fight.
        const phys = bodyRatios(spec.chassis, spec.body);
        // the arm the RIG draws for this chassis, so the hit is the hand on screen
        const armLength = armReach(spec.chassis) * phys.reach;
        const strikeReach = BOT_RADIUS + armLength;
        return {
          phys, armLength, strikeReach,
          punchRange: strikeReach + 0.50,
          knockdownLean: KNOCKDOWN_LEAN * phys.knockdownAngle,
        };
      })(),
      prevAngularSize: 0, damageThisTick: 0, arenaHalf: ARENA_SIZE / 2,
    };
  };

  const spawn = rng() * Math.PI * 2;
  const bodies: Body[] = [];
  for (let i = 0; i < n; i++) bodies.push(mk(specA, 0, spawn, i));
  for (let i = 0; i < n; i++) bodies.push(mk(specB, 1, spawn + Math.PI, i));
  const teamSplit = n;

  const aliveOn = (team: 0 | 1) => bodies.filter((b) => b.team === team && b.alive).length;

  let tick = 0;
  for (; tick < MATCH_MAX_TICKS; tick++) {
    const half = arenaHalfAt(tick, n);
    for (const b of bodies) b.arenaHalf = half;
    const hits: MatchFrame["hits"] = [];
    const fired: NeuronModule[][] = bodies.map(() => []);

    // think
    bodies.forEach((body, i) => {
      if (!body.alive) return;
      const foe = nearestFoe(body, bodies);
      if (!foe) return;
      const s = senses(body, foe);
      const { intent, spiked } = body.brain.step(s, body.damageThisTick);
      fired[i] = spiked;
      body.damageThisTick = 0;
      body.prevAngularSize = s.angularSize;

      const base = CHASSIS_STATS[body.spec.chassis];
      // The chassis still sets the character; the body scales it. Square-cube law on
      // accel, yaw inertia on turn — both exactly 1.0 for a bot that never got tuned.
      const stats = { hull: base.hull, accel: base.accel * body.phys.accel, turn: base.turn * body.phys.turn };

      // The Giant Fiber means two different things at two distances. Far away it is an
      // escape: reverse hard and turn out. At punching range the same spike is a block,
      // and a boxer who backs out of every jab never fights — so in range the flight
      // half is damped to a slip and only the hands (the guard, below) answer. Done to
      // the intent rather than in the brain because it is the *body* that knows how far
      // away the other one is; the cell fires the same either way.
      const closeQuarters = s.distance < body.punchRange * 1.25;
      if (closeQuarters && spiked.includes("LPLC2_DNP01")) {
        intent.forward = Math.max(intent.forward, -0.4);
        intent.turn *= 0.4;
      }

      const clamp = (v: number) => Math.max(-1.6, Math.min(1.6, v));
      body.driveFwd  += (clamp(intent.forward) - body.driveFwd)  * NMJ_SMOOTHING;
      body.driveTurn += (clamp(intent.turn)    - body.driveTurn) * NMJ_SMOOTHING;
      let wantSpeed = Math.max(-1, Math.min(1, body.driveFwd * DRIVE_GAIN)) * MAX_SPEED * stats.accel;
      const wantOmega = Math.max(-1, Math.min(1, body.driveTurn * DRIVE_GAIN)) * MAX_OMEGA * stats.turn;
      const foeDist = s.distance;

      // RANGE DISCIPLINE. Pursuit is allowed to want the opponent's centre; the legs
      // are not. Forward drive fades out across the pocket and is gone by the time a
      // fist can land, so closing ends at punching range instead of at the chest.
      // Deliberately a motor governor rather than a brain edit: LC10a still fires, so
      // the spike raster still shows pursuit and evolution's fitness landscape keeps
      // its shape. Backing off is never suppressed — you can always give ground.
      // How far out this bot wants to stand *right now*. Blown, or covering up behind
      // a guard, means make space and breathe; otherwise hold the end of your own
      // reach. A standoff that moves with the bot's state is what gives the fight an
      // in-and-out rhythm instead of one fixed trading range — and a punch thrown at
      // someone who has just stepped back is the whiff the counter-punch exists for.
      // The pocket is where YOUR fist already reaches, so it travels with your arm.
      const pocketFar = POCKET_FAR + (body.armLength - ARM_LENGTH);
      const standoff = body.gassed ? pocketFar + 0.9
        : body.guard > 0.45 ? pocketFar + 0.3 : pocketFar;
      const inner = standoff - (POCKET_FAR - POCKET_NEAR);
      if (wantSpeed > 0 && foeDist < standoff) {
        const t = Math.max(0, (foeDist - inner) / (standoff - inner));
        wantSpeed *= t * t;
      }
      // Blown means actively giving ground, not merely stopping. Get on your bike.
      if (body.gassed && foeDist < inner) {
        wantSpeed = Math.min(wantSpeed, -MAX_SPEED * stats.accel * 0.45);
      }

      // FOOTWORK. Not committed to a swing and inside engaging distance means circle.
      // Direction is held for a stretch and flips off a wall, so nobody grinds along
      // the boards, and a tired bot stops dancing.
      let lx = 0, ly = 0, strafe = 0;
      if (foeDist < pocketFar + 1.6) {
        if (--body.circleTimer <= 0) {
          body.circleDir = rng() < 0.5 ? -1 : 1;
          body.circleTimer = CIRCLE_MIN + Math.floor(rng() * CIRCLE_SPAN);
        }
        lx = -Math.sin(body.heading) * body.circleDir;
        ly = Math.cos(body.heading) * body.circleDir;
        const edge = Math.max(BOT_RADIUS, body.arenaHalf - BOT_RADIUS - 0.35);
        if (Math.abs(body.x + lx) > edge || Math.abs(body.y + ly) > edge) {
          body.circleDir = body.circleDir === 1 ? -1 : 1;
          lx = -lx; ly = -ly;
        }
        // planted on the follow-through, but the feet never stop entirely
        strafe = STRAFE_SPEED * stats.turn * (0.5 + 0.5 * body.stamina)
          * (body.recovery > 0 ? 0.35 : 1);
      }

      // ── LOCOMOTION: the foot pushes the ground, the ground pushes back ──────
      // The brain still asks for a velocity. Getting it is now the legs' problem.
      const wantVx = Math.cos(body.heading) * wantSpeed + lx * strafe;
      const wantVy = Math.sin(body.heading) * wantSpeed + ly * strafe;

      // A leg can only push while its foot is down. The two alternate, so contact
      // never drops to zero, but thrust dips as weight transfers — which is what
      // gives a stride its surge instead of a constant glide. Same gait phase the
      // pose plants the foot on, so the push happens on the leg you can see loaded.
      const stanceLoad = 1 - SWING_LOSS * Math.abs(Math.sin(body.gait * Math.PI * 2));

      // Square-cube law, already computed for this body: leg force goes as m^(2/3)
      // while the mass to shift goes as m, so deliverable acceleration is m^(-1/3).
      const canPush = PUSH_CEILING * body.phys.accel * stanceLoad
        // you cannot drive off a leg that is carrying a falling body
        * (body.down > 0 ? 0 : 1);

      // Demand is the old first-order response, expressed as an acceleration. Under
      // the ceiling `v += a*DT` reduces exactly to `v += (want - v) * VEL_LAG`, so
      // nothing changes for a bot that is not asking for more grip than it has.
      let pushX = ((wantVx - body.vx) * VEL_LAG) / DT;
      let pushY = ((wantVy - body.vy) * VEL_LAG) / DT;
      const demand = Math.hypot(pushX, pushY);
      if (demand > canPush) {
        // out of traction: you get what the foot can give and slide the rest
        const slip = canPush / demand;
        pushX *= slip; pushY *= slip;
      }
      body.vx += pushX * DT;
      body.vy += pushY * DT;
      const prevVx = body.vx, prevVy = body.vy;
      body.omega += (wantOmega - body.omega) * OMEGA_LAG;

      // Lean is a spring driven by the acceleration you just asked for. Change
      // direction hard and your own weight pitches you over.
      const ax = body.vx - prevVx, ay = body.vy - prevVy;
      const fwdX = Math.cos(body.heading), fwdY = Math.sin(body.heading);
      body.leanV += (ax * fwdX + ay * fwdY) * LEAN_FROM_ACCEL * 60;
      body.leanV += -LEAN_SPRING * body.lean * DT;
      body.leanV *= LEAN_DAMP;
      body.lean += body.leanV * DT;
      body.tiltV += -LEAN_SPRING * body.tilt * DT;
      body.tiltV *= TILT_DAMP;
      body.tilt += body.tiltV * DT;

      // Empty stamina and the legs stop holding you up.
      if (body.stamina <= 0.02) body.lean += 0.012;

      if (Math.abs(body.lean) > body.knockdownLean || Math.abs(body.tilt) > body.knockdownLean) {
        body.down = KNOCKDOWN_TICKS;
        // Clamp BOTH axes. Only lean was held, so roll kept whatever value tipped
        // the body over and then froze there for the whole count — measured out to
        // 1.61 rad, which is a bot lying fully on its side rather than going down.
        body.lean = Math.sign(body.lean) * body.knockdownLean;
        body.tilt = Math.sign(body.tilt) * Math.min(Math.abs(body.tilt), body.knockdownLean);
      }

      // Arms. A punch is an EVENT, not an oscillation: when the brain is driving
      // forward and a target is inside reach, dump a single large impulse into the
      // alternating arm and let momentum carry the fist through. Tying the swing to
      // the gait phase failed — at speed the gait cycles every five ticks, so the
      // torque reversed before the arm could build any tip speed at all.
      if (body.punchCd > 0) body.punchCd--;
      if (body.recovery > 0) body.recovery--;

      // On the floor: no thinking, no guard, no punches. You just get up, and you
      // come up part-way bent rather than snapping vertical.
      if (body.down > 0) {
        body.down--;
        // Feet are not bearing weight while you are down, and leaving them pinned
        // where you fell means the legs stretch back to them as the body slides and
        // then snap on the getup. Park them under the hips and re-plant on the way up.
        for (let side = 0; side < 2; side++) {
          const o = side * 3;
          const lat = (side === 0 ? -1 : 1) * HALF_HIP;
          body.feet[o] = body.x + -Math.sin(body.heading) * lat;
          body.feet[o + 1] = body.y + Math.cos(body.heading) * lat;
          body.feet[o + 2] = 0;
          body.footDown[side] = false;
        }
        body.guard = 0; body.guardHold = 0;
        body.vx *= 0.82; body.vy *= 0.82; body.omega *= 0.7;
        if (body.down === 0) {
          // Come up on the side you went down on.
          //
          // This used to snap to a POSITIVE GETUP_LEAN whatever direction you fell,
          // so a body that went over backwards flipped from -0.79 to +0.50 in one
          // tick. The ragdoll rotates the whole figure about its feet, so that is
          // 74 degrees of whole-body rotation in a single frame and the fists
          // teleport about 0.9 m — measured at 53 m/s against a true tip speed near
          // 4. Preserving the sign keeps the getup on the correct side and turns a
          // 1.29 rad discontinuity into a 0.29 rad one the lean spring can absorb.
          body.lean = (body.lean < 0 ? -1 : 1) * GETUP_LEAN;
          body.leanV = 0;
          // Roll gets the same treatment rather than being multiplied to a third of
          // itself, which was its own 0.39 rad step. Easing it to just under the
          // tipping angle keeps it below the knockdown test without the jolt.
          body.tilt = (body.tilt < 0 ? -1 : 1) * Math.min(Math.abs(body.tilt), GETUP_LEAN);
          body.tiltV = 0;
        }
        return;
      }

      // Stamina regen. Holding a guard or standing off the pocket is how you breathe;
      // a bot that never stops throwing never refills.
      body.stamina = Math.min(1, body.stamina + REGEN_BASE
        + (body.guard > 0.45 ? REGEN_GUARD : 0)
        + (foeDist > pocketFar ? REGEN_RANGE : 0));
      if (body.stamina <= 0.02) body.gassed = true;
      else if (body.gassed && body.stamina > GASSED_RESET) body.gassed = false;

      // The Giant Fiber reads looming. Far away that means run; at punching range it
      // means an incoming fist, so the same spike puts the arms up instead. Escape
      // and block are one reflex pointed at two distances — which is why habituation
      // hurts twice: a tired Giant Fiber can neither flee nor guard.
      const inRange = closeQuarters;
      // A block is held, not flashed. One spike commits the arms for a window —
      // which is exactly why it is a decision: guard up means no punches thrown.
      if (spiked.includes("LPLC2_DNP01") && inRange && body.recovery === 0) body.guardHold = GUARD_HOLD;
      // Blown means cover up. Nothing decides this — there is nothing left to decide
      // with — and holding the guard is also the fastest way back to a full tank.
      if (body.gassed && body.recovery === 0) body.guardHold = Math.max(body.guardHold, 2);
      if (body.guardHold > 0) body.guardHold--;
      const wantGuard = body.guardHold > 0 && body.recovery === 0;
      body.guard += ((wantGuard ? 1 : 0) - body.guard) * GUARD_RISE;
      // you cannot block out of a swing you already committed to
      if (body.recovery > 0) body.guard = 0;
      // MDN (moonwalker) pulls back out of range to reset — spacing, not just reverse.
      const backingOff = spiked.includes("MDN");
      // LC10a pursuit fires the strike; P1 arousal lets a wound-up bot swing harder.
      const pursuitFired = spiked.includes("LC10A");
      // Committing to a punch means dropping your guard and eating recovery frames.
      // That is the whole trade: offence costs you defence for a fixed window.
      // Starting a flurry needs hands free, gas in the tank and the target actually in
      // front of you; continuing one only needs the gap between punches to have elapsed.
      const aimed = Math.abs(s.bearing) < PUNCH_CONE;
      const canStart = body.recovery === 0 && body.guard < 0.35 && !body.gassed;
      const wantsToHit = pursuitFired && !backingOff && foeDist < body.punchRange && aimed
        && body.punchCd === 0 && (body.comboLeft > 0 || canStart);
      if (wantsToHit) {
        if (body.comboLeft === 0) {
          // A fresh bot doubles up; P1 arousal buys the third punch. Gating length on
          // arousal alone handed every flurry to the two builds that equip P1.
          const wound = (body.brain.arousalLevel - 1) / 0.4;
          body.comboLeft = Math.max(1, Math.min(COMBO_MAX,
            1 + (body.stamina > 0.6 ? 1 : 0) + Math.floor(wound)));
        }
        const gas = GAS_FLOOR + (1 - GAS_FLOOR) * body.stamina;
        // Tip speed is ω·L, so to land the mechanically correct v_tip on an arm of
        // this length the angular impulse carries tipSpeed/reach. A long arm gets LESS
        // angular velocity and still ends up slower at the fist — that is the trade.
        const swing = PUNCH_IMPULSE * (body.phys.tipSpeed / body.phys.reach);
        const power = swing * gas * (0.75 + 0.25 * Math.min(1, body.brain.arousalLevel - 0.4));
        if (body.punchSide === 0) body.armLv -= power; else body.armRv += power;
        body.punchSide = body.punchSide === 0 ? 1 : 0;
        body.stamina = Math.max(0, body.stamina - PUNCH_COST);
        body.comboLeft--;
        if (body.comboLeft > 0) {
          // still inside the flurry: open the whole way through it, which is what
          // makes a long combo a gamble rather than free damage
          body.punchCd = COMBO_GAP;
          body.recovery = COMBO_GAP + 2;
        } else {
          // swinging on empty leaves you open longer, which is the cost of flailing
          body.recovery = PUNCH_RECOVERY + (body.stamina < 0.3 ? GASSED_RECOVERY : 0);
          body.punchCd = body.recovery + RESET_TICKS;
        }
      }
      // spring back to guard, with damping
      body.armLv += -ARM_SPRING * (body.armL - ARM_REST) * DT;
      body.armRv += -ARM_SPRING * (body.armR + ARM_REST) * DT;
      body.armLv *= ARM_DAMP; body.armRv *= ARM_DAMP;
      body.armL += body.armLv * DT; body.armR += body.armRv * DT;
      body.armL = Math.max(-2.2, Math.min(2.2, body.armL));
      body.armR = Math.max(-2.2, Math.min(2.2, body.armR));
      // Gait advances so the PLANTED FOOT STAYS PUT.
      //
      // The swing foot travels 2·stride while the body covers v·T over the same
      // half cycle, so not slipping means T = 2·stride/v and the phase rate is
      // v/(4·stride). It used to be a flat 0.02 + 0.055·v, which at walking pace
      // cycles the legs about five times faster than the ground actually moves:
      // the feet scrabbled in place and the whole fight read as sliding rather
      // than walking. `strideFor` is the same function the pose uses to put the
      // foot down, so the two cannot drift apart.
      const gaitSpeed = Math.hypot(body.vx, body.vy);
      /**
       * The step is sized by the LEG, not by a curve fitted to speed.
       *
       * A foot plants `reach` ahead of the hip and stays put until the body has
       * carried it `reach` behind, so one stance sweeps 2·reach of ground. That
       * sweep is the whole budget: it is the furthest the leg can span without
       * straightening. The cycle then follows from how long that takes —
       * T_stance = 2·reach / v, and the stance is STANCE of a full cycle.
       *
       * Deriving it the other way round, from a stride curve, is what broke it:
       * the body travelled 2.48 strides during a stance the leg could only span
       * 0.26 m of, so 62% of planted feet were beyond reach and the limb stretched.
       */
      const reach = footReach(body.spec.chassis);
      const sweep = 2 * reach;
      const stride = reach;
      // a slow weight shift so a bot that has stopped is not frozen solid
      body.gait = (body.gait + Math.max(0.004, (STANCE * gaitSpeed) / (sweep * TICK_HZ))) % 1;

    });

    // move
    for (const body of bodies) {
      if (!body.alive) continue;
      body.x += body.vx * DT; body.y += body.vy * DT; body.heading += body.omega * DT;

      if (body.down === 0) {
      /**
       * FOOTFALL — plant the foot in the WORLD and leave it there.
       *
       * This is the difference between walking and sliding, and no amount of gait
       * timing fixes it. The pose used to place each foot in BODY-LOCAL space at
       * cos(phase)·stride, so the foot was repositioned relative to the body every
       * frame and could never actually be stationary on the ground — matching the
       * phase rate to ground speed only made it right ON AVERAGE across a half
       * cycle, while instantaneously the foot still swept back and forth.
       *
       * Now a foot in stance holds a fixed world coordinate, full stop. The body
       * travels over it, the leg solves to reach it, and the contact is real. A
       * foot in swing arcs from where it lifted off to where it will next land,
       * one stride ahead of the hip.
       */
      // Runs AFTER integration so the reach clamp is applied against where the body
      // actually ended up this tick, not where it was a tick ago.
      const reach = footReach(body.spec.chassis);
      const stepX = Math.cos(body.heading), stepY = Math.sin(body.heading);
      const latX = -stepY, latY = stepX;
      // direction of travel, falling back to the heading when barely moving
      const vmag = Math.hypot(body.vx, body.vy);
      const goX = vmag > 0.05 ? body.vx / vmag : stepX;
      const goY = vmag > 0.05 ? body.vy / vmag : stepY;
      for (let side = 0; side < 2; side++) {
        const o = side * 3;
        // the two feet run half a cycle apart
        const ph = (body.gait + (side === 0 ? 0 : 0.5)) % 1;
        const inStance = ph < STANCE;
        const lateral = (side === 0 ? -1 : 1) * HALF_HIP;
        // where this foot would land if it came down now
        // Step where the body is actually GOING, not where it is facing.
        //
        // Boxers circle and strafe: a lot of the travel during a stance is sideways,
        // and aiming the plant down the heading budgeted none of it. The foot then
        // ran out of reach halfway through and was dragged — 47% of stance ticks.
        const tx = body.x + goX * reach + latX * lateral;
        const ty = body.y + goY * reach + latY * lateral;

        if (inStance) {
          // A shove, a knockback or a hard turn can carry the body further in one
          // stance than the gait budgeted for, and a foot left pinned behind it
          // stretches the leg to a length it does not have — measured out to 5.2 m
          // on a 0.52 m leg, which the knee solver cannot answer and the mesh wears
          // as a distortion. Past the limit the foot is simply picked up and put
          // down again. It is a discrete correction, and it is what a body does
          // when it is shoved: it takes a recovery step.
          const hipX = body.x + latX * lateral, hipY = body.y + latY * lateral;
          /**
           * Turning on a planted foot is a STEP, not a scrape.
           *
           * The foot plants correctly — 89.6% of stance ticks are perfectly still —
           * but 80% of the remaining drag happens while the body is rotating: the
           * hips swing around a foot that is pinned, the reach clamp catches it, and
           * it scrapes. A boxer pivoting past this angle picks the foot up and puts
           * it down again.
           */
          const turned = Math.abs(((body.heading - body.footPlantHeading[side]! + Math.PI)
            % (2 * Math.PI)) - Math.PI);
          if (!body.footDown[side] || turned > PIVOT_STEP) {
            // touchdown: commit to this spot and do not move it again until liftoff
            body.feet[o] = tx; body.feet[o + 1] = ty;
            body.footDown[side] = true;
            body.footPlantHeading[side] = body.heading;
          }
          body.feet[o + 2] = 0;

          /**
           * The leg may never be asked for more than it has.
           *
           * A stance is budgeted to sweep exactly 2·reach of ground, which works
           * while the body travels at the speed the gait was derived from. It does
           * not survive a shove, a knockback or a hard strafe — the body outruns
           * its own foot, and no re-planting rule fixes that, because by the time
           * the rule trips the leg is already stretched. Re-planting on drift also
           * fired more often than feet actually landed.
           *
           * So the invariant is enforced directly: a planted foot is pulled back to
           * the edge of the reachable circle whenever the body has gone too far.
           * That IS a drag, and it is meant to be — being shoved off your stance
           * scrapes your foot along the floor. Normal walking never reaches it, so
           * slip stays exactly zero there.
           */
          const dxh = body.feet[o] - hipX, dyh = body.feet[o + 1] - hipY;
          const dh = Math.hypot(dxh, dyh);
          if (dh > reach) {
            const k = reach / dh;
            body.feet[o] = hipX + dxh * k;
            body.feet[o + 1] = hipY + dyh * k;
            body.replants++;
          }
        } else {
          if (body.footDown[side]) {
            // liftoff: remember where we left, to swing out of it
            body.footFrom[o] = body.feet[o];
            body.footFrom[o + 1] = body.feet[o + 1];
            body.footDown[side] = false;
          }
          const t = (ph - STANCE) / (1 - STANCE);
          // ease in and out so the foot does not jerk off the floor or slam down
          const e = t * t * (3 - 2 * t);
          body.feet[o] = body.footFrom[o] + (tx - body.footFrom[o]) * e;
          body.feet[o + 1] = body.footFrom[o + 1] + (ty - body.footFrom[o + 1]) * e;
          body.feet[o + 2] = Math.sin(Math.PI * t) * STEP_ARC;
        }
      }
      }

      const lim = Math.max(BOT_RADIUS, half - BOT_RADIUS);
      if (Math.abs(body.x) > lim) { body.x = Math.sign(body.x) * lim; body.vx *= -0.35; }
      if (Math.abs(body.y) > lim) { body.y = Math.sign(body.y) * lim; body.vy *= -0.35; }
    }

    for (const b of bodies) { b.struck = false; b.blocked = false; b.countered = false; }

    // STRIKES. A fist is at the end of a swinging arm; if it crosses an enemy
    // torso while moving fast enough, that is a hit. Tip speed = |omega| * length,
    // so a wild swing hurts and a slow reach does nothing.
    for (const att of bodies) {
      if (!att.alive) continue;
      for (const side of [0, 1] as const) {
        const ang = side ? att.armR : att.armL;
        const av = Math.abs(side ? att.armRv : att.armLv);
        const tipSpeed = av * att.armLength;
        const tipBar = STRIKE_MIN_TIP_SPEED * (att.armLength / TIP_BAR_ARM);
        if (tipSpeed < tipBar) continue;

        /**
         * Resolve the strike against the arm that is actually DRAWN.
         *
         * This used to place the fist at full extension the instant a swing was
         * live — `BOT_RADIUS + armLength`, always — while the rig drew the hand
         * anywhere from 42% to 100% of the way out, swinging with the gait. The
         * hit and the picture were two different events: a punch could land with
         * the visible arm still tucked into the guard, or sweep clean through a
         * body and do nothing.
         *
         * `fistLocal` is the same function the pose calls, so the angle and the
         * extension here are the ones on screen. The reach stays on the arena's
         * scale (BOT_RADIUS is a collision radius, not a drawing measurement) —
         * what changes is that the arm must genuinely be out and pointed at you.
         */
        const drawn = fistLocal(att, att.spec.chassis, side ? 1 : -1);
        const wa = att.heading + drawn.swung;
        const fistOut = BOT_RADIUS + att.armLength * drawn.extend;
        const fx = att.x + Math.cos(wa) * fistOut;
        const fy = att.y + Math.sin(wa) * fistOut;
        for (const def of bodies) {
          if (def === att || !def.alive || def.team === att.team) continue;
          const lock = att.brain.lockLevel;
          const reach = FIST_RADIUS * (1 + LOCK_REACH * lock);
          const off = Math.hypot(def.x - fx, def.y - fy);
          if (off > reach) continue;
          // A fist through the middle of the torso is flush; one that grazes the edge
          // glances off. LC11 is target acquisition, so a locked bot lands clean.
          const flush = (0.72 + 0.28 * (1 - off / reach)) * (1 + LOCK_DAMAGE * lock);
          // Caught him mid-swing, hands down: that is a counter, and it pays extra.
          const counter = def.recovery > 0;
          // A hit is worth its kinetic energy, ½·m_arm·v². Tip speed is already in
          // this expression, so only the arm-mass half is applied here — scaling by the
          // whole energy ratio would count v twice.
          const armMass = att.phys.impactEnergy / att.phys.tipSpeed ** 2;
          const raw = (tipSpeed - tipBar) * STRIKE_DAMAGE * armMass * flush / Math.sqrt(n)
            * (counter ? COUNTER_BONUS : 1);
          const dmg = raw * (1 - def.guard * GUARD_BLOCK);
          if (def.guard > 0.45) def.blocked = true;
          if (counter) def.countered = true;
          def.hull -= dmg; def.damageThisTick += dmg; def.struck = true;
          // rock the defender: back along the swing, and sideways off-centre
          const rock = (1 - def.guard * 0.75) * HIT_LEAN * Math.min(1.6, tipSpeed / tipBar);
          def.leanV -= rock;
          def.tiltV += (((att.x * 7 + att.y * 13) % 2) - 0.5) * rock * 0.8;
          // knockback along the swing
          // knockback likewise: same fraction of the new speed scale
          const push = tipSpeed * 0.09 * (1 - def.guard * 0.8);
          def.vx += Math.cos(wa) * push;
          def.vy += Math.sin(wa) * push;
          hits.push({ attacker: att.spec.id, damage: +dmg.toFixed(2) });
          if (def.hull <= 0) { def.hull = 0; def.alive = false; def.vx = 0; def.vy = 0; def.omega = 0; }
          // a landed punch dumps its momentum
          if (side) att.armRv *= 0.25; else att.armLv *= 0.25;
        }
      }
    }

    // A swing that connected will have set struck on its target. If a bot committed
    // this tick and nothing registered, its own momentum takes it forward — the whiff
    // punish is physical rather than a rule.
    for (const b of bodies) {
      if (b.alive && b.swungAt === tick && !hits.some((h) => h.attacker === b.spec.id)) {
        b.leanV += WHIFF_LEAN;
      }
    }

    // contact, every pair. Teammates shove but never damage each other.
    for (let i = 0; i < bodies.length; i++) {
      for (let k = i + 1; k < bodies.length; k++) {
        const a = bodies[i]!, b = bodies[k]!;
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        if (d >= CLINCH_RANGE) continue;
        const nx = dx / d, ny = dy / d;
        // Soft break, applied *before* the torsos touch. Without it the pair simply
        // rests against the hard contact wall and punches from inside a hug; with it
        // the pocket stays open and a clinch resolves itself the way a referee's does.
        const sep = BREAK_PUSH * (CLINCH_RANGE - d) * DT;
        a.vx -= nx * sep; a.vy -= ny * sep;
        b.vx += nx * sep; b.vy += ny * sep;
        if (d >= BOT_RADIUS * 2) continue;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        // Bodies collide but do not wound: a shove is not a strike. Damage comes
        // from swung fists only, so closing the distance is setup, not offence.
        const overlap = BOT_RADIUS * 2 - d;
        a.x -= nx * (overlap * 0.5 + 0.01); a.y -= ny * (overlap * 0.5 + 0.01);
        b.x += nx * (overlap * 0.5 + 0.01); b.y += ny * (overlap * 0.5 + 0.01);
        if (closing > 0) {
          const an = a.vx * nx + a.vy * ny, bn = b.vx * nx + b.vy * ny;
          const rest = 0.75;
          a.vx += (bn - an) * nx * rest; a.vy += (bn - an) * ny * rest;
          b.vx += (an - bn) * nx * rest; b.vy += (an - bn) * ny * rest;
        }
      }
    }

    yield {
      tick, arenaHalf: +half.toFixed(3), teamSplit,
      bots: bodies.map((b, i) => toState(b, fired[i]!)), hits,
    };

    const aLeft = aliveOn(0), bLeft = aliveOn(1);
    if (aLeft === 0 || bLeft === 0) {
      const winner = aLeft === bLeft ? null : aLeft > 0 ? specA.id : specB.id;
      return { matchId: "", seed, winnerBotId: winner, survivors: [aLeft, bLeft],
               outcome: winner ? "KO" : "DRAW", ticks: tick };
    }
  }

  // timeout: most units standing wins, total hull fraction breaks the tie
  const frac = (team: 0 | 1) => {
    const t = bodies.filter((b) => b.team === team);
    return t.reduce((s, b) => s + b.hull / (CHASSIS_STATS[b.spec.chassis].hull * b.phys.hull), 0) / t.length;
  };
  const aLeft = aliveOn(0), bLeft = aliveOn(1);
  const fa = frac(0), fb = frac(1);
  const decided = aLeft !== bLeft ? (aLeft > bLeft ? specA.id : specB.id)
                : Math.abs(fa - fb) < 0.004 ? null : fa > fb ? specA.id : specB.id;
  return {
    matchId: "", seed, winnerBotId: decided, survivors: [aLeft, bLeft],
    outcome: decided ? "TIMEOUT_HULL" : "DRAW", ticks: tick,
  };
}
