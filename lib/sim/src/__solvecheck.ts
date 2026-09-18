import { solveBrain } from "./optimize.js";
import { profileBrain } from "./profile.js";
import { BotSpec, BRAIN_WEIGHT_BUDGET } from "@workspace/contract";

const show = (label: string, t: any) => {
  const sol = solveBrain(t, { leak: 0.2, refractory: 4 });
  const p = profileBrain(sol.brain, "HORNET");
  const spent = p.aggression + p.evasion + p.tracking;
  const weight = sol.brain.slots.reduce((a: number, s: any) => a + s.weight, 0);
  const ok = BotSpec.safeParse({ id: "x", name: "x", chassis: "HORNET", brain: sol.brain });
  console.log(`${label.padEnd(22)} -> ${p.aggression}/${p.evasion}/${p.tracking}` +
    ` spent ${String(spent).padStart(3)}  weight ${weight.toFixed(2)}/${BRAIN_WEIGHT_BUDGET}` +
    `  slots ${sol.brain.slots.length}  solver.ok ${(sol as any).ok}  schema ${ok.success ? "valid" : "INVALID: " + ok.error.issues[0]?.message}`);
};

show("blank 0/0/0",      { aggression: 0, evasion: 0, tracking: 0 });
show("60/60/60 (=180)",  { aggression: 60, evasion: 60, tracking: 60 });
show("100/80/0 (=180)",  { aggression: 100, evasion: 80, tracking: 0 });
show("100/100/76 (=276)",{ aggression: 100, evasion: 100, tracking: 76 });
show("100/100/100",      { aggression: 100, evasion: 100, tracking: 100 });
