import { runMatch, poseBot } from "./index.js";
import { DEFAULT_BOTS } from "../../../artifacts/mockup-sandbox/src/flyweight/modules.js";
const [a, b] = DEFAULT_BOTS;

/** Find a stretch of steady, straight walking and dump one full gait cycle. */
type Snap = { gait: number; along: number; bones: any[]; feet: number[]; spd: number };
let best: Snap[] = [];
for (let s = 0; s < 30 && best.length === 0; s++) {
  const g = runMatch(`walk-${s}`, a, b);
  let r = g.next();
  let run: any[] = [];
  while (!r.done) {
    const u: any = (r.value as any).bots[0];
    const spd = Math.hypot(u.vx, u.vy);
    const clean = u.down === 0 && u.recovery === 0 && spd > 0.9 &&
                  Math.abs(u.lean) < 0.32 && Math.abs(u.tilt) < 0.32;
    if (clean) run.push({ ...u, feet: [...u.feet], spd });
    else run = [];
    // one full cycle = gait wraps once, with a few frames either side
    if (run.length > 4) {
      const first = run[0].gait;
      const wrapped = run.findIndex((x, i) => i > 0 && x.gait < run[i - 1].gait);
      if (wrapped > 13) {
        const seg = run.slice(0, wrapped + 1);
        const h = seg[Math.floor(seg.length / 2)].heading;
        const straight = seg.every((x: any) => Math.abs(((x.heading - h + Math.PI) % (2 * Math.PI)) - Math.PI) < 0.7);
        if (straight) {
          const dx = Math.cos(h), dy = Math.sin(h);
          const x0 = seg[0].x, y0 = seg[0].y;
          best = seg.map((u: any) => ({
            gait: u.gait, spd: u.spd,
            along: (u.x - x0) * dx + (u.y - y0) * dy,
            bones: poseBot(u, a.chassis).bones.map((bn: any) => ({ n: bn.name, a: bn.a, b: bn.b, r: bn.radius })),
            // feet in the same along-track frame, with height
            feet: [0, 1].flatMap(k => {
              const o = k * 3;
              return [(u.feet[o] - x0) * dx + (u.feet[o + 1] - y0) * dy, u.feet[o + 2]];
            }),
          }));
          break;
        }
        run = [];
      }
    }
    r = g.next();
  }
}
if (!best.length) { console.error("no clean straight walking cycle found"); process.exit(1); }
console.log(JSON.stringify({ frames: best.length, speed: +best[0]!.spd.toFixed(2), snaps: best }));
