import { fistLocal, rigHeight } from "./index.js";
const ARM_REST = 0.35;
const s = rigHeight("DRONE") / 1.06;
const shoulderH = (0.52 + 0.34) * s, headTop = shoulderH + 0.2 * s;
// mirror the idle exactly
const PUNCH_OUT = 0.13, PUNCH_HOLD = 0.06, PUNCH_BACK = 0.34;
const curve = (dt: number) => {
  if (dt < PUNCH_OUT) { const u = dt / PUNCH_OUT; return u * u * (3 - 2 * u); }
  if (dt < PUNCH_OUT + PUNCH_HOLD) return 1;
  const u = (dt - PUNCH_OUT - PUNCH_HOLD) / PUNCH_BACK;
  return u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
};
const st = (throwL: number) => ({
  armL: ARM_REST - throwL * ARM_REST, armR: -ARM_REST,
  armLv: 0, armRv: 0, guard: 0.9, recovery: 0, gait: 0, vx: 0, vy: 0,
});
console.log(`body ${(1.06 * s).toFixed(2)} tall | shoulder ${shoulderH.toFixed(2)} | head top ${headTop.toFixed(2)}\n`);
console.log("  t(s)  swing   fist forward   fist height   extension   | note");
let prev: number[] | null = null, peak = 0;
for (let i = 0; i <= 26; i++) {
  const dt = i * 0.025;
  const sw = curve(dt);
  const f = fistLocal(st(sw) as never, "DRONE", -1);
  const fwd = -f.fist[0], hgt = f.fist[1];
  if (prev) peak = Math.max(peak, Math.hypot(f.fist[0]-prev[0], f.fist[1]-prev[1], f.fist[2]-prev[2]) / 0.025);
  prev = [...f.fist];
  if (i % 2 === 0)
    console.log(`  ${dt.toFixed(2)}  ${sw.toFixed(2)}    ${fwd.toFixed(3)} m       ${hgt.toFixed(3)} m     ${f.extend.toFixed(2)}` +
      (hgt < shoulderH - 0.06 ? "   <-- fist BELOW shoulder" : ""));
}
console.log(`\npeak fist speed through the jab: ${peak.toFixed(2)} m/s`);
