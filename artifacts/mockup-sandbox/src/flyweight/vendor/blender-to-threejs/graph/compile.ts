/**
 * TSL emission, turns an authored graph into Three node-material code.
 *
 * This is the second consumer of the same graph the CPU evaluator walks. Two
 * backends over one structure is deliberate: the evaluator is testable without a
 * GPU and gives us an exact answer, so it stays the reference, and every emitter
 * here is written to agree with its evaluator counterpart. The parity test in
 * tests/compile.test.ts fails if a node type ever gains one without the other.
 *
 * Where a socket is a compile-time constant, the arithmetic is done in JS and
 * baked in rather than emitted as shader work, a range's clamp bounds, say, are
 * known before a single pixel is shaded.
 */
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  acos,
  asin,
  atan,
  ceil,
  cross,
  clamp,
  cos,
  cosh,
  degrees,
  dot,
  exp,
  float,
  floor,
  fract,
  frontFacing,
  inverseSqrt,
  length,
  log2,
  mat3,
  max,
  min,
  mix,
  mod,
  normalLocal,
  normalView,
  normalWorld,
  normalize,
  positionViewDirection,
  oneMinus,
  positionLocal,
  positionWorld,
  screenUV,
  pow,
  radians,
  refract,
  select,
  sign,
  sin,
  sinh,
  sqrt,
  step,
  tan,
  tanh,
  texture,
  time,
  trunc,
  uniform,
  uv as tslUv,
  vec2,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  RGBAFormat,
  type Texture,
} from 'three';
import { tslNoiseTex3D, tslVoronoiColorF1, tslVoronoiTex, tslWaveTex3D } from './tsl-noise';
import { eeveeLighting, type SketchLight } from '../primitives/eevee-lighting';
import {
  COLOR_RAMP_RESOLUTION,
  bakeColorRamp,
  eulerXYZToMat3,
  type MappingType,
  type ColorStop,
  type RampInterpolation,
} from '../transpiler/blender-ops';

import { isNode, type GraphNode, type NodeInput } from './types';

// TSL node handles are dynamically typed; matching the alias the primitives use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TSLNode = any;

/**
 * A socket is a float or a colour, and which one is fixed per node type. Knowing
 * it statically is what lets the emitter insert Blender's float->colour
 * broadcast in the right places without inspecting runtime values.
 */
/** Mirrors Blender's three socket types: VALUE, VECTOR, RGBA. */
export type Kind = 'scalar' | 'vector' | 'color';

export interface Emitted {
  node: TSLNode;
  kind: Kind;
}

const scalar = (node: TSLNode): Emitted => ({ node, kind: 'scalar' });
const vector = (node: TSLNode): Emitted => ({ node, kind: 'vector' });
const color = (node: TSLNode): Emitted => ({ node, kind: 'color' });

/** Blender broadcasts a float into wider sockets, and pads a vector with alpha 1. */
function toColor(e: Emitted): TSLNode {
  if (e.kind === 'color') return e.node;
  if (e.kind === 'vector') return vec4(e.node, float(1));
  return vec4(e.node, e.node, e.node, float(1));
}

function toVector(e: Emitted): TSLNode {
  if (e.kind === 'vector') return e.node;
  if (e.kind === 'color') return e.node.xyz;
  return vec3(e.node);
}

/**
 * Colour->float is refused here for the same reason the evaluator refuses it:
 * Blender's implicit reduction is context-dependent, and picking one silently
 * would bake a guess into every shader built with this.
 */
function toScalar(e: Emitted, where: string): TSLNode {
  if (e.kind !== 'scalar') {
    throw new Error(
      `[compile] ${where} received a colour where a float was expected. ` +
        'Take an explicit channel rather than relying on an implicit reduction.',
    );
  }
  return e.node;
}

type Emitter = (node: GraphNode, input: (i: number) => Emitted) => Emitted;

/** Emit the RGB of a colour, then reattach the alpha the node is required to keep. */
const withAlpha = (rgb: TSLNode, alphaFrom: TSLNode): TSLNode => vec4(rgb, alphaFrom.w);

const ZERO = float(0);
const ONE = float(1);

/** Uniforms created during the current compile (name -> TSL uniform). Reset per compile(). */
let activeUniforms: Record<string, TSLNode & { value: number }> = {};

/** fresnel_dielectric_cos: 1 on total internal reflection. */
function fresnelDielectricCosTSL(cosi: TSLNode, eta: TSLNode): TSLNode {
  const c = abs(cosi);
  const g2 = eta.mul(eta).sub(1).add(c.mul(c));
  const g = sqrt(max(g2, ZERO));
  const A = g.sub(c).div(g.add(c));
  const B = c.mul(g.add(c)).sub(1).div(c.mul(g.sub(c)).add(1));
  const r = float(0.5).mul(A).mul(A).mul(ONE.add(B.mul(B)));
  return select(g2.greaterThan(ZERO), r, ONE);
}
/** Keeps a divisor or a log/pow base away from 0 so no NaN is ever computed. */
const TINY = float(1e-30);

