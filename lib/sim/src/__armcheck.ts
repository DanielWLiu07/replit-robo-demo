import { runMatch, poseBot, rigHeight } from "./index.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
const [a, b] = DEFAULT_BOTS;
const s = rigHeight("DRONE") / 1.06;
const UP = 0.26 * s, FO = 0.29 * s;              // what the arm segments SHOULD be
const d3 = (u: number[], v: number[]) => Math.hypot(u[0]-v[0], u[1]-v[1], u[2]-v[2]);
const upper: number[] = [], fore: number[] = [], shoToFist: number[] = [];
for (let sd = 0; sd < 3; sd++) {
  const g = runMatch(`ac${sd}`, a, b);
  let r = g.next();
  while (!r.done) {
    const u: any = (r.value as any).bots[0];
    const p = poseBot(u, "DRONE");
    const ua = p.bones.find((x: any) => x.name === "upperArmL")!;
    const fa = p.bones.find((x: any) => x.name === "foreArmL")!;
    upper.push(d3(ua.a, ua.b));
    fore.push(d3(fa.a, fa.b));
    shoToFist.push(d3(ua.a, fa.b));
    r = g.next();
  }
}
const stat = (v: number[], want: number, name: string) => {
  const mn = Math.min(...v), mx = Math.max(...v);
  const bad = v.filter(x => Math.abs(x - want) > want * 0.02).length;
  console.log(`  ${name}: should be ${want.toFixed(3)} | actual ${mn.toFixed(3)}-${mx.toFixed(3)} | ` +
    `${(bad / v.length * 100).toFixed(1)}% off by >2%  ${bad / v.length > 0.02 ? "<-- BROKEN" : "ok"}`);
};
console.log("arm segment lengths across a real fight (they are rigid bones, so must not change):");
stat(upper, UP, "upperArm");
stat(fore, FO, "foreArm ");
const reach = UP + FO;
const over = shoToFist.filter(x => x > reach * 1.001).length;
console.log(`  shoulder->fist: max ${Math.max(...shoToFist).toFixed(3)} vs arm reach ${reach.toFixed(3)} | ` +
  `${(over / shoToFist.length * 100).toFixed(1)}% beyond reach`);
