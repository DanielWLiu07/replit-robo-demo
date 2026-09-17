import { runMatch, poseBot } from "./index.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
const [a, b] = DEFAULT_BOTS;
const bone = (p: any, n: string) => p.bones.find((x: any) => x.name === n)!;
const d3 = (u: number[], v: number[]) => Math.hypot(u[0]-v[0], u[1]-v[1], u[2]-v[2]);
const keep = (u: any) => ({ armL:u.armL, armR:u.armR, armLv:u.armLv, armRv:u.armRv,
  guard:u.guard, recovery:u.recovery, lean:u.lean, tilt:u.tilt, down:u.down, gait:u.gait,
  vx:u.vx, vy:u.vy });
let worst = { jump: 0, prev: null as any, cur: null as any, pf: [0,0,0], cf: [0,0,0] };
for (let seed = 0; seed < 4; seed++) {
  const g = runMatch(`fj-${seed}`, a, b); let r = g.next(); let prev: any = null;
  while (!r.done) {
    const u: any = (r.value as any).bots[0];
    const pose = poseBot(u, a.chassis);
    const fL = bone(pose, "fistL").a;
    if (prev) {
      const jump = d3(fL, prev.fL) * 60;
      if (jump > worst.jump) worst = { jump, prev: prev.st, cur: keep(u), pf: prev.fL, cf: fL };
    }
    prev = { fL, st: keep(u) }; r = g.next();
  }
}
const f = (n: number) => +n.toFixed(3);
console.log("worst single-frame fist jump:", f(worst.jump), "m/s");
console.log("fist   before", worst.pf.map(f).join(", "), " ->  after", worst.cf.map(f).join(", "));
const diff: Record<string, string> = {};
for (const k of Object.keys(worst.cur)) {
  const p = (worst.prev as any)[k], c = (worst.cur as any)[k];
  if (Math.abs(c - p) > 1e-9) diff[k] = `${f(p)} -> ${f(c)}`;
}
console.log("state that changed:", JSON.stringify(diff, null, 1));
