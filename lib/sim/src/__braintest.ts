import { Brain } from "@workspace/sim";
import type { BrainSpec } from "@workspace/contract";
const spec: BrainSpec = { slots: [
  { module: "LC10A", weight: 2.2, threshold: 0.7 },
  { module: "DNA02", weight: 2.0, threshold: 0.7 },
], membraneLeak: 0.2, refractoryTicks: 4 };

for (const [label, s] of Object.entries({
  "facing target, 5m":   { distance:5, bearing:0.0,  angularSize:0.24, expansionRate:0, hullFraction:1, wallAhead:8 },
  "45deg off, 5m":       { distance:5, bearing:0.78, angularSize:0.24, expansionRate:0, hullFraction:1, wallAhead:8 },
  "facing away, 5m":     { distance:5, bearing:3.0,  angularSize:0.24, expansionRate:0, hullFraction:1, wallAhead:8 },
  "close 1.5m, facing":  { distance:1.5,bearing:0.0, angularSize:0.79, expansionRate:0, hullFraction:1, wallAhead:8 },
})) {
  const b = new Brain(spec);
  let fwd = 0, turn = 0; const counts: Record<string, number> = {};
  for (let t = 0; t < 300; t++) {
    const { intent, spiked } = b.step(s as any, 0);
    fwd += intent.forward; turn += intent.turn;
    for (const m of spiked) counts[m] = (counts[m] ?? 0) + 1;
  }
  console.log(`${label.padEnd(22)} fwd/tick=${(fwd/300).toFixed(3)} turn/tick=${(turn/300).toFixed(3)} spikes=${JSON.stringify(counts)}`);
}
