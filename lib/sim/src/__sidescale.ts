/**
 * How badly does posing a fighter at the OTHER team's scale break its legs?
 *
 * The ring used to build and pose BOTH sides from player one's chassis, while the
 * simulation plants feet in world space at each bot's OWN `footReach`. So side two's
 * footfalls - spaced for its own legs - were handed to a rig built at side one's
 * scale. This runs real matches and, for side two's lead, poses the identical state
 * twice: once at its own class, once at side one's.
 *
 * The number that matters is hip-to-foot over leg length. Above 1.0 there is no
 * valid knee: `solveKnee` clamps to the max-reach line, the leg locks dead straight,
 * and the shin is then drawn from that clamped knee to a foot it cannot touch. The
 * figure lurches and skates - what read on screen as "moving backwards".
 */
import { runMatch } from "./arena.js";
import { poseBot } from "./rig.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
import type { Chassis, BotSpec } from "@workspace/contract";

const SCALE: Record<Chassis, number> = { DRONE: 0.86, HORNET: 1.0, TANK: 1.24 };
const at = (p: ReturnType<typeof poseBot>, n: string) => p.bones.find((b) => b.name === n)!;
const len = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** hip->foot as a fraction of the leg that has to span it */
const strain = (pose: ReturnType<typeof poseBot>, side: "L" | "R", chassis: Chassis) => {
  const thigh = at(pose, `thigh${side}`), shin = at(pose, `shin${side}`);
  return len(thigh.a, shin.b) / (0.6 * SCALE[chassis]);
};

const pairs: [Chassis, Chassis][] = [
  ["DRONE", "HORNET"],  // the stock matchup out of the box: GHOST vs the hornet entry
  ["DRONE", "TANK"],    // worst case, 1.44x
  ["TANK", "DRONE"],    // and the other way: short strides in a big body
  ["HORNET", "HORNET"], // control - same class, the two paths must agree exactly
  ["DRONE", "DRONE"],   // baselines: what a correctly-posed leg does on its own
  ["TANK", "TANK"],
];

for (const [a, b] of pairs) {
  const p1: BotSpec = { ...DEFAULT_BOTS[0]!, chassis: a };
  const p2: BotSpec = { ...DEFAULT_BOTS[1]!, chassis: b };
  const frames = [...runMatch("s7", p1, p2)].filter((f: any) => "bots" in f) as any[];

  let wOld = 0, wNew = 0, sOld = 0, sNew = 0, overOld = 0, overNew = 0, swing = 0, n = 0;
  for (const f of frames) {
    const unit = f.bots[f.teamSplit];
    if (!unit || unit.hull <= 0) continue;
    const wrong = poseBot(unit, a);   // side one's class - what shipped
    const right = poseBot(unit, b);   // its own class - the fix
    for (const [k, side] of (["L", "R"] as const).entries()) {
      // NOTE: measured against the leg of the class the RIG was built from, which
      // is the leg that actually has to reach.
      const o = strain(wrong, side, a), r = strain(right, side, b);
      wOld = Math.max(wOld, o); wNew = Math.max(wNew, r);
      sOld += o; sNew += r; if (o > 1) overOld++; if (r > 1) { overNew++; if (unit.feet[k * 3 + 2] > 1e-6) swing++; } n++;
    }
  }
  const pct = (k: number) => `${((k / n) * 100).toFixed(1).padStart(5)}%`;
  console.log(
    `${`${a} vs ${b}`.padEnd(16)} ${String(frames.length).padStart(4)} frames | ` +
    `BEFORE mean ${(sOld / n).toFixed(3)} worst ${wOld.toFixed(3)} overstretched ${pct(overOld)} | ` +
    `AFTER  mean ${(sNew / n).toFixed(3)} worst ${wNew.toFixed(3)} overstretched ${pct(overNew)}` +
    ` (${overNew ? Math.round((swing / overNew) * 100) : 0}% of those mid-SWING)`,
  );
}
