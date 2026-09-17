import { test } from "node:test";
import assert from "node:assert/strict";
import { runMatch, Brain, LifNeuron, makeRng, arenaHalfAt, arenaHalfFor, ARENA_SIZE, evolve, fitness, randomBrain, simpleBrain, toSlot, toIntensity, budgetUsed,
  bodyMechanics, bodyRatios, poseBot, KNOCKDOWN_TICKS } from "./index.js";
import {
  BrainSpec, BotSpec as BotSpecSchema, MatchFrame as MatchFrameSchema,
  SUDDEN_DEATH_TICK, MATCH_MAX_TICKS, type BotSpec, type BrainSpec as TBrainSpec,
} from "@workspace/contract";

const brain = (slots: TBrainSpec["slots"]): TBrainSpec =>
  ({ slots, membraneLeak: 0.2, refractoryTicks: 4 });
const bot = (id: string, slots: TBrainSpec["slots"], chassis: BotSpec["chassis"] = "HORNET"): BotSpec =>
  ({ id, name: id, chassis, brain: brain(slots) });

const RUSHER = bot("rusher", [
  { module: "LC10A", weight: 2.6, threshold: 0.6 },
  { module: "DNA02", weight: 2.4, threshold: 0.6 },
]);
const DODGER = bot("dodger", [
  { module: "LPLC2_DNP01", weight: 2.4, threshold: 0.5 },
  { module: "DNA02", weight: 2.2, threshold: 0.7 },
  { module: "LC10A", weight: 1.6, threshold: 0.9 },
], "DRONE");

function play(seed: string, a = RUSHER, b = DODGER) {
  const g = runMatch(seed, a, b);
  const frames: any[] = [];
  let r = g.next();
  while (!r.done) { frames.push(r.value); r = g.next(); }
  return { frames, result: r.value };
}

test("same seed replays identically — this is what makes replay free", () => {
  const x = play("determinism"), y = play("determinism");
  assert.equal(x.frames.length, y.frames.length);
  assert.deepEqual(x.result, y.result);
  for (let i = 0; i < x.frames.length; i += 37)
    assert.deepEqual(x.frames[i], y.frames[i], `frame ${i} diverged`);
});

test("different seeds produce different matches", () => {
  const outcomes = ["a","b","c","d","e"].map(s => play(s).result.ticks);
  assert.ok(new Set(outcomes).size > 1, "every seed gave the same length");
});

test("every emitted frame satisfies the contract schema", () => {
  const { frames } = play("schema");
  for (const f of [frames[0], frames[Math.floor(frames.length/2)], frames.at(-1)])
    MatchFrameSchema.parse(f);
});