/** Divide with the denominator guarded, so nothing downstream sees Inf or NaN. */
const guardedDiv = (a: TSLNode, b: TSLNode): TSLNode =>
  select(b.equal(ZERO), ZERO, a.div(select(b.equal(ZERO), ONE, b)));

/** smoothmin, from iquilezles.org/www/articles/smin/smin.htm. */
function smoothMinNode(a: TSLNode, b: TSLNode, c: TSLNode): TSLNode {
  const lower = min(a, b);
  const h = guardedDiv(max(c.sub(abs(a.sub(b))), ZERO), c);
  return select(c.equal(ZERO), lower, lower.sub(h.mul(h).mul(h).mul(c).mul(float(1 / 6))));
}

/**
 * Every ShaderNodeMath operation, mirroring blender-ops.ts, which is itself
 * transcribed from common/gpu_shader_common_math.glsl.
 *
 * Where Blender writes a ternary over an undefined value, this computes a safe
 * value instead of selecting a bad one: a GPU select does not reliably discard a
 * NaN in the branch it did not take, so guards protect the operand, never the
 * result.
 */
const MATH_EMITTERS: Record<string, (a: TSLNode, b: TSLNode, c: TSLNode) => TSLNode> = {
  ADD: (a, b) => a.add(b),
  SUBTRACT: (a, b) => a.sub(b),
  MULTIPLY: (a, b) => a.mul(b),
  DIVIDE: (a, b) => guardedDiv(a, b),
  MULTIPLY_ADD: (a, b, c) => a.mul(b).add(c),

  POWER: (a, b) => {
    // pow rejects a negative base, and 0 with a negative exponent is Inf, so the
    // magnitude is computed from a safe base and the sign restored afterwards.
    const magnitude = pow(max(abs(a), TINY), b);
    const evenExponent = mod(b.negate(), float(2)).equal(ZERO);
    const negativeBase = select(evenExponent, magnitude, magnitude.negate());
    const positiveBase = select(a.equal(ZERO), ZERO, magnitude);
    return select(b.equal(ZERO), ONE, select(a.lessThan(ZERO), negativeBase, positiveBase));
  },
  LOGARITHM: (a, b) =>
    select(
      a.greaterThan(ZERO),
      select(b.greaterThan(ZERO), log2(max(a, TINY)).div(log2(max(b, TINY))), ZERO),
      ZERO,
    ),
  SQRT: (a) => select(a.greaterThan(ZERO), sqrt(max(a, ZERO)), ZERO),
  // Blender leaves this one bare, no domain guard.
  INVERSE_SQRT: (a) => inverseSqrt(a),
  EXPONENT: (a) => exp(a),
  ABSOLUTE: (a) => abs(a),
  SIGN: (a) => sign(a),

  MINIMUM: (a, b) => min(a, b),
  MAXIMUM: (a, b) => max(a, b),
  SMOOTH_MIN: (a, b, c) => smoothMinNode(a, b, c),
  SMOOTH_MAX: (a, b, c) => smoothMinNode(a.negate(), b.negate(), c).negate(),

  LESS_THAN: (a, b) => select(a.lessThan(b), ONE, ZERO),
  GREATER_THAN: (a, b) => select(a.greaterThan(b), ONE, ZERO),
  // epsilon has a floor of 1e-5 even when the socket says less.
  COMPARE: (a, b, c) => select(abs(a.sub(b)).lessThanEqual(max(c, float(1e-5))), ONE, ZERO),

  ROUND: (a) => floor(a.add(float(0.5))),
  FLOOR: (a) => floor(a),
  CEIL: (a) => ceil(a),
  TRUNC: (a) => trunc(a),
  FRACT: (a) => fract(a),

  // compatible_mod truncates toward zero, not GLSL's mod, which floors. Both
  // need an explicit zero-divisor guard: guarding only the division leaves
  // `a - 0 * b`, which is a, where Blender returns 0.
  MODULO: (a, b) => select(b.equal(ZERO), ZERO, a.sub(trunc(guardedDiv(a, b)).mul(b))),
  FLOORED_MODULO: (a, b) => select(b.equal(ZERO), ZERO, a.sub(floor(guardedDiv(a, b)).mul(b))),
  WRAP: (a, b, c) => {
    const range = b.sub(c);
    const s = select(a.equal(b), ONE, floor(guardedDiv(a.sub(c), range)));
    return select(range.equal(ZERO), c, a.sub(range.mul(s)));
  },
  SNAP: (a, b) => floor(guardedDiv(a, b)).mul(b),
  PINGPONG: (a, b) => {
    // Guard the denominator rather than the result: at b == 0 the division is
    // inf and fract(inf) is NaN, which a select will not reliably drop.
    const isZero = b.equal(ZERO);
    const safeB = select(isZero, ONE, b);
    const swung = abs(fract(a.sub(b).div(safeB.mul(2))).mul(b).mul(2).sub(b));
    return select(isZero, ZERO, swung);
  },

  SINE: (a) => sin(a),
  COSINE: (a) => cos(a),
  TANGENT: (a) => tan(a),
  SINH: (a) => sinh(a),
  COSH: (a) => cosh(a),
  TANH: (a) => tanh(a),
  // asin/acos are NaN outside [-1,1], so the input is clamped and the guard
  // decides whether that clamped answer is used at all.
  ARCSINE: (a) => select(abs(a).lessThanEqual(ONE), asin(clamp(a, ONE.negate(), ONE)), ZERO),
  ARCCOSINE: (a) => select(abs(a).lessThanEqual(ONE), acos(clamp(a, ONE.negate(), ONE)), ZERO),
  ARCTANGENT: (a) => atan(a),
  // atan2(0, 0) is undefined across platforms; Blender pins it to 0.
  ARCTAN2: (a, b) =>
    select(a.equal(ZERO).and(b.equal(ZERO)), ZERO, atan(a, b)),

  RADIANS: (a) => radians(a),
  DEGREES: (a) => degrees(a),
};

