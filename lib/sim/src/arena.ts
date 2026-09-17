import {
  CHASSIS_STATS, MATCH_MAX_TICKS, MAX_SQUAD, SUDDEN_DEATH_TICK, TICK_HZ,
  type ArenaBotState, type BotSpec, type MatchFrame, type MatchResult, type NeuronModule,
} from "@workspace/contract";
import { Brain, type Senses } from "./brain.js";
import { makeRng } from "./rng.js";

export const ARENA_SIZE = 14;   // metres, square — tight enough to force engagement
export const ARENA_MIN_HALF = 2.6;
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
export const BOT_RADIUS = 0.6;
const DT = 1 / TICK_HZ;
// Spike trains are impulses; muscle tension is graded. A neuromuscular junction
// low-passes one into the other, and that filter is also what makes the plant
// stable — impulses straight into a double integrator can only oscillate.
const NMJ_SMOOTHING = 0.14;     // spike train -> graded drive
const DRIVE_GAIN = 5.0;         // ~20% spike duty -> ~full command
const MAX_SPEED = 4.2;          // m/s at full command, before chassis multiplier
const MAX_OMEGA = 3.4;          // rad/s at full command
const VEL_LAG = 0.16;           // how fast actual velocity chases commanded
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
const ARM_REST = 0.35;          // radians, arms held slightly forward
const ARM_SPRING = 5.5;         // pulls arms back toward guard
const STRIKE_MIN_TIP_SPEED = 3.2;   // m/s at the fist
const STRIKE_DAMAGE = 2.9;      // per m/s of tip speed over the threshold
const STRIKE_REACH = BOT_RADIUS + ARM_LENGTH;
/** How close the fist has to pass to the torso to count. Tight enough that footwork
 *  and a slip can take you off the end of a punch — with a generous hitbox nothing
 *  ever whiffed, and a counter-punch bonus with no whiffs to punish is decoration. */
const FIST_RADIUS = BOT_RADIUS * 1.18;
/** What an LC11 target lock is worth once the fight is in the pocket: a slightly
 *  longer effective reach and a cleaner hit. Acquisition used to buy nothing after
 *  the approach, which left an LC11 build winless in 18 matches. */
const LOCK_REACH = 0.15;
const LOCK_DAMAGE = 0.38;
const PUNCH_RANGE = STRIKE_REACH + 0.50;

// ── range discipline ────────────────────────────────────────────────────────
// A boxer does not walk into his opponent; he stands at the end of his own reach
// and throws from there. Torsos touch at 2*BOT_RADIUS = 1.20m, and before this the
// pair spent 61% of every match welded to exactly that wall, trading from inside a
// clinch — which reads as two bodies colliding, not as a fight. The pocket is the
// band where a fist lands but a torso does not.
const POCKET_FAR = 1.68;        // stop closing here: your fist already reaches
const POCKET_NEAR = 1.44;       // forward drive is gone entirely inside this
const CLINCH_RANGE = 1.38;      // soft break below this — boxers separate, they do not hug
const BREAK_PUSH = 26;          // m/s^2 of separation at full penetration

