import type { ArenaBotState, Chassis } from "@workspace/contract";
import { KNOCKDOWN_TICKS } from "./arena.js";
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
  return [
    root[0] + ux * a + bendDir[0] * h,
    root[1] + uy * a + bendDir[1] * h,
    root[2] + uz * a + bendDir[2] * h,
  ];
}

/**
 * Build the full skeleton for one bot on one tick. Pure function of state, so it is
 * as deterministic as the simulation and safe to call per frame.
 */
export function poseBot(state: ArenaBotState, chassis: Chassis): Pose {
  const s = SCALE[chassis];
  const hipH = 0.52 * s;          // hip height off the ground
  const thigh = 0.3 * s, shin = 0.3 * s;
  const upperArm = 0.26 * s, foreArm = 0.29 * s;
  const shoulderH = hipH + 0.34 * s;
  const halfHip = 0.12 * s, halfSho = 0.17 * s;

  const speed = Math.hypot(state.vx, state.vy);
  const stride = Math.min(0.42, 0.12 + speed * 0.09) * s;
  const phase = state.gait * Math.PI * 2;
  // vertical bob and a lean into the run
  const bob = Math.abs(Math.sin(phase)) * 0.04 * s;
  const lean = Math.min(0.28, speed * 0.05);
  const stagger = state.struck ? 1 : 0;

  const bones: Bone[] = [];
  const P = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

  // torso, tilted forward by lean
  const pelvis = P(0, hipH + bob, 0);
  const chest  = P(-Math.sin(lean) * 0.18 * s, shoulderH + bob, 0);
  const head   = P(-Math.sin(lean) * 0.3 * s, shoulderH + 0.2 * s + bob, 0);
  bones.push({ name: "spine", a: pelvis, b: chest, radius: 0.13 * s });
  bones.push({ name: "neck",  a: chest,  b: head,  radius: 0.055 * s });
  bones.push({ name: "head",  a: head,   b: P(head[0] - 0.1 * s, head[1] + 0.02 * s, 0), radius: 0.13 * s });

  // legs: feet cycle fore/aft on the gait, knees solved by IK
  for (const side of [-1, 1] as const) {
    const ph = phase + (side < 0 ? Math.PI : 0);
    const footZ = side * halfHip;
    const footX = Math.cos(ph) * stride;
    const lift = Math.max(0, Math.sin(ph)) * 0.16 * s;   // swing phase lifts the foot
    const hip: [number, number, number] = [0, hipH + bob, footZ];
    const foot: [number, number, number] = [footX, lift, footZ];
    const knee = solveKnee(hip, foot, thigh, shin, [1, 0, 0]);  // knees bend forward
    bones.push({ name: side < 0 ? "thighL" : "thighR", a: hip,  b: knee, radius: 0.07 * s });
    bones.push({ name: side < 0 ? "shinL"  : "shinR",  a: knee, b: foot, radius: 0.055 * s });
    bones.push({ name: side < 0 ? "footL"  : "footR",
                 a: foot, b: [foot[0] + 0.12 * s, foot[1], footZ], radius: 0.045 * s });
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
  const guard = state.guard, open = state.recovery > 0 ? 1 : 0;
  const tuck = guard * (1 - open);
  for (const side of [-1, 1] as const) {
    const ang = side < 0 ? state.armL : state.armR;
    const rate = Math.abs(side < 0 ? state.armLv : state.armRv);
    const sho: [number, number, number] = [chest[0], chest[1], side * halfSho];
    const reach = upperArm + foreArm;
    // forward is −x and the swing rotates about y, so the fist rides (−cos, ·, sin)
    const thrown = Math.min(1, rate / 8);       // 8 rad/s reads as committed
    const extend = (0.42 + 0.58 * thrown) * (1 - tuck * 0.18);
    const fist: [number, number, number] = [
      sho[0] - Math.cos(ang) * reach * extend,
      sho[1] - 0.06 * s - (1 - thrown) * 0.1 * s + tuck * 0.2 * s - open * 0.26 * s,
      sho[2] + Math.sin(ang) * reach * extend,
    ];
    const elbow = solveKnee(sho, fist, upperArm, foreArm, [0, -1, 0]);
    bones.push({ name: side < 0 ? "upperArmL" : "upperArmR", a: sho,   b: elbow, radius: 0.06 * s });
    bones.push({ name: side < 0 ? "foreArmL"  : "foreArmR",  a: elbow, b: fist,  radius: 0.05 * s });
    bones.push({ name: side < 0 ? "fistL" : "fistR", a: fist,
                 b: [fist[0] - Math.cos(ang) * 0.07 * s, fist[1], fist[2] + Math.sin(ang) * 0.07 * s],
                 radius: 0.075 * s });
  }

  // wing spars, folded back — they read as a fly without needing to flap
  for (const side of [-1, 1] as const) {
    const root: [number, number, number] = [chest[0] + 0.04 * s, chest[1] + 0.08 * s, side * 0.07 * s];
    bones.push({ name: side < 0 ? "wingL" : "wingR",
                 a: root, b: [root[0] + 0.42 * s, root[1] + 0.12 * s, side * 0.3 * s], radius: 0.028 * s });
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
  const fall = state.down > 0 ? Math.min(1, (1 - downT) * 5, downT * 4) : 0;
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
