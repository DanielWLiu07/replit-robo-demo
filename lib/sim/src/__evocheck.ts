/**
 * Mirrors sim.test.ts's neuroevolution test EXACTLY (same panel, same settings, same
 * call order, `fitness` is evaluated in sequence and the order is part of the
 * fixture), then adds the context the test cannot see: where the single random brain
 * it draws sits in the distribution of random brains.
 */
import { evolve, fitness, randomBrain } from "./evolve.js";
import { makeRng } from "./rng.js";
import type { BotSpec } from "@workspace/contract";

const brain = (slots: any[]) => ({ slots, membraneLeak: 0.2, refractoryTicks: 4 });
const panel: BotSpec[] = [
  { id:"p1", name:"p1", chassis:"HORNET", brain: brain([
    { module:"LC10A", weight:2.6, threshold:0.6 }, { module:"DNA02", weight:2.4, threshold:0.6 }]) },
  { id:"p2", name:"p2", chassis:"DRONE", brain: brain([
    { module:"LPLC2_DNP01", weight:2.4, threshold:0.5 }, { module:"DNA02", weight:2.2, threshold:0.7 }]) },
];

const { best, history } = evolve(panel,
  { populationSize: 14, generations: 6, seedsPerOpponent: 1 }, "test-evolution");
// exactly the test's two calls, in the test's order
const champ = fitness(best, "HORNET", panel, 2).score;
const draw  = fitness(randomBrain(makeRng("baseline-brain")), "HORNET", panel, 2).score;

const scores: number[] = [];
for (let i = 0; i < 40; i++)
  scores.push(fitness(randomBrain(makeRng(`rand-${i}`)), "HORNET", panel, 2).score);
scores.sort((a, b) => a - b);
const q = (p: number) => scores[Math.round(p * (scores.length - 1))]!;
const pctOf = (v: number) => (100 * scores.filter((s) => s < v).length) / scores.length;

console.log(`evolution   ${history.map((h) => h.bestScore.toFixed(1)).join(" -> ")}`);
console.log(`champion    ${champ.toFixed(1)}  (beats ${pctOf(champ).toFixed(0)}% of random brains)`);
console.log(`test's draw ${draw.toFixed(1)}  (beats ${pctOf(draw).toFixed(0)}% of random brains)`);
console.log(`random x40  min ${q(0).toFixed(1)}  p25 ${q(0.25).toFixed(1)}  med ${q(0.5).toFixed(1)}` +
  `  p75 ${q(0.75).toFixed(1)}  max ${q(1).toFixed(1)}`);
console.log(`TEST ASSERTION champ > draw: ${champ > draw ? "PASS" : "FAIL"}`);
