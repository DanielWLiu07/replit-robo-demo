import type { ArenaBotState, Chassis } from "@workspace/contract";
import { ARM_REST, KNOCKDOWN_TICKS } from "@workspace/contract";

import { CHASSIS_STATS } from "@workspace/contract";

/**
 * Bipedal fly rig.
 *
 * A text-to-3D mesh has no skeleton, so it cannot ragdoll. This defines the bones
 * explicitly and poses them from simulation state: arms follow the punch angles the
 * sim integrates, legs are solved with two-bone IK against a gait cycle so the feet
 * actually plant instead of sliding. The renderer just draws the segments.
 *
 * Render space is Y-up. The sim's (x, y) ground plane maps to (x, z).
 */

export interface Bone {
  name: string;
  /** start point, render space, relative to the bot's origin on the ground */
  a: [number, number, number];
  /** end point */
  b: [number, number, number];
  /** drawn thickness, metres */
  radius: number;
}

export interface Pose {
  bones: Bone[];
  /** world position + facing, for placing the rig */
  origin: [number, number, number];
  headingY: number;
  /** 0..1, how far through a stagger from being hit — drives a ragdoll lean */
  stagger: number;
}

const SCALE: Record<Chassis, number> = { DRONE: 0.86, HORNET: 1.0, TANK: 1.24 };

/** Two-bone IK in a plane. Returns the joint position between root and target. */
function solveKnee(
  root: [number, number, number], target: [number, number, number],
  l1: number, l2: number, bendDir: [number, number, number],
): [number, number, number] {
  const dx = target[0] - root[0], dy = target[1] - root[1], dz = target[2] - root[2];
  const d = Math.max(1e-4, Math.hypot(dx, dy, dz));
  const reach = Math.min(d, l1 + l2 - 1e-3);
  // cosine rule for how far along the line the joint projects
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d, uz = dz / d;

  /**
   * The bend offset must be PERPENDICULAR to the root->target line.
   *
   * `bendDir` arrives as a fixed hint ([0,-1,0] for an elbow, [1,0,0] for a knee)
   * and was used raw. Whenever the limb happened to point along that hint the
   * "perpendicular" offset ran ALONG the limb instead of across it, so the joint
   * slid up the bone and both segment lengths broke — a guard, with the hand at
   * chin height close to the shoulder, points an arm almost straight down the hint.
   * Measured over a real fight: the forearm ranged 0.085-0.302 against a fixed
   * 0.249, wrong in 98% of frames. Rubber arms.
   *
   * Gram-Schmidt against the limb keeps the hint's SIDE while guaranteeing the
   * offset is square to the bone, which is what makes |root-joint| come out as l1.
   */
  const dot = bendDir[0] * ux + bendDir[1] * uy + bendDir[2] * uz;
  let bx = bendDir[0] - ux * dot, by = bendDir[1] - uy * dot, bz = bendDir[2] - uz * dot;
  let bl = Math.hypot(bx, by, bz);
  if (bl < 1e-6) {
    // hint is parallel to the limb and carries no side information; any
    // perpendicular will do, so take one from the smallest axis of the limb.
    const ax: [number, number, number] = Math.abs(ux) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    bx = ax[1] * uz - ax[2] * uy;
    by = ax[2] * ux - ax[0] * uz;
    bz = ax[0] * uy - ax[1] * ux;
    bl = Math.hypot(bx, by, bz) || 1;
  }
  bx /= bl; by /= bl; bz /= bl;

  return [
    root[0] + ux * a + bx * h,
    root[1] + uy * a + by * h,
    root[2] + uz * a + bz * h,
  ];
}

/**
 * Build the full skeleton for one bot on one tick. Pure function of state, so it is
 * as deterministic as the simulation and safe to call per frame.
 */
/**
 * Half the distance a foot swings, in metres, at this speed.
 *
 * The ONE definition: the arena reads it to advance the gait phase and the pose
 * reads it to place the foot. Split them and the feet skate.
 */
export const strideFor = (speed: number, chassis: Chassis): number =>
  Math.min(0.42, 0.12 + speed * 0.09) * SCALE[chassis];

