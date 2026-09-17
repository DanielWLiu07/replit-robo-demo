import type { ArenaBotState, Chassis } from "@workspace/contract";
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

  // arms: driven straight off the punch angles the sim integrates, blended with the
  // two other things the arms are doing. Guard, recovery and the swing all share the
  // same two limbs: a held guard tucks the fists up and in, the recovery window after
  // a swing drops them, and neither survives the other, so a bot cannot block out of
  // a punch it is still recovering from. At guard 0 with no recovery this is exactly
  // the bare swing.
  const guard = state.guard, open = state.recovery > 0 ? 1 : 0;
  const tuck = guard * (1 - open);
  for (const side of [-1, 1] as const) {
    const ang = side < 0 ? state.armL : state.armR;
    const sho: [number, number, number] = [chest[0], chest[1], side * halfSho];
    // swing rotates the arm forward (−x is forward); elbow trails the shoulder
    const reach = upperArm + foreArm;
    const fist: [number, number, number] = [
      sho[0] - Math.cos(ang) * reach * (0.92 - tuck * 0.42),
      sho[1] - Math.sin(Math.abs(ang)) * 0.12 * s - 0.1 * s + tuck * 0.26 * s - open * 0.3 * s,
      side * (halfSho + 0.04 * s - tuck * 0.05 * s),
    ];
    const elbow = solveKnee(sho, fist, upperArm, foreArm, [0, -1, 0]);
    bones.push({ name: side < 0 ? "upperArmL" : "upperArmR", a: sho,   b: elbow, radius: 0.06 * s });
    bones.push({ name: side < 0 ? "foreArmL"  : "foreArmR",  a: elbow, b: fist,  radius: 0.05 * s });
    bones.push({ name: side < 0 ? "fistL" : "fistR",
                 a: fist, b: [fist[0] - 0.07 * s, fist[1], fist[2]], radius: 0.075 * s });
  }

  // wing spars, folded back — they read as a fly without needing to flap
  for (const side of [-1, 1] as const) {
    const root: [number, number, number] = [chest[0] + 0.04 * s, chest[1] + 0.08 * s, side * 0.07 * s];
    bones.push({ name: side < 0 ? "wingL" : "wingR",
                 a: root, b: [root[0] + 0.42 * s, root[1] + 0.12 * s, side * 0.3 * s], radius: 0.028 * s });
  }

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
