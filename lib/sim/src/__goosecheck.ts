import { runMatch, poseBot } from "./index.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
const [a, b] = DEFAULT_BOTS;
const bone = (p: any, n: string) => p.bones.find((x: any) => x.name === n);
const dir = (bn: any) => {
  const d = [bn.b[0]-bn.a[0], bn.b[1]-bn.a[1], bn.b[2]-bn.a[2]];
  const L = Math.hypot(...d) || 1; return d.map(v => v/L);
};
const ang = (u: number[], v: number[]) =>
  Math.acos(Math.max(-1, Math.min(1, u[0]*v[0]+u[1]*v[1]+u[2]*v[2])));

/**
 * Sweep WITHIN one gait cycle, which is what the goose's clip amplitudes describe.
 * Measuring across a whole match instead mixes in turning, leaning and speed changes
 * and flatters every number — the first pass read spine at 1.62 rad against the
 * goose's 0.08 and called it fine.
 */
const NAMES = ["spine","neck","head","thighL","shinL","footL",
               "upperArmL","foreArmL","fistL","wingL"];
const cycles: Record<string, number[]> = {};
for (const n of NAMES) cycles[n] = [];
let counted = 0;
for (let s = 0; s < 5; s++) {
  const g = runMatch(`goose-${s}`, a, b);
  let r = g.next();
  let win: Record<string, number[][]> = {}; let lastGait = -1; let ok = true;
  const reset = () => { win = {}; for (const n of NAMES) win[n] = []; ok = true; };
  reset();
  while (!r.done) {
    const u: any = (r.value as any).bots[0];
    const spd = Math.hypot(u.vx, u.vy);
    // a clean walking cycle: upright, not recovering, actually moving
    if (!(u.down === 0 && u.recovery === 0 && spd > 1.0 &&
          Math.abs(u.lean) < 0.25 && Math.abs(u.tilt) < 0.25)) ok = false;
    if (lastGait >= 0 && u.gait < lastGait) {          // wrapped = one full cycle
      if (ok && win.spine!.length > 6) {
        for (const n of NAMES) {
          const v = win[n]!; let mx = 0;
          for (let i = 0; i < v.length; i++)
            for (let j = i + 1; j < v.length; j++) mx = Math.max(mx, ang(v[i]!, v[j]!));
          cycles[n]!.push(mx);
        }
        counted++;
      }
      reset();
    }
    lastGait = u.gait;
    const p = poseBot(u, a.chassis);
    for (const n of NAMES) { const bn = bone(p, n); if (bn) win[n]!.push(dir(bn)); }
    r = g.next();
  }
}
const median = (v: number[]) => { if (!v.length) return 0;
  const s2 = [...v].sort((x, y) => x - y); return s2[Math.floor(s2.length / 2)]!; };
const GOOSE: Record<string, number> = {
  thighL: 0.84, shinL: 0.55, footL: 0.80, spine: 0.08, neck: 0.10, head: 0.18, wingL: 0.07,
};
console.log(`clean walking cycles measured: ${counted}\n`);
console.log("bone         FLYWEIGHT/cycle   goose clip    verdict");
for (const n of NAMES) {
  const m = median(cycles[n]!);
  const g = GOOSE[n];
  let v = "";
  if (g !== undefined) v = m >= g * 0.7 ? "comparable" : m >= g * 0.35 ? "thin" : "MISSING";
  console.log(`  ${n.padEnd(11)} ${m.toFixed(3)} rad` +
    (g !== undefined ? `        ${g.toFixed(2)} rad` : "              —   ") + `    ${v}`);
}