const EMITTERS: Record<string, Emitter> = {
  ShaderNodeValue: (n) => {
    const name = n.params.uniform as string | undefined;
    if (name) {
      const u = activeUniforms[name] ?? (activeUniforms[name] = uniform(n.params.value as number));
      return scalar(u);
    }
    return scalar(float(n.params.value as number));
  },

  ShaderNodeRGB: (n) => {
    const [r, g, b, a] = n.params.color as number[];
    return color(vec4(r, g, b, a));
  },

  ShaderNodeMath: (n, input) => {
    const op = n.params.operation as string;
    const fn = MATH_EMITTERS[op];
    if (!fn) throw new Error(`[compile] Math operation '${op}' not implemented`);
    const out = fn(
      toScalar(input(0), 'Math.a'),
      toScalar(input(1), 'Math.b'),
      toScalar(input(2), 'Math.c'),
    );
    return scalar(n.params.useClamp ? clamp(out, float(0), float(1)) : out);
  },

  ShaderNodeMix: (n, input) => {
    const blend = n.params.blendType as string;
    const rawFac = toScalar(input(0), 'Mix.fac');
    const fac = n.params.clampFactor ? clamp(rawFac, float(0), float(1)) : rawFac;
    const inA = input(1);
    const inB = input(2);
    // Blender's Mix node carries a data_type. Two floats in means a float mix
    // (what the sketch recipe's overlay actually is); anything else is RGBA.
    const floatMode = inA.kind === 'scalar' && inB.kind === 'scalar';

    // The blend formulas are componentwise, so the same expressions serve both
    // modes, only the channel type and the 0.5 threshold constant differ.
    const a: TSLNode = floatMode ? inA.node : toColor(inA).xyz;
    const b: TSLNode = floatMode ? inB.node : toColor(inB).xyz;
    const zero: TSLNode = floatMode ? float(0) : vec3(0);
    const one: TSLNode = floatMode ? float(1) : vec3(1);
    const half: TSLNode = floatMode ? float(0.5) : vec3(0.5);

    let out: TSLNode;
    switch (blend) {
      case 'MIX':
        out = mix(a, b, fac);
        break;
      case 'MULTIPLY':
        out = mix(a, a.mul(b), fac);
        break;
      case 'OVERLAY': {
        // Per channel: col1 < 0.5 takes the multiply branch, else the screen
        // branch. step() gives a componentwise mask, so one expression covers
        // every channel without a per-channel select.
        const facm = oneMinus(fac);
        const low = a.mul(facm.add(fac.mul(2).mul(b)));
        const high = oneMinus(facm.add(fac.mul(2).mul(oneMinus(b))).mul(oneMinus(a)));
        out = mix(low, high, step(half, a));
        break;
      }
      case 'SCREEN':
        // node_mix_screen: 1 - (facm + fac * (1 - b)) * (1 - a)
        out = one.sub(oneMinus(fac).add(fac.mul(one.sub(b))).mul(one.sub(a)));
        break;
      case 'LINEAR_LIGHT':
        // node_mix_linear: a + fac * (2 * (b - 0.5)). Deliberately unclamped,
        // like Blender: the node's own clamp_result flag is the only clamp.
        out = a.add(fac.mul(b.sub(half).mul(2)));
        break;
      case 'SOFT_LIGHT': {
        // node_mix_soft: facm * a + fac * ((1 - a) * b * a + a * scr),
        // scr = 1 - (1 - b) * (1 - a). NOT the W3C/Photoshop soft light;
        // Blender's is a multiply and a screen weighted by `a`, and the
        // familiar formula is visibly different through the midtones.
        const scr = one.sub(one.sub(b).mul(one.sub(a)));
        out = oneMinus(fac).mul(a).add(fac.mul(one.sub(a).mul(b).mul(a).add(a.mul(scr))));
        break;
      }
      default:
        throw new Error(`[compile] Mix blend type '${blend}' not implemented`);
    }

    if (n.params.clampResult) out = clamp(out, zero, one);
    if (floatMode) return scalar(out);

    // Alpha always comes from the first colour, never the blend, but
    // clamp_result still applies to it. Blender's node_mix_clamp_color clamps a
    // float4, so an out-of-range alpha on col1 is pinned along with the RGB.
    const src = toColor(inA);
    const alpha = n.params.clampResult ? clamp(src.w, float(0), float(1)) : src.w;
    return color(vec4(out, alpha));
  },

  ShaderNodeMapRange: (n, input) => {
    const fromMin = n.params.fromMin as number;
    const fromMax = n.params.fromMax as number;
    const toMin = n.params.toMin as number;
    const toMax = n.params.toMax as number;

    // Blender clamps between toMin and toMax, NOT to [0,1], so a descending
    // range still clamps correctly. Both bounds are constants, so order them
    // here rather than emitting a comparison.
    const lo = Math.min(toMin, toMax);
    const hi = Math.max(toMin, toMax);

    // Degenerate range yields 0, but the clamp is a SEPARATE step in Blender,
    // applied after, so a to-range that excludes 0 pulls the result into it
    // rather than letting a bare 0 through. Every value here is constant, so
    // this collapses to a literal instead of reaching the GPU at all.
    if (fromMax === fromMin) {
      return scalar(float(n.params.clamp ? Math.min(hi, Math.max(lo, 0)) : 0));
    }

    const value = toScalar(input(0), 'MapRange.value');
    const t = value.sub(float(fromMin)).div(float(fromMax - fromMin));
    const out = float(toMin).add(t.mul(float(toMax - toMin)));

    return scalar(n.params.clamp ? clamp(out, float(lo), float(hi)) : out);
  },

  ShaderNodeInvert: (_, input) => {
    const fac = toScalar(input(0), 'Invert.fac');
    const col = toColor(input(1));
    // mix(colour, 1 - colour, fac) on RGB; alpha is untouched.
    return color(withAlpha(mix(col.xyz, oneMinus(col.xyz), fac), col));
  },

  /* ---------------- ShaderNodeValToRGB (Color Ramp) ---------------- */

  ShaderNodeValToRGB: (n, input) => {
    const stops = [...(n.params.stops as ColorStop[])].sort((a, b) => a.position - b.position);
    const interpolation = n.params.interpolation as RampInterpolation;
    const fac = toScalar(input(0), 'ColorRamp.fac');

    // Two stops skip the texture entirely. These paths are exact.
    if (stops.length === 2) {
      const [a, b] = stops;
      const c1 = vec4(...a.color);
      const c2 = vec4(...b.color);
      if (interpolation === 'CONSTANT') {
        // Strictly greater-than: a fac exactly ON the edge takes the FIRST colour.
        return color(select(fac.greaterThan(float(b.position)), c2, c1));
      }
      const span = b.position - a.position;
      const mul = span !== 0 ? 1 / span : 0;
      const t = clamp(fac.mul(float(mul)).add(float(-a.position * mul)), ZERO, ONE);
      const eased = interpolation === 'EASE' ? t.mul(t).mul(float(3).sub(t.mul(2))) : t;
      return color(mix(c1, c2, eased));
    }

    // Three or more: sample the baked 257-texel map, quantisation included.
    return color(texture(rampTexture(n, stops, interpolation), vec2(rampCoord(fac), float(0.5))));
  },

  /* ---------------- varying inputs ---------------- */

  // Carried as a vector with z = 0 so it composes with the vector ops without a
  // special case for 2-component values.
  GraphUV: () => vector(vec3(tslUv(), float(0))),

  GraphPosition: (n) => vector(n.params.space === 'object' ? positionLocal : positionWorld),

  // Blender's Window coordinates: screen UV, origin bottom-left (three's screenUV is top-left, so flip y)
  GraphWindow: () => vector(vec3(screenUV.x, float(1).sub(screenUV.y), float(0))),

  GraphNormal: (n) => vector(n.params.space === 'object' ? normalLocal : normalWorld),

  GraphTexture: (n, input) => {
    const map = n.params.texture as Texture;
    if (!map) throw new Error('[compile] Image Texture has no texture assigned');
    // An unconnected Vector socket defaults to the mesh UVs, same as Blender.
    const coords = n.inputs.length > 0 ? toVector(input(0)) : vec3(tslUv(), float(0));
    return color(texture(map, coords.xy));
  },

  // Blender's Color Attribute node. TSL returns opaque white where the mesh
  // carries no colour attribute, which matches Blender reading an absent layer
  // as white, so an unpainted mesh shades as if the node were not there rather
  // than turning black.
  GraphVertexColor: (n) => color(vertexColor(n.params.layer as number)),

  /* ---------------- ShaderNodeTexNoise ---------------- */
  ShaderNodeTexNoise: (n, input) => {
    const co = toVector(input(0));
    const r = tslNoiseTex3D(co, {
      scale: toScalar(input(1), 'Noise.scale'),
      detail: n.params.detail as number,
      roughness: n.params.roughness as number,
      lacunarity: n.params.lacunarity as number,
      distortion: n.params.distortion as number,
      normalize: n.params.normalize as boolean,
    });
    return n.params.output === 'color' ? color(r.color) : scalar(r.fac);
  },

  /* ---------------- ShaderNodeBsdfDiffuse / ShaderNodeShaderToRGB ----------------
   * Fidelity: APPROXIMATE, and the tag matters. There are no shader closures
   * here, so Diffuse BSDF is Lambert against the node's own light set through
   * the EEVEE primitive, and Shader to RGB is a pass-through because the value
   * it would collapse is already a colour. */
  ShaderNodeBsdfDiffuse: (n, input) => {
    const albedo = toVector(input(0));
    const shade = eeveeLighting(normalWorld, {
      brightness: ONE,
      roughness: float(n.params.roughness as number),
      worldAmbient: float(n.params.worldAmbient as number),
      lights: n.params.lights as SketchLight[],
    });
    return color(vec4(albedo.xyz.mul(shade), ONE));
  },
  ShaderNodeShaderToRGB: (_, input) => color(toVector(input(0))),

  /* ---------------- ShaderNodeVectorMath (vector_math.glsl) ----------------
   * Per component through the SAME guarded helpers the scalar Math node uses,
   * so a Vector Math op and three Math ops agree by construction. */
  ShaderNodeVectorMath: (n, input) => {
    const a = toVector(input(0));
    const b = toVector(input(1));
    const c = toVector(input(2));
    const s = toScalar(input(3), 'VectorMath.scale');
    const op = n.params.operation as string;
    const per = (f: (x: TSLNode, y: TSLNode, z: TSLNode) => TSLNode) =>
      vec4(f(a.x, b.x, c.x), f(a.y, b.y, c.y), f(a.z, b.z, c.z), ONE);
    const safeNorm = (v: TSLNode) => {
      const l2 = dot(v, v);
      return select(l2.greaterThan(float(1e-35)), v.mul(l2.inverseSqrt()) as TSLNode, vec3(0, 0, 0)) as TSLNode;
    };
    switch (op) {
      case 'ADD': return color(per((x, y) => x.add(y)));
      case 'SUBTRACT': return color(per((x, y) => x.sub(y)));
      case 'MULTIPLY': return color(per((x, y) => x.mul(y)));
      case 'DIVIDE': return color(per((x, y) => guardedDiv(x, y)));
      case 'CROSS_PRODUCT': return color(vec4(cross(a, b), ONE));
      case 'PROJECT': {
        const l2 = dot(b, b);
        return color(vec4(select(l2.notEqual(ZERO), b.mul(dot(a, b).div(l2)) as TSLNode, vec3(0, 0, 0)) as TSLNode, ONE));
      }
      case 'REFLECT': { const nn = safeNorm(b); return color(vec4(a.sub(nn.mul(dot(nn, a).mul(2)) as TSLNode) as TSLNode, ONE)); }
      case 'DOT_PRODUCT': return scalar(dot(a, b));
      case 'DISTANCE': return scalar(length(a.sub(b)));
      case 'LENGTH': return scalar(length(a));
      case 'SCALE': return color(vec4(a.mul(s), ONE));
      case 'NORMALIZE': { const l2 = dot(a, a); return color(vec4(select(l2.greaterThan(ZERO), a.mul(l2.inverseSqrt()) as TSLNode, a) as TSLNode, ONE)); }
      case 'SNAP': return color(per((x, y) => floor(guardedDiv(x, y)).mul(y)));
      case 'FLOOR': return color(per((x) => floor(x)));
      case 'CEIL': return color(per((x) => ceil(x)));
      case 'MODULO': return color(per((x, y) => select(y.equal(ZERO), ZERO, x.sub(trunc(guardedDiv(x, y)).mul(y)))));
      case 'WRAP': return color(per((x, y, z) => MATH_EMITTERS.WRAP(x, y, z)));
      case 'FRACTION': return color(per((x) => fract(x)));
      case 'ABSOLUTE': return color(per((x) => abs(x)));
      case 'POWER': return color(per((x, y) => MATH_EMITTERS.POWER(x, y, ZERO)));
      case 'SIGN': return color(per((x) => sign(x)));
      case 'MINIMUM': return color(per((x, y) => min(x, y)));
      case 'MAXIMUM': return color(per((x, y) => max(x, y)));
      case 'SINE': return color(per((x) => sin(x)));
      case 'COSINE': return color(per((x) => cos(x)));
      case 'TANGENT': return color(per((x) => tan(x)));
      case 'REFRACT': { const nn = safeNorm(b); return color(vec4(refract(a, nn, s) as TSLNode, ONE)); }
      case 'FACEFORWARD': return color(vec4(select(dot(c, b).lessThan(ZERO), a, a.negate() as TSLNode) as TSLNode, ONE));
      case 'MULTIPLY_ADD': return color(per((x, y, z) => x.mul(y).add(z)));
      default: throw new Error(`VectorMath: unsupported operation ${op}`);
    }
  },

  /* ---------------- ShaderNodeTexVoronoi (voronoi.glsl) ---------------- */
  ShaderNodeTexVoronoi: (n, input) => {
    const p = {
      scale: toScalar(input(1), 'Voronoi.scale'),
      randomness: toScalar(input(2), 'Voronoi.randomness'),
      smoothness: toScalar(input(3), 'Voronoi.smoothness'),
      exponent: toScalar(input(4), 'Voronoi.exponent'),
      metric: n.params.metric as 'EUCLIDEAN' | 'MANHATTAN' | 'CHEBYCHEV' | 'MINKOWSKI',
      feature: n.params.feature as 'F1' | 'SMOOTH_F1' | 'DISTANCE_TO_EDGE',
      dimensions: n.params.dimensions as '2D' | '3D',
    };
    // The Color output only exists for the features that have a winning CELL.
    // Distance To Edge has none, and Blender leaves its Color socket at zero
    // rather than inventing one, so asking for it is a caller error.
    if (n.params.output === 'color') {
      if (p.feature !== 'F1') {
        throw new Error(`[compile] Voronoi Color is only produced by F1, not ${p.feature}`);
      }
      return color(vec4(tslVoronoiColorF1(toVector(input(0)), p), ONE));
    }
    return scalar(tslVoronoiTex(toVector(input(0)), p));
  },

  /* ---------------- ShaderNodeTexWave (tex_wave.glsl) ---------------- */
  ShaderNodeTexWave: (n, input) => {
    const r = tslWaveTex3D(toVector(input(0)), {
      scale: toScalar(input(1), 'Wave.scale'),
      distortion: toScalar(input(2), 'Wave.distortion'),
      detail: n.params.detail as number,
      detailScale: toScalar(input(3), 'Wave.detailScale'),
      detailRoughness: n.params.detailRoughness as number,
      phase: toScalar(input(4), 'Wave.phase'),
      waveType: n.params.waveType as 'BANDS' | 'RINGS',
      bandsDirection: n.params.bandsDirection as 'X' | 'Y' | 'Z' | 'DIAGONAL',
      ringsDirection: n.params.ringsDirection as 'X' | 'Y' | 'Z' | 'SPHERICAL',
      waveProfile: n.params.waveProfile as 'SIN' | 'SAW' | 'TRI',
    });
    return n.params.output === 'color' ? color(r.color) : scalar(r.fac);
  },

  /* ---------------- ShaderNodeGamma (gamma.glsl) ----------------
   * Not simply pow(col, g): a channel at or below zero is left alone, which is
   * what stops a negative channel coming back NaN or sign-flipped. */
  ShaderNodeGamma: (_, input) => {
    const col = toVector(input(0));
    const g = toScalar(input(1), 'Gamma.gamma');
    const ch = (v: TSLNode) => select(v.greaterThan(ZERO), pow(max(v, float(1e-30)), g), v);
    return color(vec4(ch(col.x), ch(col.y), ch(col.z), ONE));
  },

  /* ---------------- ShaderNodeLayerWeight / ShaderNodeFresnel (fresnel.glsl) ---------------- */
  ShaderNodeLayerWeight: (n, input) => {
    const blend = toScalar(input(0), 'LayerWeight.blend');
    const cosVN = dot(positionViewDirection, normalView);
    const eta = max(ONE.sub(blend), float(0.00001));
    const etaF = select(frontFacing, ONE.div(eta), eta);
    if (n.params.output === 'facing') {
      let facing: TSLNode = abs(cosVN);
      const b = clamp(blend, ZERO, float(0.99999));
      const bb = select(b.lessThan(float(0.5)), b.mul(2), float(0.5).div(ONE.sub(b)));
      facing = select(blend.equal(float(0.5)), facing, pow(facing, bb));
      return scalar(ONE.sub(facing));
    }
    return scalar(fresnelDielectricCosTSL(cosVN, etaF));
  },
  ShaderNodeFresnel: (_, input) => {
    const ior = max(toScalar(input(0), 'Fresnel.ior'), float(0.00001));
    const cosVN = dot(positionViewDirection, normalView);
    return scalar(fresnelDielectricCosTSL(cosVN, select(frontFacing, ior, ONE.div(ior))));
  },

  /* ---------------- GraphMappingDynamic ----------------
   * Mapping whose location / rotation / scale are NODES, so the rotation matrix
   * has to be built per fragment instead of folded at compile time.
   *
   * euler_to_mat3 is Blender's own, XYZ order, and GLSL's mat3 is COLUMN major,
   * so the product is written out component by component rather than assembled
   * into a mat3 and multiplied: getting that convention backwards transposes the
   * rotation, which on a symmetric pattern looks almost right.
   */
  GraphMappingDynamic: (n, input) => {
    const v = toVector(input(0));
    const loc = toVector(input(1));
    const rot = toVector(input(2));
    const sc = toVector(input(3));
    const type = n.params.mappingType as MappingType;

    const cx = cos(rot.x), cy = cos(rot.y), cz = cos(rot.z);
    const sx = sin(rot.x), sy = sin(rot.y), sz = sin(rot.z);
    // columns of euler_to_mat3(rot)
    const c0 = vec3(cy.mul(cz), cy.mul(sz), sy.negate());
    const c1 = vec3(sy.mul(sx).mul(cz).sub(cx.mul(sz)), sy.mul(sx).mul(sz).add(cx.mul(cz)), cy.mul(sx));
    const c2 = vec3(sy.mul(cx).mul(cz).add(sx.mul(sz)), sy.mul(cx).mul(sz).sub(sx.mul(cz)), cy.mul(cx));
    const rotate = (u: TSLNode): TSLNode => c0.mul(u.x).add(c1.mul(u.y)).add(c2.mul(u.z));
    // the transpose, for the inverse directions
    const rotateT = (u: TSLNode): TSLNode =>
      vec3(dot(c0, u), dot(c1, u), dot(c2, u));

    const safeDiv = (a: TSLNode, b: TSLNode): TSLNode =>
      vec3(
        select(b.x.equal(ZERO), ZERO, a.x.div(b.x)),
        select(b.y.equal(ZERO), ZERO, a.y.div(b.y)),
        select(b.z.equal(ZERO), ZERO, a.z.div(b.z)),
      );

    switch (type) {
      case 'POINT':
        return vector(rotate(v.mul(sc)).add(loc));
      case 'TEXTURE':
        return vector(safeDiv(rotateT(v.sub(loc)), sc));
      case 'VECTOR':
        return vector(rotate(v.mul(sc)));
      case 'NORMAL':
        return vector(normalize(rotate(safeDiv(v, sc)) as TSLNode));
    }
  },

  /* ---------------- ShaderNodeMapping (mapping.glsl) ---------------- */
  ShaderNodeMapping: (n, input) => {
    const v = toVector(input(0));
    const type = n.params.mappingType as MappingType;
    const loc = n.params.location as [number, number, number];
    const rotE = n.params.rotation as [number, number, number];
    const sc = n.params.scale as [number, number, number];
    const m = eulerXYZToMat3(rotE); // row-major
    // TSL mat3 is column-major
    const R: TSLNode = mat3(vec3(m[0], m[3], m[6]), vec3(m[1], m[4], m[7]), vec3(m[2], m[5], m[8]));
    const RT: TSLNode = mat3(vec3(m[0], m[1], m[2]), vec3(m[3], m[4], m[5]), vec3(m[6], m[7], m[8]));
    const scaleV = vec3(sc[0], sc[1], sc[2]);
    const locV = vec3(loc[0], loc[1], loc[2]);
    const safeDiv = (a: TSLNode, b: TSLNode): TSLNode =>
      vec3(
        select(b.x.equal(ZERO), ZERO, a.x.div(b.x)),
        select(b.y.equal(ZERO), ZERO, a.y.div(b.y)),
        select(b.z.equal(ZERO), ZERO, a.z.div(b.z)),
      );
    switch (type) {
      case 'POINT':
        return vector(R.mul(v.mul(scaleV)).add(locV));
      case 'TEXTURE':
        return vector(safeDiv(RT.mul(v.sub(locV)), scaleV));
      case 'VECTOR':
        return vector(R.mul(v.mul(scaleV)));
      case 'NORMAL':
        return vector(normalize(R.mul(safeDiv(v, scaleV)) as TSLNode));
    }
  },

  GraphSeparate: (n, input) => scalar(toVector(input(0))[n.params.channel as string]),

  GraphCombine: (_, input) =>
    vector(
      vec3(
        toScalar(input(0), 'Combine.x'),
        toScalar(input(1), 'Combine.y'),
        toScalar(input(2), 'Combine.z'),
      ),
    ),

  GraphTime: () => scalar(time),
};

