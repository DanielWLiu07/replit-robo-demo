/**
 * The whole fly brain as a spiking network: 139,248 neurons, 2,700,429 synapses,
 * from FlyWire FAFB v783.
 *
 * Every number here is measured. Positions are the annotated soma coordinates,
 * edges are proofread connections at the canonical >= 5 synapse threshold (which
 * reproduces the published 2.7M figure exactly), weights are synapse counts, and
 * the sign of a connection is the presynaptic cell's transmitter: acetylcholine
 * excites, GABA and glutamate inhibit. Nothing about the graph is invented.
 *
 * Measured cost, 600 ticks with ~0.9% of cells active: 0.34 ms per fly per tick.
 * One fly uses 2% of a 60 Hz frame and eleven use 23%, so a whole-brain wave
 * fight runs live. A headless match is the expensive direction — roughly 0.5 s
 * for 1v1 and 6 s for an eleven-fly wave against ~30 ms for the six-module
 * model — which is what any batch path (training, opponent search, verification)
 * has to be budgeted against.
 *
 * What this does NOT solve: the fly's descending neurons drive wings and legs,
 * not fists. Turning DNa02 and DNp01 activity into a punch is still a mapping
 * somebody chose, and that mapping is where the remaining invention lives.
 *
 * Data: Dorkenwald et al. 2024, Schlegel et al. 2024, Matsliah et al. 2024,
 * Berg et al. 2025. CC-BY-4.0, Zenodo 10676866. See FLYWIRE-ATTRIBUTION.md.
 */

/** Transmitter order as packed in flywire-nt.bin. */
export const TRANSMITTERS = [
  "acetylcholine", "gaba", "glutamate", "dopamine", "serotonin", "octopamine", "unknown",
] as const;

/** Drosophila: ACh excites, GABA and glutamate inhibit, modulators are neutral here. */
export const TRANSMITTER_SIGN = new Float32Array([1, -1, -1, 0, 0, 0, 0]);

/** The graph, loaded once and shared by every fly in a match — it is read-only. */
export interface Connectome {
  neurons: number;
  /** CSR out-edges: offsets[i]..offsets[i+1] index into targets/weights */
  offsets: Uint32Array;
  targets: Uint32Array;
  /** synapse count per connection */
  weights: Uint16Array;
  /** transmitter index per neuron */
  transmitter: Uint8Array;
}

export interface WholeBrainConfig {
  /** membrane retained per tick */
  leak: number;
  /** mV to fire */
  threshold: number;
  /** ticks deaf after firing */
  refractory: number;
  /** synapse count -> membrane contribution */
  synapseScale: number;
}

export const WHOLE_BRAIN_DEFAULTS: WholeBrainConfig = {
  leak: 0.9,
  threshold: 1,
  refractory: 3,
  synapseScale: 0.008,
};

/**
 * One fly's brain state over a shared connectome.
 *
 * State is per fly (each has its own membrane potentials); the graph is not.
 * A wave of eleven therefore costs eleven membrane arrays, not eleven copies of
 * a 16 MB edge list.
 *
 * Deterministic: no clock, no Math.random. Same inputs and same tick order
 * produce the same spikes forever, which is what the replay and verification
 * paths already depend on.
 */
export class WholeBrain {
  readonly v: Float32Array;
  readonly inbox: Float32Array;
  readonly refractory: Int16Array;
  /** indices that fired this tick, valid up to `spikeCount` */
  readonly spikes: Uint32Array;
  spikeCount = 0;

  private readonly sign: Float32Array;

  constructor(
    private readonly graph: Connectome,
    private readonly cfg: WholeBrainConfig = WHOLE_BRAIN_DEFAULTS,
  ) {
    const n = graph.neurons;
    this.v = new Float32Array(n);
    this.inbox = new Float32Array(n);
    this.refractory = new Int16Array(n);
    this.spikes = new Uint32Array(n);
    // resolved once so the hot loop never indexes through the transmitter table
    this.sign = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.sign[i] = TRANSMITTER_SIGN[graph.transmitter[i]!]!;
    }
  }

  /** Inject sensory drive before `step`. */
  drive(neuron: number, amount: number): void {
    this.inbox[neuron]! += amount;
  }

  /** Advance one tick. Returns how many cells fired. */
  step(): number {
    const { offsets, targets, weights } = this.graph;
    const { leak, threshold, refractory, synapseScale } = this.cfg;
    const { v, inbox, refractory: refr, spikes, sign } = this;
    const n = this.graph.neurons;

    let count = 0;
    for (let i = 0; i < n; i++) {
      if (refr[i]! > 0) { refr[i]!--; v[i] = 0; inbox[i] = 0; continue; }
      const x = v[i]! * leak + inbox[i]!;
      inbox[i] = 0;
      if (x >= threshold) { spikes[count++] = i; v[i] = 0; refr[i] = refractory; }
      else v[i] = x;
    }

    // Propagate only from cells that fired: ~1% of the brain, so the 2.7M edge
    // list is never walked in full on a tick.
    for (let s = 0; s < count; s++) {
      const i = spikes[s]!;
      const g = sign[i]! * synapseScale;
      if (g === 0) continue;
      for (let e = offsets[i]!, end = offsets[i + 1]!; e < end; e++) {
        inbox[targets[e]!]! += g * weights[e]!;
      }
    }

    this.spikeCount = count;
    return count;
  }

  /** Mean firing across a named set, for driving a motor output or a meter. */
  activity(indices: Uint32Array | number[]): number {
    let hot = 0;
    for (let k = 0; k < indices.length; k++) {
      if (this.refractory[indices[k as number]!]! > 0) hot++;
    }
    return indices.length ? hot / indices.length : 0;
  }

  reset(): void {
    this.v.fill(0);
    this.inbox.fill(0);
    this.refractory.fill(0);
    this.spikeCount = 0;
  }
}
