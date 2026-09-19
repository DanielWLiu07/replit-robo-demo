import type { NeuronModule } from "@workspace/contract";
import { CONNECTOME } from "./connectome.js";
import { makeRng } from "./rng.js";

/**
 * Geometry for a 3D brain view.
 *
 * One fibre is drawn per *real* cell, using the FlyWire 783 population counts. That
 * is the whole point of the picture: LC10a arrives as 234 threads and the Giant Fiber
 * as exactly 2, so when escape fires you see two thick lines flash while pursuit
 * shimmers across hundreds. The asymmetry is the anatomy, not a styling choice.
 *
 * Positions are schematic, not traced morphology, visual projection neurons run from
 * the optic lobes medially into the central brain, descending neurons run from the
 * central brain down toward the nerve cord, and P1 sits central. Honest framing:
 * "anatomically arranged, one fibre per counted cell", not "traced from the connectome".
 */

export type Vec3 = [number, number, number];

export interface Fibre {
  /** soma / input end */
  from: Vec3;
  /** quadratic bezier control point, gives each fibre its arc */
  ctrl: Vec3;
  /** output end */
  to: Vec3;
}

export interface PopulationGeometry {
  module: NeuronModule;
  flywireType: string;
  cells: number;
  neurotransmitter: "acetylcholine" | "glutamate";
  superClass: "visual_projection" | "descending" | "central";
  /** one entry per real cell */
  fibres: Fibre[];
  /** where a label should sit */
  labelAt: Vec3;
}

/** Brain bounding box is roughly 2 wide, 1.2 tall, 1 deep, centred on origin. */
export const BRAIN_EXTENT = { x: 1.0, y: 0.6, z: 0.5 };

const jitter = (rng: () => number, s: number) => (rng() - 0.5) * s;

function visualProjection(rng: () => number, side: 1 | -1, i: number, n: number): Fibre {
  // optic lobe: a lateral shell. spread cells over its surface.
  const t = n === 1 ? 0.5 : i / (n - 1);
  const theta = t * Math.PI * 1.15 - Math.PI * 0.08;
  const r = 0.42 + jitter(rng, 0.09);
  const from: Vec3 = [
    side * (0.78 + jitter(rng, 0.06)),
    Math.cos(theta) * r * 0.85 + jitter(rng, 0.04),
    Math.sin(theta) * r * 0.7 + jitter(rng, 0.05),
  ];
  // terminate in the central brain, medial
  const to: Vec3 = [side * (0.16 + jitter(rng, 0.09)), 0.05 + jitter(rng, 0.22), jitter(rng, 0.2)];
  const ctrl: Vec3 = [side * (0.52 + jitter(rng, 0.08)), from[1] * 0.45 + jitter(rng, 0.1), from[2] * 0.5 + jitter(rng, 0.08)];
  return { from, ctrl, to };
}

function descending(rng: () => number, side: 1 | -1, i: number, n: number): Fibre {
  // soma in the central brain, axon runs posteriorly and down toward the nerve cord
  const spread = n <= 2 ? 0 : (i / (n - 1) - 0.5) * 0.3;
  const from: Vec3 = [side * (0.2 + spread + jitter(rng, 0.03)), 0.16 + jitter(rng, 0.07), jitter(rng, 0.08)];
  const to: Vec3 = [side * (0.06 + jitter(rng, 0.02)), -0.72 + jitter(rng, 0.05), -0.18 + jitter(rng, 0.05)];
  const ctrl: Vec3 = [side * (0.18 + jitter(rng, 0.04)), -0.3 + jitter(rng, 0.08), -0.05];
  return { from, ctrl, to };
}

function central(rng: () => number, side: 1 | -1, i: number, n: number): Fibre {
  const t = n === 1 ? 0.5 : i / (n - 1);
  const a = t * Math.PI * 1.6;
  const from: Vec3 = [side * (0.12 + jitter(rng, 0.07)), 0.1 + Math.sin(a) * 0.12, Math.cos(a) * 0.12];
  const to: Vec3 = [side * (0.3 + jitter(rng, 0.1)), 0.02 + jitter(rng, 0.14), jitter(rng, 0.14)];
  const ctrl: Vec3 = [side * 0.22, 0.14 + jitter(rng, 0.06), jitter(rng, 0.1)];
  return { from, ctrl, to };
}

/**
 * Build the whole brain. Deterministic for a given seed, so the geometry is stable
 * across reloads and identical for every viewer of the same match.
 */
export function buildBrainGeometry(seed = "flyweight-brain"): PopulationGeometry[] {
  const rng = makeRng(seed);
  const out: PopulationGeometry[] = [];

  for (const module of Object.keys(CONNECTOME) as NeuronModule[]) {
    const pop = CONNECTOME[module];
    const fibres: Fibre[] = [];
    // real counts are both hemispheres, so split them left/right
    const perSide = Math.max(1, Math.round(pop.count / 2));
    for (const side of [1, -1] as const) {
      for (let i = 0; i < perSide; i++) {
        fibres.push(
          pop.superClass === "visual_projection" ? visualProjection(rng, side, i, perSide)
          : pop.superClass === "descending"      ? descending(rng, side, i, perSide)
          :                                        central(rng, side, i, perSide),
        );
      }
    }
    const labelAt: Vec3 =
      pop.superClass === "visual_projection" ? [0.95, 0.32, 0]
      : pop.superClass === "descending"      ? [0.3, -0.55, 0]
      :                                        [0.0, 0.34, 0];
    out.push({
      module, flywireType: pop.flywireType, cells: pop.count,
      neurotransmitter: pop.neurotransmitter, superClass: pop.superClass,
      fibres, labelAt,
    });
  }
  return out;
}

/** Total fibres drawn, useful for a "N cells rendered" readout. */
export const totalFibres = (g: PopulationGeometry[]) =>
  g.reduce((a, p) => a + p.fibres.length, 0);