/**
 * How far from directly under the hip a foot may be placed, horizontally, in metres.
 *
 * The leg is a two-bar linkage of fixed length standing at a fixed hip height, so
 * this is just Pythagoras — and it is a HARD limit, not a preference. Ignoring it is
 * what let the arena plant feet up to 5.2 m from a 0.52 m leg: the knee solver then
 * has no valid answer, the limb straightens and stretches, and the whole figure
 * distorts. The safety factor keeps the knee bent rather than locked straight, which
 * is both what a leg does and what gives the solver something to work with.
 */
/** Shoulder-to-fist of the arm as DRAWN, metres. The arena resolves strikes with
 *  this so the hit box is the hand on screen, not a longer notional one. */
export const armReach = (chassis: Chassis): number => 0.55 * SCALE[chassis];

export const footReach = (chassis: Chassis): number => {
  const s = SCALE[chassis];
  const leg = 0.6 * s, hip = 0.52 * s;
  return Math.sqrt(Math.max(0, leg * leg - hip * hip)) * 0.82;
};


/** What the arm state the fist geometry needs — a subset of ArenaBotState. */
export interface ArmState {
  armL: number; armR: number; guard: number; recovery: number; gait: number;
  vx: number; vy: number;
}

/**
 * Where a fist actually IS, relative to the body, in metres: [x, y, z] with
 * forward on −x and the sides on ±z.
 *
 * ONE definition, called by the pose that DRAWS the arm and by the strike test that
 * RESOLVES it. They used to compute it separately and disagree badly: the arena put
 * every fist at full extension (BOT_RADIUS + arm length) whenever a punch was live,
 * while the rig drew it anywhere from 42% to 100% of the arm, swinging with the
 * gait. So a punch could land with the visible arm still tucked in the guard, or
 * sweep straight through a body and do nothing. Sharing the function is the only
 * way the hit and the picture stay the same event.
 */
export function fistLocal(state: ArmState, chassis: Chassis, side: -1 | 1) {
  const s = SCALE[chassis];
  const hipH = 0.52 * s;
  const shoulderH = hipH + 0.34 * s;
  const halfSho = 0.17 * s;
  const upperArm = 0.26 * s, foreArm = 0.29 * s;

  const phase = state.gait * Math.PI * 2;
  const sway = Math.sin(phase), bounce = Math.cos(phase * 2);
  const bob = Math.abs(Math.sin(phase)) * 0.04 * s;
  const lean = Math.min(0.28, Math.hypot(state.vx, state.vy) * 0.05);

  const sho: [number, number, number] = [
    -Math.sin(lean) * 0.18 * s,
    shoulderH + bob + bounce * 0.014 * s,
    -sway * 0.03 * s + side * halfSho,
  ];
  const ang = side < 0 ? state.armL : state.armR;
  const reach = upperArm + foreArm;

  /**
   * How far through a swing this arm is: 0 at the guard, 1 fully committed.
   * Read off the ANGLE, which integrates smoothly, not the rate, which steps the
   * instant the impulse lands and teleported the fist ~0.3 m in one frame.
   */
  const excursion = Math.min(1, Math.abs(ang - (side < 0 ? ARM_REST : -ARM_REST)) / 1.15);
  const thrown = excursion;
  const open = Math.max(excursion, Math.min(1, state.recovery / 12));
  const tuck = state.guard * (1 - open);

  /**
   * THE GUARD, and the punch as a departure from it.
   *
   * The hands used to be placed by swinging a fixed 42%-extended arm around the
   * shoulder, which put the fists 0.16·s BELOW the shoulders and out in front —
   * arms held out, not a boxer. A guard is hands at chin height, tucked in near the
   * cheeks, inside the line of the shoulders, elbows down.
   *
   * So the rest pose is authored where a guard actually sits, and a punch
   * INTERPOLATES from it out to full extension along the swing. `extend` is then
   * measured back off the result rather than assumed, which matters because the
   * arena resolves strikes with this same number.
   */
  const guardPos: [number, number, number] = [
    -0.11 * s,                                   // just in front of the face
    shoulderH + 0.07 * s - open * 0.30 * s,      // chin height; drops when caught open
    side * 0.11 * s,                             // by the cheek, inside the shoulders
  ];
  // a small breath so the guard is alive — NOT a swing. At 0.34 rad this was as big
  // as a punch (measured: 0.518 m of idle sway against 0.516 m of punch travel), so
  // every strike disappeared into the noise.
  const idleSwing = sway * 0.07 * side * (1 - excursion);
  const swung = ang + idleSwing;
  const committed: [number, number, number] = [
    sho[0] - Math.cos(swung) * reach,
    sho[1] - 0.02 * s + bounce * 0.02 * s * (1 - excursion),
    sho[2] + Math.sin(swung) * reach,
  ];
  const k = thrown;
  const fist: [number, number, number] = [
    guardPos[0] + (committed[0] - guardPos[0]) * k,
    guardPos[1] + (committed[1] - guardPos[1]) * k,
    guardPos[2] + (committed[2] - guardPos[2]) * k,
  ];
  // measured, not assumed — the arena's hit test reads this
  const extend = Math.min(1, Math.hypot(
    fist[0] - sho[0], fist[1] - sho[1], fist[2] - sho[2]) / reach);

  return { sho, fist, swung, thrown, open, tuck, extend, upperArm, foreArm };
}