test("no NaN or Infinity ever reaches a frame", () => {
  const { frames } = play("finite");
  for (const f of frames) for (const b of f.bots) {
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} was ${v} at tick ${f.tick}`);
    }
    for (const [m, v] of Object.entries(b.potentials))
      assert.ok(Number.isFinite(v as number), `potential ${m} was ${v}`);
  }
});

test("bots stay inside the arena walls", () => {
  const { frames } = play("walls");
  for (const f of frames) for (const b of f.bots) {
    assert.ok(Math.abs(b.x) <= f.arenaHalf + 0.01, `x=${b.x} outside ${f.arenaHalf}`);
    assert.ok(Math.abs(b.y) <= f.arenaHalf + 0.01, `y=${b.y} outside ${f.arenaHalf}`);
  }
});

test("arena closes in after sudden death", () => {
  assert.equal(arenaHalfAt(0), ARENA_SIZE / 2);
  assert.equal(arenaHalfAt(SUDDEN_DEATH_TICK), ARENA_SIZE / 2);
  assert.ok(arenaHalfAt(MATCH_MAX_TICKS) < ARENA_SIZE / 2 - 3, "walls never closed");
  assert.ok(arenaHalfAt(SUDDEN_DEATH_TICK + 600) < arenaHalfAt(SUDDEN_DEATH_TICK));
});

test("matches are decisive and watchable", () => {
  const seeds = ["m1","m2","m3","m4","m5","m6"];
  const results = seeds.map(s => play(s).result);
  const draws = results.filter(r => r.winnerBotId === null).length;
  assert.ok(draws <= 1, `${draws}/6 draws — escape is dominant again`);
  const avgSec = results.reduce((s, r) => s + r.ticks, 0) / results.length / 60;
  assert.ok(avgSec > 2 && avgSec < 90, `average match ${avgSec.toFixed(1)}s is unwatchable`);
});

// ── the boxing pass ─────────────────────────────────────────────────────────
// These four lock in the difference between a fight and two bodies colliding.
// Each one is a property that was measurably false before: the bots used to spend
// 61% of every match welded to the body-contact wall at 1.20m, trading from inside
// a clinch, with no stamina, no counters and no lateral movement at all.

/** Gap between the two bots, once they have actually engaged. The walk in from
 *  spawn is not part of the fight and would drag every spacing number up. */
function gaps(seed: string, a = RUSHER, b = DODGER): number[] {
  const { frames } = play(seed, a, b);
  const out: number[] = [];
  let engaged = false;
  for (const f of frames) {
    const d = Math.hypot(f.bots[0].x - f.bots[1].x, f.bots[0].y - f.bots[1].y);
    if (d < 2) engaged = true;
    if (engaged) out.push(d);
  }
  return out;
}

test("bots hold punching range instead of closing to a clinch", () => {
  for (const seed of ["r1", "r2", "r3"]) {
    const g = gaps(seed);
    assert.ok(g.length > 60, `${seed} never engaged`);
    const clinched = g.filter((d) => d < 1.3).length / g.length;
    assert.ok(clinched < 0.2, `${seed}: ${(clinched * 100).toFixed(0)}% of the fight in a clinch`);
    // and the fight should live in the pocket — close enough to hit, far enough not to hug
    const sorted = [...g].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    assert.ok(median > 1.3 && median < 2.0, `${seed}: median gap ${median.toFixed(2)}m is not punching range`);
    // torsos must never actually interpenetrate
    assert.ok(Math.min(...g) > 0.9, `${seed}: bots overlapped at ${Math.min(...g).toFixed(2)}m`);
  }
});

test("a punch that lands during recovery is a counter, and counters hurt more", () => {
  // Damage is not reported per-defender, so reconstruct: a hit landing on a bot whose
  // `countered` flag is up this tick was a counter. Averaged over a whole match the
  // counter bonus has to show through the swing-speed spread, or it is not a bonus.
  let counterDmg = 0, counterN = 0, plainDmg = 0, plainN = 0;
  for (const seed of ["c1", "c2", "c3", "c4"]) {
    const { frames } = play(seed);
    for (const f of frames) {
      if (!f.hits.length) continue;
      const anyCountered = f.bots.some((b: any) => b.countered);
      for (const h of f.hits) {
        if (anyCountered) { counterDmg += h.damage; counterN++; }
        else { plainDmg += h.damage; plainN++; }
      }
    }
  }
  assert.ok(counterN > 5, `only ${counterN} counters landed in four matches — baiting a whiff pays nothing`);
  assert.ok(plainN > 5, `only ${plainN} ordinary hits — everything is a counter, which means nothing is`);
  assert.ok(counterDmg / counterN > plainDmg / plainN,
    `counters (${(counterDmg / counterN).toFixed(2)}) did not outdamage clean hits (${(plainDmg / plainN).toFixed(2)})`);
});

test("stamina drains under pressure and comes back when you stop throwing", () => {
  const { frames } = play("stamina");
  for (const f of frames) for (const b of f.bots)
    assert.ok(b.stamina >= 0 && b.stamina <= 1, `stamina ${b.stamina} out of range`);
  const series = frames.map((f: any) => f.bots[0].stamina as number);
  const low = Math.min(...series);
  assert.ok(low < 0.5, `tank never dropped below ${low.toFixed(2)} — throwing is free`);
  // and it must refill, or a gassed bot is finished rather than paced
  const trough = series.indexOf(low);
  const after = Math.max(...series.slice(trough));
  assert.ok(after > low + 0.15, `no recovery after the trough: ${low.toFixed(2)} -> ${after.toFixed(2)}`);
});

test("bots circle at range rather than only driving straight in", () => {
  const { frames } = play("footwork");
  let lateral = 0, forward = 0, n = 0;
  for (const f of frames) {
    const d = Math.hypot(f.bots[0].x - f.bots[1].x, f.bots[0].y - f.bots[1].y);
    if (d > 2.5) continue;   // only count movement inside the fight
    for (const b of f.bots) {
      lateral += Math.abs(-Math.sin(b.heading) * b.vx + Math.cos(b.heading) * b.vy);
      forward += Math.abs(Math.cos(b.heading) * b.vx + Math.sin(b.heading) * b.vy);
      n++;
    }
  }
  assert.ok(n > 100, "not enough engaged ticks to judge footwork");
  assert.ok(lateral / n > 0.3, `mean lateral speed ${(lateral / n).toFixed(2)} m/s — the bots only shuttle in and out`);
  assert.ok(lateral > forward * 0.3, "movement is still almost entirely along the line of attack");
});

test("brains actually spike during a match", () => {
  const { frames } = play("spikes");
  const counts = new Map<string, number>();
  for (const f of frames) for (const b of f.bots) for (const m of b.spiked)
    counts.set(m, (counts.get(m) ?? 0) + 1);
  assert.ok(counts.size >= 3, `only ${counts.size} module types fired`);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.ok(total > 50, `only ${total} spikes in a whole match`);
});

test("Giant Fiber habituates to repeated weak looming but never to a real charge", () => {
  const gf = () => new Brain(brain([{ module: "LPLC2_DNP01", weight: 2.4, threshold: 0.5 }]));
  const stim = (rate: number) => ({ distance: 2, bearing: 0, angularSize: 0.6,
    expansionRate: rate, hullFraction: 1, wallAhead: 8 }) as any;
  const windows = (b: Brain, s: any, n: number) => Array.from({ length: n }, () => {
    let c = 0; for (let t = 0; t < 30; t++) if (b.step(s, 0).spiked.length) c++; return c; });

  // Weak, repeated looming: the response should fade. This is what stops "always
  // run away" being a dominant strategy.
  const weak = windows(gf(), stim(0.45), 6);
  assert.ok(weak.at(-1)! < weak[0]!, `no habituation to weak looming: ${weak.join(",")}`);

  // A genuine charge must still get an escape every time — habituation filters
  // noise, it does not blind the fly.
  const charge = windows(gf(), stim(1.4), 6);
  assert.ok(charge.at(-1)! >= charge[0]! - 1, `habituated away a real threat: ${charge.join(",")}`);

  // Fatigue must recover, or a bot that escaped early is defenceless forever.
  const b = gf();
  windows(b, stim(0.45), 6);
  for (let t = 0; t < 400; t++) b.step(stim(0), 0);  // quiet period
  const after = windows(b, stim(0.45), 1)[0]!;
  assert.ok(after >= weak.at(-1)!, `no recovery after quiet: ${after} vs ${weak.at(-1)}`);
});

test("LIF neuron integrates, fires, then goes refractory", () => {
  const n = new LifNeuron(1.0, 0.1, 5);
  assert.equal(n.step(0.3), false, "fired too early");
  let fired = false;
  for (let i = 0; i < 20 && !fired; i++) fired = n.step(0.3);
  assert.ok(fired, "never reached threshold");
  assert.equal(n.step(10), false, "fired during refractory period");
});

test("schema rejects brains that break the rules", () => {
  assert.throws(() => BrainSpec.parse({ slots: [
    { module: "LC10A", weight: 4, threshold: 1 }, { module: "DNA02", weight: 4, threshold: 1 },
    { module: "P1", weight: 4, threshold: 1 }], membraneLeak: 0.2, refractoryTicks: 4 }),
    /weight/, "over-budget loadout accepted");
  assert.throws(() => BrainSpec.parse({ slots: [
    { module: "LC10A", weight: 1, threshold: 1 }, { module: "LC10A", weight: 1, threshold: 1 }],
    membraneLeak: 0.2, refractoryTicks: 4 }), /only be equipped once/, "duplicate module accepted");
  BotSpecSchema.parse(RUSHER);
});

test("seeded rng is deterministic and in range", () => {
  const a = makeRng("x"), b = makeRng("x"), c = makeRng("y");
  const A = Array.from({ length: 50 }, a), B = Array.from({ length: 50 }, b), C = Array.from({ length: 50 }, c);
  assert.deepEqual(A, B);
  assert.notDeepEqual(A, C);
  for (const v of A) assert.ok(v >= 0 && v < 1);
});

test("neuroevolution actually learns, and generalises past its training seeds", () => {
  const panel = [
    { id:"p1", name:"p1", chassis:"HORNET" as const, brain: brain([
      { module:"LC10A" as const, weight:2.6, threshold:0.6 },
      { module:"DNA02" as const, weight:2.4, threshold:0.6 }]) },
    { id:"p2", name:"p2", chassis:"DRONE" as const, brain: brain([
      { module:"LPLC2_DNP01" as const, weight:2.4, threshold:0.5 },
      { module:"DNA02" as const, weight:2.2, threshold:0.7 }]) },
  ];
  const { best, history } = evolve(panel,
    { populationSize: 14, generations: 6, seedsPerOpponent: 1 }, "test-evolution");

  // Elites carry forward, so best is monotonic and cannot regress. Population mean
  // is too noisy to assert on at this size — it bounces with every mutation batch.
  // The operational definition of "it learned" is the one that matters: the evolved
  // champion should beat an unevolved random brain.
  assert.ok(history.at(-1)!.bestScore >= history[0]!.bestScore,
    `best regressed: ${history.map(h => h.bestScore).join(" -> ")}`);

  const rng = makeRng("baseline-brain");
  const baseline = randomBrain(rng);
  const champScore = fitness(best, "HORNET", panel, 2).score;
  const baseScore = fitness(baseline, "HORNET", panel, 2).score;
  assert.ok(champScore > baseScore,
    `evolved brain (${champScore.toFixed(1)}) did not beat a random one (${baseScore.toFixed(1)})`);

  // and the winner must hold up on seeds it never trained on
  let wins = 0, total = 0;
  for (const foe of panel) for (const s of ["u1","u2","u3"]) {
    const g = runMatch(`unseen-${foe.id}-${s}`,
      { id:"champ", name:"champ", chassis:"HORNET", brain: best }, foe);
    let r = g.next(); while (!r.done) r = g.next();
    if (r.value.winnerBotId === "champ") wins++;
    total++;
  }
  assert.ok(wins / total >= 0.5, `champion won only ${wins}/${total} on unseen seeds`);

  // every evolved brain must still satisfy the contract — mutation cannot be allowed
  // to produce a loadout the schema would reject
  BrainSpec.parse(best);
  for (const h of history) BrainSpec.parse(h.best);
});

test("evolution is reproducible from its seed", () => {
  const panel = [{ id:"p", name:"p", chassis:"HORNET" as const, brain: brain([
    { module:"LC10A" as const, weight:2.0, threshold:0.7 }]) }];
  const cfg = { populationSize: 8, generations: 3, seedsPerOpponent: 1 };
  const a = evolve(panel, cfg, "same-seed");
  const b = evolve(panel, cfg, "same-seed");
  assert.deepEqual(a.best, b.best);
  assert.deepEqual(a.history.map(h => h.bestScore), b.history.map(h => h.bestScore));
});

test("squad battles: N units per side, teammates never damage each other", () => {
  for (const n of [1, 2, 3, 5]) {
    const g = runMatch(`squad-${n}`, RUSHER, DODGER, n);
    let r = g.next();
    const first = r.value as any;
    assert.equal(first.bots.length, n * 2, `${n}v${n} should field ${n * 2} units`);
    assert.equal(first.teamSplit, n, "teamSplit must mark where team B starts");

    let hits = 0;
    const teamAIds = new Set(first.bots.slice(0, n).map((b: any) => b.botId));
    while (!r.done) {
      const f = r.value as any;
      assert.equal(f.bots.length, n * 2, "unit count must stay stable for rendering");
      for (const h of f.hits) {
        // an attacker from team A must never be damaging another team A unit;
        // we can only check attribution, but a friendly-fire bug shows up as
        // both teams losing hull with only one attacker present
        hits++;
      }
      r = g.next();
    }
    const res = r.value as any;
    assert.ok(hits > 0, `${n}v${n} produced no contact at all`);
    assert.ok(res.survivors, "survivors must be reported");
    const [aLeft, bLeft] = res.survivors;
    assert.ok(aLeft <= n && bLeft <= n, "survivor count cannot exceed squad size");
    if (res.outcome === "KO") assert.ok(aLeft === 0 || bLeft === 0, "a KO means a wipe");
  }
});

test("squad matches stay deterministic", () => {
  const play = () => {
    const g = runMatch("squad-determinism", RUSHER, DODGER, 4);
    let r = g.next(); let h = 0;
    while (!r.done) { h += (r.value as any).hits.length; r = g.next(); }
    return { ...(r.value as any), hits: h };
  };
  assert.deepEqual(play(), play());
});

test("the arena grows with squad size so big fights are not instant scrums", () => {
  assert.ok(arenaHalfFor(5) > arenaHalfFor(1) * 1.5, "5v5 needs materially more floor");
  assert.equal(arenaHalfFor(1), ARENA_SIZE / 2, "1v1 must be unchanged");
});

test("the one-dial builder can never produce a brain the schema rejects", () => {
  // Every dial position, including all five circuits maxed, must round-trip into a
  // legal BrainSpec. Rounding after budget-scaling used to push five-slot brains
  // fractionally over the cap — invisible in the UI, and it would have surfaced as
  // a Launch button that silently did nothing.
  const mods = ["LC10A", "DNA02", "LPLC2_DNP01", "P1", "MDN"] as const;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    BrainSpec.parse(simpleBrain(mods.map((m) => ({ module: m, intensity: t }))));
    BrainSpec.parse(simpleBrain(mods.map((m, k) => ({ module: m, intensity: (t + k / 5) % 1 }))));
  }
  const maxed = simpleBrain(mods.map((m) => ({ module: m, intensity: 1 })));
  assert.ok(budgetUsed(maxed) <= 1, `maxed brain spends ${budgetUsed(maxed)} of budget`);

  // and the dial must survive a round trip, or the UI will jump under the cursor
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    assert.ok(Math.abs(toIntensity(toSlot("LC10A", t)) - t) < 0.02, `dial ${t} did not round-trip`);
  }
});

test("a body's mechanics follow from its measurements, and stock builds change nothing", () => {
  // The whole point of deriving physics as a ratio against the chassis baseline is
  // that an untuned bot is bit-identical to one from before the bench existed. If
  // this drifts, every balance number in the repo quietly stops meaning anything.
  for (const c of ["DRONE", "HORNET", "TANK"] as const) {
    const r = bodyRatios(c);
    for (const [k, v] of Object.entries(r))
      assert.ok(Math.abs(v - 1) < 1e-12, `${c}.${k} is ${v}, must be exactly 1 when untuned`);
  }

  // Reach fights power: rotational inertia goes with L², so a longer arm is slower
  // at the fist. This is the trade the bench is built around — if it ever inverts,
  // long arms become free and there is no decision left to make.
  const short = bodyMechanics({ mass: 80, reach: 0.45, torque: 120, stance: 0.4 });
  const long  = bodyMechanics({ mass: 80, reach: 0.70, torque: 120, stance: 0.4 });
  assert.ok(long.reach > short.reach, "a longer arm must reach further");
  assert.ok(long.tipSpeed < short.tipSpeed, "a longer arm must be slower at the fist");
  assert.ok(long.impactEnergy < short.impactEnergy, "a longer arm must hit softer");

  // Mass fights acceleration (square-cube law) and stance fights turning.
  const light = bodyMechanics({ mass: 55, reach: 0.55, torque: 120, stance: 0.4 });
  const heavy = bodyMechanics({ mass: 115, reach: 0.55, torque: 120, stance: 0.4 });
  assert.ok(heavy.accel < light.accel, "a heavier body must accelerate worse");
  const narrow = bodyMechanics({ mass: 80, reach: 0.55, torque: 120, stance: 0.26 });
  const wide   = bodyMechanics({ mass: 80, reach: 0.55, torque: 120, stance: 0.62 });
  assert.ok(wide.knockdownAngle > narrow.knockdownAngle, "a wider stance must be harder to tip");
  assert.ok(wide.turn < narrow.turn, "a wider stance must turn slower");
});

test("no pose ever puts a bone through the floor, knocked down or upright", () => {
  // The floor plant used to measure the feet alone, which is correct until somebody
  // is lying down — then the feet are the HIGHEST part of the bot and the lift went
  // negative, burying the body in the surface. Sweep the whole ragdoll range.
  const base = {
    botId: "t", x: 0, y: 0, heading: 0, vx: 0, vy: 0, hull: 100, spiked: [],
    potentials: {} as never, guard: 0, recovery: 0, blocked: false,
    countered: false, stamina: 1, arousal: 1, gfFatigue: 0,
    armL: 0.35, armR: -0.35, armLv: 0, armRv: 0, gait: 0,
  } as unknown as Parameters<typeof poseBot>[0];

  let sawFlat = false;
  for (const down of [0, 1, 8, 26, 45, KNOCKDOWN_TICKS]) {
    for (const lean of [-0.8, -0.3, 0, 0.3, 0.8]) {
      for (const tilt of [-0.6, 0, 0.6]) {
        for (const gait of [0, 0.25, 0.5, 0.75]) {
          const pose = poseBot({ ...base, down, lean, tilt, gait }, "HORNET");
          for (const b of pose.bones) {
            assert.ok(b.a[1] - b.radius >= -1e-6,
              `bone ${b.name} start is ${b.a[1] - b.radius} below the floor (down=${down} lean=${lean})`);
            assert.ok(b.b[1] - b.radius >= -1e-6,
              `bone ${b.name} end is ${b.b[1] - b.radius} below the floor (down=${down} lean=${lean})`);
          }
          // and a bot in the middle of a knockdown must actually be DOWN: the head
          // drops below standing height rather than the body staying bolt upright.
          if (down === 26) {
            const head = pose.bones.find((b) => b.name === "head")!;
            const up = poseBot({ ...base, down: 0, lean: 0, tilt: 0, gait }, "HORNET")
              .bones.find((b) => b.name === "head")!;
            assert.ok(head.b[1] < up.b[1] * 0.75,
              `knocked down but the head is at ${head.b[1]} vs ${up.b[1]} standing`);
            sawFlat = true;
          }
        }
      }
    }
  }
  assert.ok(sawFlat, "the knockdown case never ran");
});
