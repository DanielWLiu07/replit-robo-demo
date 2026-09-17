import { runMatch, poseBot, KNOCKDOWN_TICKS } from "./index.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";

const [a, b] = DEFAULT_BOTS;
const bone = (p: any, n: string) => p.bones.find((x: any) => x.name === n)!;
const d3 = (u: number[], v: number[]) => Math.hypot(u[0]-v[0], u[1]-v[1], u[2]-v[2]);

type Acc = {
  fistReach: number[]; fistSpeed: number[]; armSwing: number[];
  lean: number[]; tilt: number[]; headY: number[]; footLift: number[];
  knockdowns: number; downTicks: number; turned: number; travelled: number;
};
const mk = (): Acc => ({ fistReach: [], fistSpeed: [], armSwing: [], lean: [], tilt: [],
  headY: [], footLift: [], knockdowns: 0, downTicks: 0, turned: 0, travelled: 0 });

const acc = [mk(), mk()];
let hits = 0, frames = 0;
const prev: any[] = [null, null];

for (let seed = 0; seed < 6; seed++) {
  const g = runMatch(`rig-${seed}`, a, b);
  let r = g.next();
  while (!r.done) {
    const f: any = r.value;
    hits += f.hits?.length ?? 0;
    frames++;
    f.bots.forEach((u: any, i: number) => {
      if (i > 1) return;
      const A = acc[i]!;
      const chassis = i === 0 ? a.chassis : b.chassis;
      const pose = poseBot(u, chassis);
      const shoL = bone(pose, "upperArmL").a, fistL = bone(pose, "fistL").a;
      const shoR = bone(pose, "upperArmR").a, fistR = bone(pose, "fistR").a;
      A.fistReach.push(Math.max(d3(shoL, fistL), d3(shoR, fistR)));
      A.armSwing.push(Math.max(Math.abs(u.armL), Math.abs(u.armR)));
      A.lean.push(Math.abs(u.lean)); A.tilt.push(Math.abs(u.tilt));
      A.headY.push(bone(pose, "head").b[1]);
      A.footLift.push(Math.max(bone(pose, "footL").a[1], bone(pose, "footR").a[1]));
      if (u.down > 0) A.downTicks++;
      const p = prev[i];
      if (p) {
        A.fistSpeed.push(Math.max(d3(fistL, p.fistL), d3(fistR, p.fistR)) * 60);
        A.turned += Math.abs(((u.heading - p.heading + Math.PI) % (2*Math.PI)) - Math.PI);
        A.travelled += Math.hypot(u.x - p.x, u.y - p.y);
        if (u.down > 0 && p.down === 0) A.knockdowns++;
      }
      prev[i] = { fistL, fistR, heading: u.heading, x: u.x, y: u.y, down: u.down };
    });
    r = g.next();
  }
  prev[0] = prev[1] = null;
}

const stat = (v: number[]) => v.length
  ? { min: Math.min(...v), max: Math.max(...v), spread: Math.max(...v) - Math.min(...v) }
  : { min: 0, max: 0, spread: 0 };
const f2 = (n: number) => n.toFixed(2);

console.log(`6 matches, ${frames} frames, ${hits} strikes landed\n`);
["GHOST (DRONE)", "RUSHER (HORNET)"].forEach((name, i) => {
  const A = acc[i]!;
  const fr = stat(A.fistReach), ln = stat(A.lean), tl = stat(A.tilt);
  const hy = stat(A.headY), fl = stat(A.footLift), sw = stat(A.armSwing);
  console.log(`── ${name}`);
  console.log(`  ARMS    fist reach ${f2(fr.min)}→${f2(fr.max)} m  (travel ${f2(fr.spread)} m)`);
  console.log(`          swing angle 0→${f2(sw.max)} rad   peak fist speed ${f2(Math.max(...A.fistSpeed))} m/s`);
  console.log(`  RAGDOLL lean 0→${f2(ln.max)} rad   tilt 0→${f2(tl.max)} rad`);
  console.log(`          head height ${f2(hy.min)}→${f2(hy.max)} m  (drop ${f2(hy.spread)} m)`);
  console.log(`          knockdowns ${A.knockdowns}, ${A.downTicks} ticks on the floor`);
  console.log(`  GAIT    foot lift 0→${f2(fl.max)} m`);
  console.log(`  MOVE    travelled ${f2(A.travelled)} m, turned ${f2(A.turned)} rad total\n`);
});
