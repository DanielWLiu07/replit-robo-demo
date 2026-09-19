import type { BrainSpec, NeuronModule } from "@workspace/contract";
import { LifNeuron } from "./neuron.js";
import { populationNoise } from "./connectome.js";

/** What one bot can see of the other, this tick. */
export interface Senses {
  /** metres */
  distance: number;
  /** radians, -PI..PI. 0 = opponent dead ahead. */
  bearing: number;
  /** radians the opponent subtends. bigger = closer. */
  angularSize: number;
  /** d(angularSize)/dt. THIS is the looming cue LPLC2 actually responds to. */
  expansionRate: number;
  /** 0..1 */
  hullFraction: number;
  /** metres to the nearest wall ahead */
  wallAhead: number;
}

/** Motor intent, before it becomes wheel torque. */
export interface MotorIntent {
  forward: number;
  turn: number;
}

/**
 * A brain is the equipped modules, each a LIF cell fed by the sensory channel its
 * real counterpart responds to. Spikes are impulses on the motor bus, nothing
 * integrates a "plan", which is the point.
 */
export class Brain {
  private cells = new Map<NeuronModule, LifNeuron>();
  private weights = new Map<NeuronModule, number>();
  /** P1 arousal: multiplies every other module's drive. Rises with damage taken. */
  private arousal = 1;
  /** LC11 gates LC10a: you chase what you have acquired. */
  private acquired = 0;
  /**
   * Giant Fiber habituation. Repeated looming produces a diminishing escape response
   * in the real fly, and it is what stops "always run away" being a dominant strategy:
   * evasion buys you distance the first few times, then stops answering.
   */
  private gfFatigue = 0;

  /** Deterministic noise source. Optional so existing call sites keep working. */
  private rng: () => number;

  constructor(spec: BrainSpec, rng: () => number = () => 0.5) {
    this.rng = rng;
    for (const slot of spec.slots) {
      this.cells.set(
        slot.module,
        new LifNeuron(slot.threshold, spec.membraneLeak, spec.refractoryTicks),
      );
      this.weights.set(slot.module, slot.weight);
    }
  }

  /** P1 arousal gain, for the HUD. */
  get arousalLevel(): number { return this.arousal; }
  /** Giant Fiber habituation normalised 0..1, for the HUD. */
  get fatigueLevel(): number { return Math.min(1, this.gfFatigue / 28); }
  /** LC11 target lock, 0..1. Read by the arena: what you have acquired, you hit clean. */
  get lockLevel(): number { return this.acquired; }

  has(m: NeuronModule): boolean {
    return this.cells.has(m);
  }

  /** 0..1 membrane potential per equipped module, for the trace plot. */
  potentials(): Partial<Record<NeuronModule, number>> {
    const out: Partial<Record<NeuronModule, number>> = {};
    for (const [m, cell] of this.cells) out[m] = cell.normalized;
    return out;
  }

  /** Advance one tick. Returns motor intent plus which cells fired. */
  step(s: Senses, damageTakenThisTick: number): { intent: MotorIntent; spiked: NeuronModule[] } {
    const spiked: NeuronModule[] = [];
    const intent: MotorIntent = { forward: 0, turn: 0 };
    const w = (m: NeuronModule) => (this.weights.get(m) ?? 0) * this.arousal;
    const fire = (m: NeuronModule, input: number): boolean => {
      const cell = this.cells.get(m);
      if (!cell) return false;
      // Population coding: variance falls as 1/sqrt(N), so a 234-cell visual
      // population is smooth while the 2-cell Giant Fiber is twitchy. Counts are
      // real, from the FlyWire 783 release. See connectome.ts.
      const noisy = input + (this.rng() - 0.5) * populationNoise(m) * (input > 0 ? 1 : 0.25);
      const fired = cell.step(Math.max(0, noisy));
      if (fired) spiked.push(m);
      return fired;
    };

    // P1, arousal. Damage and time raise it; it decays toward 1.
    if (this.cells.has("P1")) {
      if (fire("P1", damageTakenThisTick * 0.6 + 0.04)) {
        this.arousal = Math.min(1.65, this.arousal + 0.12 * (this.weights.get("P1") ?? 1));
      }
    }
    this.arousal += (1 - this.arousal) * 0.004;

    // LPLC2 -> Giant Fiber. Fires on looming, not on proximity. Escape is a single
    // spike: hard reverse and a hard turn away. Highest priority on the motor bus.
    let escaping = false;
    this.gfFatigue *= 0.988; // recovers over ~1.4s of no looming
    const gfDrive =
      (Math.max(0, s.expansionRate - 0.22) * 4.5 * w("LPLC2_DNP01")) / (1 + this.gfFatigue);
    if (fire("LPLC2_DNP01", gfDrive)) {
      this.gfFatigue = Math.min(28, this.gfFatigue + 1.7);
      escaping = true;
      intent.forward -= 1.9;
      intent.turn += (s.bearing >= 0 ? -1 : 1) * 1.7;
    }

    // LC11, small-object detection. Acquires a distant target, gating pursuit.
    // The *lock* has to outlive the acquisition: LC11 answers small moving objects,
    // and at punching range the opponent is not small any more. With a fast decay the
    // gate reopened every time a fight closed to the pocket, so an LC11 build simply
    // stopped punching once it arrived, worth 0 wins in 18 matches. Acquisition is
    // brief; tracking persists.
    if (fire("LC11", (s.angularSize < 0.45 ? 0.5 : 0.12) * w("LC11"))) {
      this.acquired = 1;
    }
    this.acquired *= 0.994;

    // LC10a, visual pursuit. The courtship tracking circuit, pointed at violence.
    if (!escaping) {
      const aligned = Math.pow(Math.max(0, Math.cos(s.bearing)), 0.45);
      const gate = this.has("LC11") ? 0.35 + 0.65 * this.acquired : 1;
      if (fire("LC10A", aligned * gate * 0.55 * w("LC10A"))) {
        intent.forward += 1.0;
      }
    }

    // DNa02, steering. Turns toward the bearing error.
    // Graded, not bang-bang: DNa02's firing rate encodes turn magnitude, so the
    // impulse scales with bearing error. Constant-magnitude turns produced a stable
    // 90-degree orbit, the bots circled each other instead of closing.
    if (fire("DNA02", Math.min(1, Math.abs(s.bearing) / Math.PI) * 0.8 * w("DNA02"))) {
      intent.turn += Math.sign(s.bearing) * Math.min(1, Math.abs(s.bearing) / 0.6);
    }

    // MDN, moonwalker. Backs off to reset the exchange. The trigger used to be the
    // opponent's torso filling the view (angularSize 1.1 ~ 0.98m), which was reachable
    // only inside a clinch; now that the bots hold punching range it could never fire
    // at all. Re-aimed at the range it is actually for: they are close enough to hit
    // you (1.6m), so step out. Same circuit, same meaning, spacing, not ramming.
    if (!escaping && fire("MDN", (s.angularSize > 0.72 ? 0.55 : 0.02) * w("MDN"))) {
      intent.forward -= 0.9;
    }

    // Wall reflex: every bot has it, unequipped. Keeps fights in the arena.
    if (s.wallAhead < 1.2) {
      intent.forward -= 0.5 * (1.2 - s.wallAhead);
      intent.turn += 0.6 * (1.2 - s.wallAhead);
    }

    return { intent, spiked };
  }
}