/**
 * Blender's compute_color_map_coordinate, in TSL. Half a texel in, scaled so a
 * coordinate of 1.0 lands on the CENTRE of the last texel. Sampling the raw fac
 * instead shifts the whole ramp by half a texel, invisible on a smooth ramp,
 * obvious on a hard-edged one.
 */
function rampCoord(fac: TSLNode): TSLNode {
  const scale = 1 - 1 / COLOR_RAMP_RESOLUTION;
  const offset = 0.5 / COLOR_RAMP_RESOLUTION;
  return clamp(fac, ZERO, ONE).mul(float(scale)).add(float(offset));
}

/**
 * The baked colour map, memoised per node so recompiling a graph does not leak
 * a texture per call. Float RGBA and LinearFilter because that is what Blender
 * samples; a byte texture would quantise a second time on top of the 257 steps.
 */
const RAMP_TEXTURES = new WeakMap<object, Texture>();

function rampTexture(
  node: object,
  stops: ColorStop[],
  interpolation: RampInterpolation,
): Texture {
  const cached = RAMP_TEXTURES.get(node);
  if (cached) return cached;

  const lut = bakeColorRamp(stops, interpolation);
  const data = new Float32Array(COLOR_RAMP_RESOLUTION * 4);
  lut.forEach((c, i) => data.set(c, i * 4));

  const tex = new DataTexture(data, COLOR_RAMP_RESOLUTION, 1, RGBAFormat, FloatType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  RAMP_TEXTURES.set(node, tex);
  return tex;
}

export const isEmittable = (type: string): boolean => type in EMITTERS;

/* ---------------- shared emitters (the compositor domain reuses these; same Blender semantics) ---------------- */

/** ShaderNodeMath as a bare TSL emitter: scalar in, scalar out. */
export function emitMath(op: string, a: TSLNode, b: TSLNode, c: TSLNode, useClamp = false): TSLNode {
  const fn = MATH_EMITTERS[op];
  if (!fn) throw new Error(`[compile] Math operation '${op}' not implemented`);
  const out = fn(a, b, c);
  return useClamp ? clamp(out, ZERO, ONE) : out;
}

/** Color Ramp as a bare TSL emitter, memoised per `key` (the owning node). */
export function emitColorRamp(key: object, stopsIn: ColorStop[], interpolation: RampInterpolation, fac: TSLNode): TSLNode {
  const stops = [...stopsIn].sort((a, b) => a.position - b.position);
  if (stops.length === 2) {
    const [a, b] = stops;
    const c1 = vec4(...a.color);
    const c2 = vec4(...b.color);
    if (interpolation === 'CONSTANT') return select(fac.greaterThan(float(b.position)), c2, c1);
    const span = b.position - a.position;
    const mul = span !== 0 ? 1 / span : 0;
    const t = clamp(fac.mul(float(mul)).add(float(-a.position * mul)), ZERO, ONE);
    const eased = interpolation === 'EASE' ? t.mul(t).mul(float(3).sub(t.mul(2))) : t;
    return mix(c1, c2, eased);
  }
  return texture(rampTexture(key, stops, interpolation), vec2(rampCoord(fac), float(0.5)));
}

/** Map Range (linear) as a bare TSL emitter with Blender's order-aware clamp. */
export function emitMapRange(
  value: TSLNode,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
  useClamp: boolean,
): TSLNode {
  const lo = Math.min(toMin, toMax);
  const hi = Math.max(toMin, toMax);
  if (fromMax === fromMin) return float(useClamp ? Math.min(hi, Math.max(lo, 0)) : 0);
  const t = value.sub(float(fromMin)).div(float(fromMax - fromMin));
  const out = float(toMin).add(t.mul(float(toMax - toMin)));
  return useClamp ? clamp(out, float(lo), float(hi)) : out;
}

/** Node types with an emitter, used by the parity test against the evaluator. */
export const emittableTypes = (): string[] => Object.keys(EMITTERS);

/**
 * Compile a graph to a TSL node.
 *
 * Shares the evaluator's memo strategy: a node reached by two paths emits once,
 * so a diamond does not duplicate its shared subtree into the shader.
 */
export function compile(target: NodeInput, cache = new Map<number, Emitted>()): Emitted {
  if (!isNode(target)) {
    return Array.isArray(target)
      ? color(vec4(target[0], target[1], target[2], target[3]))
      : scalar(float(target));
  }

  const hit = cache.get(target.id);
  if (hit) return hit;

  const fn = EMITTERS[target.type];
  if (!fn) {
    throw new Error(
      `[compile] no TSL emitter for '${target.type}'. Unsupported nodes must be ` +
        'declared, not guessed at.',
    );
  }

  const out = fn(target, (i) => compile(target.inputs[i], cache));
  cache.set(target.id, out);
  return out;
}

/**
 * Compile a graph into a material you can put on a mesh.
 *
 * MeshBasicNodeMaterial is the base because this system supplies its own
 * shading: lighting is a node in the graph, not something the renderer adds
 * behind your back.
 */
export interface CompileMaterialOptions {
  /** Alpha socket (scalar graph). Sets opacityNode; material becomes transparent unless alphaTest is given. */
  opacity?: NodeInput;
  /** Cut instead of blend: fragments with alpha below this are discarded. */
  alphaTest?: number;
}

/**
 * Compile a colour graph (and optionally an alpha graph) into a MeshBasicNodeMaterial.
 * Runtime uniforms (graph.uniform) are exposed on material.userData.uniforms.
 */
export function compileMaterial(target: NodeInput, options: CompileMaterialOptions = {}): MeshBasicNodeMaterial {
  activeUniforms = {};
  const out = compile(target);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = toVector(out);
  if (options.opacity !== undefined) {
    const a = compile(options.opacity);
    if (a.kind !== 'scalar') throw new Error('[compile] compileMaterial opacity must be a scalar graph');
    material.opacityNode = a.node;
    if (options.alphaTest !== undefined) material.alphaTest = options.alphaTest;
    else material.transparent = true;
  }
  material.userData.uniforms = activeUniforms;
  activeUniforms = {};
  return material;
}

/**
 * Compile a graph to a bare TSL node plus its runtime uniforms, for wiring into a socket of
 * ANY node material (a ShadowNodeMaterial's opacityNode, a MeshStandardNodeMaterial's
 * roughnessNode...). The material half of the graph stays a graph; only the plug is TSL.
 */
export function compileNode(target: NodeInput): { node: TSLNode; kind: Emitted['kind']; uniforms: Record<string, { value: number }> } {
  activeUniforms = {};
  const out = compile(target);
  const uniforms = activeUniforms;
  activeUniforms = {};
  return { node: out.node, kind: out.kind, uniforms };
}

/** The runtime uniforms of a compiled material, by name. */
export function materialUniforms(material: { userData: Record<string, unknown> }): Record<string, { value: number }> {
  return (material.userData.uniforms as Record<string, { value: number }>) ?? {};
}