// ── footwork ────────────────────────────────────────────────────────────────
// Holding range is only half of it; standing still at range is not boxing either.
// An uncommitted bot slides sideways around the pocket while its heading stays on
// the target, so the fight circles instead of shuttling in and out on one axis.
const STRAFE_SPEED = 1.8;       // m/s of lateral slide, before the chassis turn stat
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
  punchCd: number; punchSide: 0 | 1;
  guard: number; recovery: number; blocked: boolean; guardHold: number;
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
  const foeTip = Math.max(Math.abs(foe.armLv), Math.abs(foe.armRv)) * ARM_LENGTH;
  const incoming = distance < PUNCH_RANGE * 1.2 && foeTip > STRIKE_MIN_TIP_SPEED * 0.55
    ? foeTip * 0.22 * (1 - 0.5 * distance / (PUNCH_RANGE * 1.2))
    : 0;
  const half = self.arenaHalf;
  const wallAhead = Math.min(
    half - Math.abs(self.x + Math.cos(self.heading) * 1.5),
    half - Math.abs(self.y + Math.sin(self.heading) * 1.5),
  );
  return {
    distance, bearing, angularSize,
    expansionRate: (angularSize - self.prevAngularSize) * TICK_HZ + incoming,
    hullFraction: self.hull / CHASSIS_STATS[self.spec.chassis].hull,
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
    countered: b.countered, stamina: +b.stamina.toFixed(3),
    arousal: +b.brain.arousalLevel.toFixed(3),
    gfFatigue: +b.brain.fatigueLevel.toFixed(3),
    armL: +b.armL.toFixed(3), armR: +b.armR.toFixed(3),
    armLv: +b.armLv.toFixed(3), armRv: +b.armRv.toFixed(3),
    gait: +b.gait.toFixed(3), struck: b.struck,
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
    const r = arenaHalfFor(n) * 0.74 + rng() * 1.2;
    // fan the squad out along an arc so they do not spawn stacked
    const spread = n === 1 ? 0 : (idx / (n - 1) - 0.5) * 0.9;
    const a = angle + spread;
    return {
      spec: n === 1 ? spec : { ...spec, id: `${spec.id}#${idx}` },
      team, alive: true,
      brain: new Brain(spec.brain, rng),
      x: Math.cos(a) * r, y: Math.sin(a) * r,
      heading: a + Math.PI + (rng() - 0.5) * 0.5,
      vx: 0, vy: 0, omega: 0,
      driveFwd: 0, driveTurn: 0,
      armL: ARM_REST, armR: -ARM_REST, armLv: 0, armRv: 0, gait: rng(), struck: false,
      punchCd: 0, punchSide: 0, guard: 0, recovery: 0, blocked: false, guardHold: 0,
      countered: false, stamina: 1, gassed: false, comboLeft: 0,
      circleDir: rng() < 0.5 ? -1 : 1, circleTimer: CIRCLE_MIN + Math.floor(rng() * CIRCLE_SPAN),
      hull: CHASSIS_STATS[spec.chassis].hull,
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

      const stats = CHASSIS_STATS[body.spec.chassis];

      // The Giant Fiber means two different things at two distances. Far away it is an
      // escape: reverse hard and turn out. At punching range the same spike is a block,
      // and a boxer who backs out of every jab never fights — so in range the flight
      // half is damped to a slip and only the hands (the guard, below) answer. Done to
      // the intent rather than in the brain because it is the *body* that knows how far
      // away the other one is; the cell fires the same either way.
      const closeQuarters = s.distance < PUNCH_RANGE * 1.25;
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
      const standoff = body.gassed ? POCKET_FAR + 0.9
        : body.guard > 0.45 ? POCKET_FAR + 0.3 : POCKET_FAR;
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
      if (foeDist < POCKET_FAR + 1.6) {
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

      body.vx += (Math.cos(body.heading) * wantSpeed + lx * strafe - body.vx) * VEL_LAG;
      body.vy += (Math.sin(body.heading) * wantSpeed + ly * strafe - body.vy) * VEL_LAG;
      body.omega += (wantOmega - body.omega) * OMEGA_LAG;

      // Arms. A punch is an EVENT, not an oscillation: when the brain is driving
      // forward and a target is inside reach, dump a single large impulse into the
      // alternating arm and let momentum carry the fist through. Tying the swing to
      // the gait phase failed — at speed the gait cycles every five ticks, so the
      // torque reversed before the arm could build any tip speed at all.
      if (body.punchCd > 0) body.punchCd--;
      if (body.recovery > 0) body.recovery--;

      // Stamina regen. Holding a guard or standing off the pocket is how you breathe;
      // a bot that never stops throwing never refills.
      body.stamina = Math.min(1, body.stamina + REGEN_BASE
        + (body.guard > 0.45 ? REGEN_GUARD : 0)
        + (foeDist > POCKET_FAR ? REGEN_RANGE : 0));
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
      const wantsToHit = pursuitFired && !backingOff && foeDist < PUNCH_RANGE && aimed
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
        const power = PUNCH_IMPULSE * gas * (0.75 + 0.25 * Math.min(1, body.brain.arousalLevel - 0.4));
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
      body.gait = (body.gait + (0.02 + Math.hypot(body.vx, body.vy) * 0.055)) % 1;
    });

    // move
    for (const body of bodies) {
      if (!body.alive) continue;
      body.x += body.vx * DT; body.y += body.vy * DT; body.heading += body.omega * DT;
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
        const tipSpeed = av * ARM_LENGTH;
        if (tipSpeed < STRIKE_MIN_TIP_SPEED) continue;
        const wa = att.heading + ang;
        const fx = att.x + Math.cos(wa) * STRIKE_REACH;
        const fy = att.y + Math.sin(wa) * STRIKE_REACH;
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
          const raw = (tipSpeed - STRIKE_MIN_TIP_SPEED) * STRIKE_DAMAGE * flush / Math.sqrt(n)
            * (counter ? COUNTER_BONUS : 1);
          const dmg = raw * (1 - def.guard * GUARD_BLOCK);
          if (def.guard > 0.45) def.blocked = true;
          if (counter) def.countered = true;
          def.hull -= dmg; def.damageThisTick += dmg; def.struck = true;
          // knockback along the swing
          const push = tipSpeed * 0.22 * (1 - def.guard * 0.8);
          def.vx += Math.cos(wa) * push;
          def.vy += Math.sin(wa) * push;
          hits.push({ attacker: att.spec.id, damage: +dmg.toFixed(2) });
          if (def.hull <= 0) { def.hull = 0; def.alive = false; def.vx = 0; def.vy = 0; def.omega = 0; }
          // a landed punch dumps its momentum
          if (side) att.armRv *= 0.25; else att.armLv *= 0.25;
        }
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
    return t.reduce((s, b) => s + b.hull / CHASSIS_STATS[b.spec.chassis].hull, 0) / t.length;
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
