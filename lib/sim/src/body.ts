import { BODY_BY_CHASSIS, type BodySpec, type Chassis } from "@workspace/contract";

/**
 * What a body can do, derived from what it is.
 *
 * The bench lets a player change four measurements: mass, reach, shoulder torque,
 * stance width. Everything the arena needs follows from those by mechanics that
 * are true outside this game, so the trade-offs are discovered rather than tuned.
 * Nothing in this file is a feel number; the feel numbers all live in arena.ts and
 * are scaled by the RATIOS computed here.
 *
 * The three that make the bench worth opening:
 *
 *   1. Reach fights power. The arm is a rod pivoting at the shoulder, so its
 *      inertia is I = m·L²/3. Angular acceleration is τ/I, and tip speed is ω·L:
 *
 *          v_tip = 3·τ·t / (m_arm · L)
 *
 *      The L² in the inertia beats the L in the moment arm. Lengthening the arm
 *      buys distance and costs fist speed, one for one. You cannot have both.
 *
 *   2. Mass fights acceleration. Leg force scales with muscle cross-section, which
 *      goes as M^(2/3), while the mass you must shift goes as M. So a = F/M ∝
 *      M^(-1/3): the square-cube law, which is also why big animals are slow.
 *
 *   3. Stance fights turning. A wide base tips over at a larger angle,
 *      θ = atan((s/2)/h), but puts the feet further from the yaw axis, raising
 *      rotational inertia. Stability and agility are the same parameter, opposed.
 */

/** Arm as a fraction of total mass. Human anthropometry: an arm is ~5.3% of you. */
const ARM_FRACTION = 0.053;
/** Seconds the shoulder torque is applied through a swing. */
const SWING_TIME = 0.085;
/** Height of the centre of mass above the feet, metres. */
const COM_HEIGHT = 0.62;
/** Shoulder-to-shoulder width, metres, the other axis of the yaw inertia. */
const BODY_WIDTH = 0.34;

export interface Mechanics {
  /** m/s at the fist at the end of a swing */
  tipSpeed: number;
  /** joules delivered by that fist, ½mv², what a hit is actually worth */
  impactEnergy: number;
  /** shoulder to fist, metres, straight through from the spec */
  reach: number;
  /** linear acceleration, arbitrary units, comparable between bodies */
  accel: number;
  /** yaw rate, same */
  turn: number;
  /** lean angle past which the body goes over, radians */
  knockdownAngle: number;
  /** how much body there is to damage */
  hull: number;
}

export function bodyMechanics(body: BodySpec): Mechanics {
  const armMass = ARM_FRACTION * body.mass;
  // uniform rod about one end
  const armInertia = (armMass * body.reach ** 2) / 3;
  const omega = (body.torque / armInertia) * SWING_TIME;
  const tipSpeed = omega * body.reach;

  // Yaw inertia of a box of mass M about its vertical axis.
  const yawInertia = (body.mass * (body.stance ** 2 + BODY_WIDTH ** 2)) / 12;

  return {
    tipSpeed,
    impactEnergy: 0.5 * armMass * tipSpeed ** 2,
    reach: body.reach,
    // F ∝ M^(2/3), a = F/M ∝ M^(-1/3)
    accel: Math.pow(body.mass, -1 / 3),
    // the legs put a roughly mass-proportional yaw torque into the floor
    turn: body.mass / yawInertia,
    knockdownAngle: Math.atan(body.stance / 2 / COM_HEIGHT),
    hull: body.mass,
  };
}

export type Ratios = Mechanics;

/** The body a bot actually has: its own, or the stock build for its chassis. */
export const resolveBody = (chassis: Chassis, body?: BodySpec): BodySpec =>
  body ?? BODY_BY_CHASSIS[chassis];

/**
 * Every mechanic as a multiple of what this chassis ships with.
 *
 * The arena multiplies its existing constants by these, which means an untuned bot
 * computes 1.0 across the board and fights EXACTLY as it did before the bench
 * existed. The balance table, the refractory sweep and the champion's fitness all
 * stay valid; only a player who actually moves a slider changes anything.
 */
export function bodyRatios(chassis: Chassis, body?: BodySpec): Ratios {
  const mine = bodyMechanics(resolveBody(chassis, body));
  const base = bodyMechanics(BODY_BY_CHASSIS[chassis]);
  return {
    tipSpeed: mine.tipSpeed / base.tipSpeed,
    impactEnergy: mine.impactEnergy / base.impactEnergy,
    reach: mine.reach / base.reach,
    accel: mine.accel / base.accel,
    turn: mine.turn / base.turn,
    knockdownAngle: mine.knockdownAngle / base.knockdownAngle,
    hull: mine.hull / base.hull,
  };
}
