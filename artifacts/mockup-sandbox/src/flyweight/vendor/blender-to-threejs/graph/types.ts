/**
 * The authored node graph — the shape materials are built in by hand, as opposed
 * to the wire-format IR the Blender exporter emits (src/ir/types.ts).
 *
 * Both describe the same thing, and deliberately so: nodes are keyed by Blender
 * `bl_idname`, so a graph built here classifies through the very same
 * NODE_CLASSES table the exporter's coverage report uses. One fidelity model,
 * whichever end the graph came from.
 *
 * The difference is ergonomics. The IR is keyed by node name with an explicit
 * links array, which is right for a serialiser and painful to write by hand;
 * here a node simply holds its inputs, so data flow IS the wiring.
 */
import type { Vec4 } from '../transpiler/blender-ops';

/** A float socket. */
export type Scalar = number;

/** An RGBA socket. Blender colours are LINEAR — never sRGB-encode these. */
export type Color = Vec4;

export type GraphValue = Scalar | Color;

/**
 * An input is either a literal (an unconnected socket carrying its default) or
 * another node (a connected socket). That union is exactly Blender's own
 * distinction between a socket's `default_value` and an incoming link.
 */
export type NodeInput = GraphNode | GraphValue;

export interface GraphNode {
  /** Unique within a Graph; also the memo key when evaluating. */
  readonly id: number;
  /** Blender bl_idname, e.g. 'ShaderNodeMath'. */
  readonly type: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly inputs: readonly NodeInput[];
}

export const isNode = (x: NodeInput): x is GraphNode =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const isColor = (x: GraphValue): x is Color => Array.isArray(x);
