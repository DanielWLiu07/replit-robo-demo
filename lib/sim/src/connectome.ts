import type { NeuronModule } from "@workspace/contract";

/**
 * Real cell populations, counted from the FlyWire 783 public release annotations
 * (Schlegel et al., "Whole-brain annotation and multi-connectome cell typing of
 * Drosophila", Nature 2024). Extracted from Supplemental_file1_neuron_annotations.tsv
 * by matching cell_type / hemibrain_type, both hemispheres.
 *
 * The shape of this table is the interesting part: hundreds of visual projection
 * neurons converge onto two or four descending cells. The Giant Fiber really is a
 * population of two: one per hemisphere, and it is the only glutamatergic member
 * of the set. Everything else here is cholinergic.
 */
export interface CellPopulation {
  /** cells counted across both hemispheres in the 783 release */
  count: number;
  neurotransmitter: "acetylcholine" | "glutamate";
  superClass: "visual_projection" | "descending" | "central";
  /** what the cell type is named in the dataset */
  flywireType: string;
}

export const CONNECTOME: Record<NeuronModule, CellPopulation> = {
  LC10A:       { count: 234, neurotransmitter: "acetylcholine", superClass: "visual_projection", flywireType: "LC10a" },
  LPLC2_DNP01: { count: 2,   neurotransmitter: "glutamate",     superClass: "descending",        flywireType: "DNp01 (Giant Fiber), driven by 210 LPLC2" },
  LC11:        { count: 127, neurotransmitter: "acetylcholine", superClass: "visual_projection", flywireType: "LC11" },
  MDN:         { count: 4,   neurotransmitter: "acetylcholine", superClass: "descending",        flywireType: "MDN" },
  DNA02:       { count: 2,   neurotransmitter: "acetylcholine", superClass: "descending",        flywireType: "DNa02" },
  // P1 is split across many subtypes (P1_15a and friends) in the release; treated as
  // a small central population rather than claiming a precise count we did not verify.
  P1:          { count: 60,  neurotransmitter: "acetylcholine", superClass: "central",           flywireType: "P1 (subtypes aggregated)" },
};

/**
 * Population coding: averaging over many cells cancels noise, so a 234-cell visual
 * population carries a far cleaner signal than a 2-cell descending one. Variance
 * falls as 1/sqrt(N), so this returns the per-tick noise scale for a module.
 *
 * Gameplay consequence, which is also the biological one: the Giant Fiber is a
 * twitchy all-or-nothing alarm, while LC10a pursuit is smooth and dependable.
 */
export function populationNoise(m: NeuronModule): number {
  return 0.34 / Math.sqrt(CONNECTOME[m].count);
}

/** Glutamatergic DNp01 hyperpolarises its followers, escape suppresses pursuit. */
export function isInhibitory(m: NeuronModule): boolean {
  return CONNECTOME[m].neurotransmitter === "glutamate";
}