export function poseBot(state: ArenaBotState, chassis: Chassis): Pose {
  const s = SCALE[chassis];
  const hipH = 0.52 * s;          // hip height off the ground
  const thigh = 0.3 * s, shin = 0.3 * s;
  const upperArm = 0.26 * s, foreArm = 0.29 * s;
  const shoulderH = hipH + 0.34 * s;
  const halfHip = 0.12 * s, halfSho = 0.17 * s;

  const speed = Math.hypot(state.vx, state.vy);
  const stride = strideFor(speed, chassis);
  const phase = state.gait * Math.PI * 2;
  // vertical bob and a lean into the run
  const bob = Math.abs(Math.sin(phase)) * 0.04 * s;
  const lean = Math.min(0.28, speed * 0.05);
  const stagger = state.struck ? 1 : 0;

  const bones: Bone[] = [];
  const P = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

  /**
   * SECONDARY MOTION — the goose rig's waddle, at a boxer's amplitude.
   *
   * Everything above the waist used to be rigid: unless a punch was in flight the
   * arms sat in the guard and the torso did not move at all, so between exchanges
   * the figure read as a statue sliding around the ring. Measured, the arm verts
   * moved 0.027 of a body height over two thirds of a second — about five pixels.
   *
   * These are the terms the goose uses, driven by the same gait phase the legs
   * already run on: the hips sway, the chest counter-rotates against them, and the
   * head holds near level — the reflex that keeps a walking bird's eyes steady.
   * `z` is the lateral axis in this frame (the sides sit at ±halfHip / ±halfSho).
   */
  const sway = Math.sin(phase);
  const bounce = Math.cos(phase * 2);      // twice a stride, one per footfall

  // torso, tilted forward by lean, swaying and bouncing with the stride
  const pelvis = P(0, hipH + bob, sway * 0.05 * s);
  const chest  = P(-Math.sin(lean) * 0.18 * s,
                   shoulderH + bob + bounce * 0.014 * s,
                   -sway * 0.03 * s);
  const head   = P(-Math.sin(lean) * 0.3 * s,
                   shoulderH + 0.2 * s + bob,
                   sway * 0.012 * s);
  bones.push({ name: "spine", a: pelvis, b: chest, radius: 0.13 * s });
  bones.push({ name: "neck",  a: chest,  b: head,  radius: 0.055 * s });
  bones.push({ name: "head",  a: head,   b: P(head[0] - 0.1 * s, head[1] + 0.02 * s, 0), radius: 0.13 * s });

  /**
   * LEGS — the foot goes where the SIMULATION planted it.
   *
   * This used to place each foot in body-local space at cos(phase)·stride, which
   * cannot produce a planted foot at any gait rate: the foot is re-derived from the
   * body's own frame every tick, so it travels with the body and merely oscillates
   * about it. Matching the phase rate to ground speed made that right on average
   * over a half cycle while the foot still swept back and forth inside it — the
   * "gliding" look, and no amount of retiming fixes it.
   *
   * `state.feet` carries a world coordinate per foot that the arena HOLDS FIXED for
   * the whole stance. Rotating it into the body frame and solving the knee to reach
   * it means the leg is chasing a point nailed to the ground: the body travels over
   * a stationary foot, which is what walking is.
   *
   * poseBot's frame has forward on −x and the sides on ±z, hence the mapping below.
   */
  const cosH = Math.cos(state.heading), sinH = Math.sin(state.heading);
  const planted = state.feet && state.feet.length === 6;
  for (const side of [-1, 1] as const) {
    const ph = phase + (side < 0 ? Math.PI : 0);
    const footZ = side * halfHip;
    let foot: [number, number, number];
    if (planted) {
      // world -> body: project the offset onto the heading and its perpendicular
      const o = side < 0 ? 0 : 3;
      const dx = state.feet[o]! - state.x, dy = state.feet[o + 1]! - state.y;
      const ahead = dx * cosH + dy * sinH;      // metres in front of the hips
      const across = -dx * sinH + dy * cosH;    // metres to the left
      foot = [-ahead, state.feet[o + 2]!, across];
    } else {
      // no planted feet in this state (a synthetic pose): fall back to the cycle
      foot = [Math.cos(ph) * stride, Math.max(0, Math.sin(ph)) * 0.16 * s, footZ];
    }
    const hip: [number, number, number] = [pelvis[0], hipH + bob, pelvis[2] + footZ];
    const knee = solveKnee(hip, foot, thigh, shin, [1, 0, 0]);  // knees bend forward

    /**
     * ANKLE — heel strike, roll flat, toe off, and lift the toe clear on the swing.
     *
     * The toe used to sit at a FIXED offset from the ankle, so the foot never
     * rotated relative to the shin at all: measured 0.039 rad of ankle motion over a
     * walk cycle against the goose clip's 0.80. That is a rigid block on the end of
     * the leg, and it is most of why the walk read wrong even once the feet stopped
     * sliding.
     *
     * Where we are through the stance comes from the foot's own position rather than
     * from a phase constant: it lands AHEAD of the hip and leaves BEHIND it, so the
     * signed distance already encodes the progress, and the two cannot disagree.
     */
    const rollSpan = footReach(chassis);
    const ahead = -foot[0];                    // forward is −x in this frame
    const through = Math.max(0, Math.min(1, 0.5 - ahead / (2 * rollSpan)));
    const toePitch = foot[1] > 1e-6
      ? 0.5                                     // dorsiflexed, clearing the ground
      : 0.3 * Math.cos(through * Math.PI);      // +heel down … flat … toe down−
    const toeLen = 0.12 * s;

    bones.push({ name: side < 0 ? "thighL" : "thighR", a: hip,  b: knee, radius: 0.07 * s });
    bones.push({ name: side < 0 ? "shinL"  : "shinR",  a: knee, b: foot, radius: 0.055 * s });
    bones.push({ name: side < 0 ? "footL"  : "footR",
                 a: foot,
                 b: [foot[0] - Math.cos(toePitch) * toeLen,
                     foot[1] + Math.sin(toePitch) * toeLen,
                     foot[2]],
                 radius: 0.045 * s });
  }

  // arms: the sim runs each arm as an angular body swinging about the vertical axis.
  // `armL`/`armR` are that swing angle — they rest at ±ARM_REST and a punch adds a
  // large angular impulse — and `armLv`/`armRv` are the rate, which is what the strike
  // test actually reads. So the angle steers the arm and the SPEED extends it: a fist
  // at rest stays tucked into a guard, a committed swing snaps out to full reach.
  //
  // Taking reach from cos(angle) instead, as this did, never went negative over the
  // real range (−0.94 to 0.63 rad), so both arms sat permanently extended and a punch
  // became a 40% stretch with no sweep — which is why the boxing did not read.
  for (const side of [-1, 1] as const) {
    // Geometry comes from fistLocal, which the ARENA also calls to resolve strikes,
    // so the arm you see and the arm that hits are the same arm.
    const { sho, fist, swung, thrown } = fistLocal(state, chassis, side);
    const elbow = solveKnee(sho, fist, upperArm, foreArm, [0, -1, 0]);
    bones.push({ name: side < 0 ? "upperArmL" : "upperArmR", a: sho,   b: elbow, radius: 0.06 * s });
    bones.push({ name: side < 0 ? "foreArmL"  : "foreArmR",  a: elbow, b: fist,  radius: 0.05 * s });
    bones.push({ name: side < 0 ? "fistL" : "fistR", a: fist,
                 b: [fist[0] - Math.cos(swung) * 0.07 * s, fist[1], fist[2] + Math.sin(swung) * 0.07 * s],
                 radius: 0.075 * s });
  }

  // wing spars, folded back — they read as a fly without needing to flap
  for (const side of [-1, 1] as const) {
    const root: [number, number, number] = [chest[0] + 0.04 * s, chest[1] + 0.08 * s,
                                            chest[2] + side * 0.07 * s];
    // a small flutter, twice a stride, so the wings are not welded to the back
    const flutter = bounce * 0.05 * s * side;
    bones.push({ name: side < 0 ? "wingL" : "wingR",
                 a: root,
                 b: [root[0] + 0.42 * s, root[1] + 0.12 * s + Math.abs(flutter),
                     chest[2] + side * 0.3 * s + flutter],
                 radius: 0.028 * s });
  }


  // ── RAGDOLL ────────────────────────────────────────────────────────────────
  // The simulation has been running a ragdoll the whole time: `lean` is the torso
  // pitching over the feet, `tilt` is roll, and `down` counts the ticks left on the
  // floor after a knockdown. None of it reached the rig — the pose above derives its
  // own lean from speed and ignored the three fields the arena streams every frame,
  // so a bot that had been knocked flat still walked around bolt upright.
  //
  // A body tipping over rotates about the FEET, not about its middle, so this is a
  // rigid rotation of the whole pose about the ground pivot. That is also what keeps
  // it honest: the head describes the arc it would really travel, and the body drops
  // as it goes over instead of sinking straight down through the surface.
  const downT = state.down > 0 ? state.down / KNOCKDOWN_TICKS : 0;
  // Over about ten ticks, lie there, then come back up over the last dozen. The sim
  // freezes `lean` at the tipping angle while you are down, so the rest of the fall
  // is rendered here rather than integrated there.
  // Over about sixteen ticks, not ten. Ten put the body through 1.45 rad in 0.17 s
  // — 8.7 rad/s, where a real body toppling about its feet comes down nearer 3.8 —
  // and the fists covered enough ground per frame to read as a snap rather than a
  // fall. The tail is unchanged, so getting up still takes the last dozen ticks.
  const fall = state.down > 0 ? Math.min(1, (1 - downT) * 3.2, downT * 4) : 0;
  const FLOOR_PITCH = 1.45;   // radians — flat out, head a little off the deck
  const sign = state.lean >= 0 ? 1 : -1;
  const pitch = lean + state.lean + fall * (sign * FLOOR_PITCH - state.lean);
  const roll = state.tilt * (1 - fall * 0.5);

  if (pitch !== 0 || roll !== 0) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll),  sr = Math.sin(roll);
    const turn = (v: [number, number, number]): [number, number, number] => {
      // pitch about +z (forward is −x, so a positive angle tips the body forward)
      const x = v[0] * cp - v[1] * sp;
      const y = v[0] * sp + v[1] * cp;
      // then roll about the forward axis
      return [x, y * cr - v[2] * sr, y * sr + v[2] * cr];
    };
    for (const b of bones) { b.a = turn(b.a); b.b = turn(b.b); }
  }

  // Nothing may end up under the floor. Lifting the whole pose keeps the limbs
  // rigid — clamping each joint on its own would stretch the body instead.
  let floor = Infinity;
  for (const b of bones) floor = Math.min(floor, b.a[1] - b.radius, b.b[1] - b.radius);
  if (floor < 0) for (const b of bones) { b.a[1] -= floor; b.b[1] -= floor; }

  return {
    bones,
    origin: [state.x, 0, state.y],
    headingY: -state.heading,   // sim yaw -> render Y rotation
    stagger,
  };
}

/** Rough standing height, for camera framing. */
export const rigHeight = (chassis: Chassis) => 1.06 * SCALE[chassis];
/** Hull as a 0..1 fraction, for health bars over the rig. */
export const hullFraction = (s: ArenaBotState, chassis: Chassis) =>
  Math.max(0, s.hull / CHASSIS_STATS[chassis].hull);
