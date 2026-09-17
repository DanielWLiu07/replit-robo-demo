import type { NeuronModule } from "@workspace/contract";

/**
 * The whole brain, not a diagram of one.
 *
 * 139,248 neurons at their real FlyWire FAFB v783 positions — every annotated
 * cell in the adult fly. The previous view drew one bezier per counted cell in
 * an arrangement that was anatomical only in spirit; this is the reconstruction.
 *
 * Worth saying what the well-known open-source fly brains actually do here,
 * because the headline numbers are misleading: the popular ones render a
 * handful of hand-placed spheres and tori standing in for brain regions and
 * light those, and show the 139k figure in a separate 2D panel. Nothing was
 * copied from them — this draws the real coordinate of every neuron.
 *
 * Packed as uint16 per axis (quantisation error is ~3 nm against a 190 um brain,
 * far under a soma) plus one byte of metadata, which is 952 KB for the lot. The
 * obvious float32 encoding would be twice that for precision nothing can see.
 *
 * Data: Schlegel et al. 2024, Dorkenwald et al. 2024, Matsliah et al. 2024.
 * See public/data/FLYWIRE-ATTRIBUTION.md.
 */

export interface ConnectomeCloud {
  count: number;
  /** xyz per neuron, centred on the brain and normalised to the longest axis */
  positions: Float32Array;
  /** super_class index per neuron — what kind of cell it is */
  classes: Uint8Array;
  /** 0, or 1..6 for the six circuits the simulation drives */
  modules: Uint8Array;
  classNames: string[];
  moduleNames: string[];
}

/** FlyWire's super_class, ordered as packed. */
export const CLASS_NAMES = [
  "optic", "central", "sensory", "visual_projection", "ascending",
  "descending", "sensory_ascending", "visual_centrifugal", "motor",
  "endocrine", "other",
] as const;

/** Packed module order -> the contract's NeuronModule. */
export const CLOUD_MODULES: NeuronModule[] = [
  "LC10A", "LPLC2_DNP01", "LC11", "DNA02", "MDN", "LPLC2_DNP01",
];

/**
 * Resting brightness per class. The optic lobe is 77,541 of the 139,248 cells,
 * so at equal brightness it is the only thing you see; dimming it by class is
 * what lets the central brain and the descending neurons read at all.
 */
export const CLASS_BRIGHTNESS: Record<string, number> = {
  optic: 0.16,
  visual_projection: 0.42,
  visual_centrifugal: 0.38,
  central: 0.3,
  sensory: 0.26,
  sensory_ascending: 0.3,
  ascending: 0.34,
  descending: 0.72,
  motor: 0.8,
  endocrine: 0.4,
  other: 0.25,
};

let pending: Promise<ConnectomeCloud> | null = null;

/** Fetched once and shared: both fighters' panels draw the same brain. */
export function loadConnectome(base = import.meta.env.BASE_URL): Promise<ConnectomeCloud> {
  if (pending) return pending;
  pending = (async () => {
    const [meta, buffer] = await Promise.all([
      fetch(`${base}data/flywire-soma.json`).then((r) => r.json()),
      fetch(`${base}data/flywire-soma.bin`).then((r) => r.arrayBuffer()),
    ]);
    const count: number = meta.count;
    const raw = new Uint16Array(buffer, 0, count * 3);
    const metaBytes = new Uint8Array(buffer, count * 6, count);

    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      // uint16 -> [-0.5, 0.5] about the brain's centre
      positions[i] = raw[i]! / 65535 - 0.5;
    }
    const classes = new Uint8Array(count);
    const modules = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      classes[i] = metaBytes[i]! & 0x0f;
      modules[i] = metaBytes[i]! >> 4;
    }
    return {
      count, positions, classes, modules,
      classNames: meta.classes,
      moduleNames: meta.modules,
    };
  })();
  return pending;
}
