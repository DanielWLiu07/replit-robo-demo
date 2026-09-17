/**
 * The compositor graph: a second node domain next to the material graph.
 *
 * Same shape as the material graph (nodes keyed by Blender bl_idname, inputs
 * held inline so data flow is the wiring) but a different vocabulary and a
 * different execution model. Material nodes are evaluated per surface point;
 * compositor nodes are evaluated per screen pixel over whole IMAGES, and some
 * of them (Filter, Blur, Displace) read their input at neighbouring pixels.
 * Keeping the two domains as separate types means a shader node can never be
 * wired into a compositor graph by accident, which is exactly the boundary
 * Blender itself draws between the shader editor and the compositor.
 */
import type { Vec4 } from '../transpiler/blender-ops';

/** A float socket, per pixel. */
export type CompScalar = number;
/** An RGBA socket, per pixel. Scene-linear, straight alpha unless a node says otherwise. */
export type CompColor = Vec4;
export type CompValue = CompScalar | CompColor;

/** A literal (unconnected socket default) or another node (a link). */
export type CompInput = CompNode | CompValue;

export interface CompNode {
  readonly id: number;
  /** Blender bl_idname, e.g. 'CompositorNodeBlur'. Custom nodes use 'Custom'. */
  readonly type: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly inputs: readonly CompInput[];
}

export const isCompNode = (x: CompInput): x is CompNode =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const isCompColor = (x: CompValue): x is CompColor => Array.isArray(x);

/**
 * Fidelity tag per node type, the same three-way split the brief uses:
 *  exact       transcribed from Blender's compositor source
 *  approximate reproduces the operation with a documented deviation
 *  custom      not a Blender node at all (escape hatch); tagged so it is never mistaken for one
 */
export type CompFidelity = 'exact' | 'approximate' | 'custom';

export const COMP_FIDELITY: Record<string, CompFidelity> = {
  CompositorNodeRLayers: 'exact',
  CompositorNodeImage: 'exact',
  CompositorNodeValue: 'exact',
  CompositorNodeRGB: 'exact',
  CompositorNodeTime: 'exact',
  CompositorNodeCoordinates: 'exact',
  CompositorNodeMixRGB: 'exact',
  CompositorNodeMath: 'exact',
  CompositorNodeValToRGB: 'exact',
  CompositorNodeSeparateColor: 'exact',
  CompositorNodeCombineColor: 'exact',
  CompositorNodeInvert: 'exact',
  CompositorNodeHueSat: 'exact',
  CompositorNodeBrightContrast: 'exact',
  CompositorNodeGamma: 'exact',
  CompositorNodeExposure: 'exact',
  CompositorNodePosterize: 'exact',
  CompositorNodeAlphaOver: 'exact',
  CompositorNodeSetAlpha: 'exact',
  CompositorNodeRGBToBW: 'exact',
  CompositorNodeMapValue: 'exact',
  CompositorNodeMapRange: 'exact',
  CompositorNodeFilter: 'exact',
  // zero border like Blender, but bilinear where Blender samples EWA/textureGrad (anisotropic)
  CompositorNodeDisplace: 'approximate',
  // extend_bounds is not implemented (clamp-to-bounds only)
  CompositorNodeBlur: 'approximate',
  Custom: 'custom',
};
