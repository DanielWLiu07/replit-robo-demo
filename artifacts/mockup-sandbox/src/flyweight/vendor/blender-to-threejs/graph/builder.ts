/**
 * The authoring surface, how a material gets written by hand.
 *
 * Why a builder at all, when TSL is already a node system: TSL is an open field.
 * Nothing stops you writing a `mix` that clamps where Blender's does not, or a
 * divide that returns Inf where Blender returns 0. Those are exactly the
 * mistakes that look right and are wrong. Every method here lands on an op in
 * blender-ops.ts that was checked against Blender's own GPU shader source, so
 * the vocabulary you author in has one correct meaning rather than a plausible
 * one.
 *
 * Naming mirrors Blender's nodes deliberately. A graph you build here and a
 * graph the exporter reads out of a .blend are the same structure, so the same
 * compiler, the same fidelity tags, and the same tests serve both.
 */
import type { Texture } from 'three';
import type { SketchLight } from '../primitives/eevee-lighting';
import { DEFAULT_LIGHTS } from '../primitives/eevee-lighting';
import type { ColorStop, MappingType, RampInterpolation, VectorMathOp, VoronoiFeature, VoronoiMetric } from '../transpiler/blender-ops';
import type { Color, GraphNode, NodeInput } from './types';

export type Space = 'world' | 'object';
export type Channel = 'x' | 'y' | 'z';

export interface MathOptions {
  /** Blender's "Clamp" checkbox: clamps the RESULT to [0,1]. */
  clamp?: boolean;
}

export interface MixOptions {
  /**
   * Clamps Fac to [0,1]. Independent of clampResult, Blender exposes these as
   * two separate checkboxes and conflating them is a classic porting bug.
   */
  clampFactor?: boolean;
  /** Clamps the output colour to [0,1]. */
  clampResult?: boolean;
}

export interface MapRangeOptions {
  from: readonly [number, number];
  to: readonly [number, number];
  /**
   * Blender clamps ORDER-AWARE between toMin and toMax, not to [0,1], so a
   * range like [4.56, -0.62] still clamps correctly. See mapRangeLinear.
   */
  clamp?: boolean;
}

export class Graph {
  private nextId = 0;
  private readonly nodes: GraphNode[] = [];

  private make(type: string, params: Record<string, unknown>, inputs: readonly NodeInput[]): GraphNode {
    const node: GraphNode = { id: this.nextId++, type, params, inputs };
    this.nodes.push(node);
    return node;
  }

  /* ---------------- inputs ---------------- */

  /**
   * A float the application drives at runtime (grow, time-like knobs). Compiles
   * to a TSL uniform; compileMaterial exposes it on material.userData.uniforms.
   * Evaluates to `initial` on the CPU.
   */
  uniform(name: string, initial: number): GraphNode {
    return this.make('ShaderNodeValue', { value: initial, uniform: name }, []);
  }

  /** ShaderNodeValue, a named float constant. */
  value(v: number): GraphNode {
    return this.make('ShaderNodeValue', { value: v }, []);
  }

  /** ShaderNodeRGB. Channels are LINEAR, straight from Blender; do not sRGB-encode. */
  rgb(r: number, g: number, b: number, a = 1): GraphNode {
    return this.make('ShaderNodeRGB', { color: [r, g, b, a] as Color }, []);
  }

  /* ---------------- ShaderNodeMath ---------------- */

  /**
   * The general Math node. `c` is only read by operations that take a third
   * input (MULTIPLY_ADD's addend, COMPARE's epsilon).
   */
  math(operation: string, a: NodeInput, b: NodeInput = 0, c: NodeInput = 0, opts: MathOptions = {}): GraphNode {
    return this.make('ShaderNodeMath', { operation, useClamp: Boolean(opts.clamp) }, [a, b, c]);
  }

  add = (a: NodeInput, b: NodeInput, o?: MathOptions) => this.math('ADD', a, b, 0, o);
  subtract = (a: NodeInput, b: NodeInput, o?: MathOptions) => this.math('SUBTRACT', a, b, 0, o);
  multiply = (a: NodeInput, b: NodeInput, o?: MathOptions) => this.math('MULTIPLY', a, b, 0, o);
  /** Blender's DIVIDE is safe_divide: b == 0 yields 0, never Inf or NaN. */
  divide = (a: NodeInput, b: NodeInput, o?: MathOptions) => this.math('DIVIDE', a, b, 0, o);
  multiplyAdd = (a: NodeInput, b: NodeInput, c: NodeInput, o?: MathOptions) =>
    this.math('MULTIPLY_ADD', a, b, c, o);
  /** epsilon defaults to Blender's floor of 1e-5. */
  compare = (a: NodeInput, b: NodeInput, epsilon: NodeInput = 1e-5, o?: MathOptions) =>
    this.math('COMPARE', a, b, epsilon, o);
  greaterThan = (a: NodeInput, b: NodeInput, o?: MathOptions) => this.math('GREATER_THAN', a, b, 0, o);
  lessThan = (a: NodeInput, b: NodeInput, o?: MathOptions) => this.math('LESS_THAN', a, b, 0, o);
  pingpong = (a: NodeInput, scale: NodeInput, o?: MathOptions) => this.math('PINGPONG', a, scale, 0, o);

  /* Blender guards several of these against their undefined domains: SQRT and
   * LOGARITHM return 0 rather than NaN, POWER handles a negative base, and
   * MODULO truncates toward zero instead of flooring. Reach for these rather
   * than doing the arithmetic by hand. */
  sin = (a: NodeInput) => this.math('SINE', a);
  cos = (a: NodeInput) => this.math('COSINE', a);
  tan = (a: NodeInput) => this.math('TANGENT', a);
  floor = (a: NodeInput) => this.math('FLOOR', a);
  ceil = (a: NodeInput) => this.math('CEIL', a);
  round = (a: NodeInput) => this.math('ROUND', a);
  trunc = (a: NodeInput) => this.math('TRUNC', a);
  fract = (a: NodeInput) => this.math('FRACT', a);
  abs = (a: NodeInput) => this.math('ABSOLUTE', a);
  sign = (a: NodeInput) => this.math('SIGN', a);
  sqrt = (a: NodeInput) => this.math('SQRT', a);
  exp = (a: NodeInput) => this.math('EXPONENT', a);
  log = (a: NodeInput, base: NodeInput = Math.E) => this.math('LOGARITHM', a, base);
  pow = (a: NodeInput, b: NodeInput) => this.math('POWER', a, b);
  min = (a: NodeInput, b: NodeInput) => this.math('MINIMUM', a, b);
  max = (a: NodeInput, b: NodeInput) => this.math('MAXIMUM', a, b);
  mod = (a: NodeInput, b: NodeInput) => this.math('MODULO', a, b);
  snap = (a: NodeInput, increment: NodeInput) => this.math('SNAP', a, increment);
  wrap = (a: NodeInput, hi: NodeInput, lo: NodeInput) => this.math('WRAP', a, hi, lo);
  smoothMin = (a: NodeInput, b: NodeInput, distance: NodeInput) =>
    this.math('SMOOTH_MIN', a, b, distance);
  smoothMax = (a: NodeInput, b: NodeInput, distance: NodeInput) =>
    this.math('SMOOTH_MAX', a, b, distance);
  atan2 = (y: NodeInput, x: NodeInput) => this.math('ARCTAN2', y, x);

  /* ---------------- ShaderNodeMix (RGBA) ---------------- */

  mix(blendType: string, fac: NodeInput, a: NodeInput, b: NodeInput, opts: MixOptions = {}): GraphNode {
    return this.make(
      'ShaderNodeMix',
      {
        blendType,
        clampFactor: Boolean(opts.clampFactor),
        clampResult: Boolean(opts.clampResult),
      },
      [fac, a, b],
    );
  }

  blend = (fac: NodeInput, a: NodeInput, b: NodeInput, o?: MixOptions) => this.mix('MIX', fac, a, b, o);
  multiplyColor = (fac: NodeInput, a: NodeInput, b: NodeInput, o?: MixOptions) =>
    this.mix('MULTIPLY', fac, a, b, o);
  /** Branches per channel on a < 0.5, and has NO built-in result clamp. */
  overlay = (fac: NodeInput, a: NodeInput, b: NodeInput, o?: MixOptions) => this.mix('OVERLAY', fac, a, b, o);

  /* ---------------- ShaderNodeMapRange ---------------- */

  mapRange(value: NodeInput, opts: MapRangeOptions): GraphNode {
    return this.make(
      'ShaderNodeMapRange',
      {
        fromMin: opts.from[0],
        fromMax: opts.from[1],
        toMin: opts.to[0],
        toMax: opts.to[1],
        clamp: Boolean(opts.clamp),
      },
      [value],
    );
  }

  /* ---------------- ShaderNodeValToRGB (Color Ramp) ---------------- */

  /**
   * Blender's Color Ramp.
   *
   * Two stops take an exact fast path. Three or more are baked into a 257-texel
   * map and sampled with linear filtering, quantised, exactly as Blender does
   * it. Evaluating a many-stop ramp exactly would be more accurate and
   * therefore wrong: it would not match the render you are trying to reproduce.
   */
  colorRamp(
    fac: NodeInput,
    stops: ColorStop[],
    interpolation: RampInterpolation = 'LINEAR',
  ): GraphNode {
    if (stops.length < 2) {
      throw new Error('[graph] a Color Ramp needs at least two stops');
    }
    return this.make('ShaderNodeValToRGB', { stops, interpolation }, [fac]);
  }

  /* ---------------- ShaderNodeInvert ---------------- */

  /** mix(colour, 1 - colour, fac) on RGB; alpha is untouched. */
  invert(fac: NodeInput, color: NodeInput): GraphNode {
    return this.make('ShaderNodeInvert', {}, [fac, color]);
  }

  /* ---------------- varying inputs ----------------
   * These differ per fragment, so they have no CPU value, evaluating a graph
   * that reaches one is an error, not a number. Everything above this line can
   * still be constant-folded.
   */

  /** The mesh's UVs, as a vector with z = 0 so it composes with the vector ops. */
  uv(): GraphNode {
    return this.make('GraphUV', {}, []);
  }

  /**
   * Texture Coordinate > Window: the fragment's screen position as 0..1 UV (x right, y up),
   * z = 0. Camera-independent screen-space effects (frame-edge cuts, vignettes) belong here.
   */
  window(): GraphNode {
    return this.make('GraphWindow', {}, []);
  }

  /** Surface position. World space by default. */
  position(space: Space = 'world'): GraphNode {
    return this.make('GraphPosition', { space }, []);
  }

  /** Surface normal. World space by default. */
  normal(space: Space = 'world'): GraphNode {
    return this.make('GraphNormal', { space }, []);
  }

  /**
   * Per-vertex colour, Blender's Color Attribute node.
   *
   * Reads opaque white on a mesh with no colour attribute, the same way Blender
   * reads an absent layer, so a graph that multiplies by this still shows the
   * unpainted mesh rather than turning it black.
   */
  vertexColor(layer = 0): GraphNode {
    return this.make('GraphVertexColor', { layer }, []);
  }

  /**
   * Blender's implicit Colour -> Float conversion (`rgbtobw`), Rec.709
   * luminance: dot(rgb, (0.2126, 0.7152, 0.0722)).
   *
   * This exists because the compiler REFUSES to guess a reduction when a colour
   * is linked to a float socket, and Blender does not refuse: it inserts this.
   * So a faithful port of any graph that links a Color output into a Color Ramp
   * Fac, a Mix Factor or a Math input has to say this explicitly. Taking one
   * channel instead is only equivalent when the value is already greyscale, and
   * a Voronoi cell colour is three different hashes.
   */
  rgbToBw(color: NodeInput): GraphNode {
    return this.add(
      this.add(this.multiply(this.separate(color, 'x'), 0.2126), this.multiply(this.separate(color, 'y'), 0.7152)),
      this.multiply(this.separate(color, 'z'), 0.0722),
    );
  }

  /**
   * Take one component out of a vector. Blender splits this across
   * SeparateXYZ/SeparateColor with three outputs each; a single-output node is
   * the same operation and keeps every node in this graph to one result.
   */
  separate(vector: NodeInput, channel: Channel): GraphNode {
    return this.make('GraphSeparate', { channel }, [vector]);
  }

  /** Build a vector from components, the inverse of separate. */
  combine(x: NodeInput, y: NodeInput, z: NodeInput = 0): GraphNode {
    return this.make('GraphCombine', {}, [x, y, z]);
  }

  /** Seconds since start. */
  time(): GraphNode {
    return this.make('GraphTime', {}, []);
  }

  /** Sample a texture. Leave coords off and it uses the mesh UVs. */
  texture(map: Texture, coords?: NodeInput): GraphNode {
    return this.make('GraphTexture', { texture: map }, coords === undefined ? [] : [coords]);
  }

  /* ---------------- ShaderNodeTexNoise (fBM, 3D) ---------------- */

  /**
   * Blender's Noise Texture, 3D fBM type. `vector` defaults to object-space
   * position (Blender's Generated coordinates, un-normalised). Scale may be a
   * node; detail, roughness, lacunarity, distortion are constants (the octave
   * loop is unrolled at compile time). `output` picks Fac or Color.
   */
  /**
   * Wave Texture (ShaderNodeTexWave): bands or rings, sine / saw / triangle.
   * This is the node that draws hatching LINES, so it is the one the manga
   * shader pack leans on hardest.
   */
  wave(
    vector: NodeInput | undefined,
    opts: {
      scale?: NodeInput;
      distortion?: NodeInput;
      detail?: number;
      detailScale?: NodeInput;
      detailRoughness?: number;
      phase?: NodeInput;
      waveType?: 'BANDS' | 'RINGS';
      bandsDirection?: 'X' | 'Y' | 'Z' | 'DIAGONAL';
      ringsDirection?: 'X' | 'Y' | 'Z' | 'SPHERICAL';
      waveProfile?: 'SIN' | 'SAW' | 'TRI';
      output?: 'fac' | 'color';
    } = {},
  ): GraphNode {
    const v = vector ?? this.position('object');
    return this.make(
      'ShaderNodeTexWave',
      {
        detail: opts.detail ?? 2,
        detailRoughness: opts.detailRoughness ?? 0.5,
        waveType: opts.waveType ?? 'BANDS',
        bandsDirection: opts.bandsDirection ?? 'X',
        ringsDirection: opts.ringsDirection ?? 'X',
        waveProfile: opts.waveProfile ?? 'SIN',
        output: opts.output ?? 'fac',
      },
      [v, opts.scale ?? 5, opts.distortion ?? 0, opts.detailScale ?? 1, opts.phase ?? 0],
    );
  }

  /** Gamma (ShaderNodeGamma). Channels at or below zero pass through untouched. */
  gamma(color: NodeInput, g: NodeInput = 1): GraphNode {
    return this.make('ShaderNodeGamma', {}, [color, g]);
  }

  /**
   * Vector Math (ShaderNodeVectorMath). Ops returning a scalar (DOT_PRODUCT,
   * DISTANCE, LENGTH) come out on the Value socket; everything else on Vector.
   */
  vectorMath(
    operation: VectorMathOp,
    a: NodeInput,
    b: NodeInput = [0, 0, 0, 1],
    c: NodeInput = [0, 0, 0, 1],
    opts: { scale?: NodeInput; output?: 'vector' | 'value' } = {},
  ): GraphNode {
    return this.make('ShaderNodeVectorMath', { operation, output: opts.output ?? 'vector' }, [a, b, c, opts.scale ?? 1]);
  }

  /**
   * Voronoi Texture (ShaderNodeTexVoronoi), Distance output. Only the feature
   * and dimension combinations that are implemented are accepted; the rest
   * throw rather than silently returning a different pattern.
   */
  voronoi(
    vector: NodeInput | undefined,
    opts: {
      scale?: NodeInput;
      randomness?: NodeInput;
      smoothness?: NodeInput;
      exponent?: NodeInput;
      metric?: VoronoiMetric;
      feature?: VoronoiFeature;
      dimensions?: '2D' | '3D';
      /**
       * Which socket to read. 'distance' is the default and the only one every
       * feature has; 'color' is the winning cell's random colour and exists only
       * for F1, because Distance To Edge has no cell to colour and Blender
       * leaves that socket at zero rather than inventing one.
       */
      output?: 'distance' | 'color';
    } = {},
  ): GraphNode {
    return this.make(
      'ShaderNodeTexVoronoi',
      {
        metric: opts.metric ?? 'EUCLIDEAN',
        feature: opts.feature ?? 'F1',
        dimensions: opts.dimensions ?? '3D',
        output: opts.output ?? 'distance',
      },
      [vector ?? this.position('object'), opts.scale ?? 5, opts.randomness ?? 1, opts.smoothness ?? 1, opts.exponent ?? 0.5],
    );
  }

  /**
   * Diffuse BSDF (ShaderNodeBsdfDiffuse), fidelity: APPROXIMATE.
   *
   * There are no shader closures in this domain, so this is not a BSDF: it is
   * Lambert against a light set, albedo * sum(N.L * energy) / PI + ambient, which
   * is what EEVEE's diffuse reduces to and what Shader to RGB would read off it.
   * `lights` is part of the graph because a diffuse node means nothing without
   * the rig it sits in, and the ramps downstream of one are always calibrated
   * against a PARTICULAR rig's output range.
   */
  diffuseBsdf(
    color: NodeInput = [0.8, 0.8, 0.8, 1],
    opts: { roughness?: number; lights?: readonly SketchLight[]; worldAmbient?: number } = {},
  ): GraphNode {
    return this.make(
      'ShaderNodeBsdfDiffuse',
      {
        roughness: opts.roughness ?? 0,
        lights: opts.lights ?? DEFAULT_LIGHTS,
        worldAmbient: opts.worldAmbient ?? 0.05,
      },
      [color],
    );
  }

  /**
   * Shader to RGB (ShaderNodeShaderToRGB), fidelity: APPROXIMATE.
   *
   * In Blender this collapses a shader closure to a colour, which is what makes
   * the toon workflow possible at all. Here the "closure" already IS a colour,
   * so it passes through: the node exists so a transpiled graph keeps its shape
   * and so the fidelity is stated rather than silently dropped.
   */
  shaderToRgb(shader: NodeInput): GraphNode {
    return this.make('ShaderNodeShaderToRGB', {}, [shader]);
  }

  noise(
    vector: NodeInput | undefined,
    opts: {
      scale?: NodeInput;
      detail?: number;
      roughness?: number;
      lacunarity?: number;
      distortion?: number;
      normalize?: boolean;
      output?: 'fac' | 'color';
    } = {},
  ): GraphNode {
    const v = vector ?? this.position('object');
    return this.make(
      'ShaderNodeTexNoise',
      {
        detail: opts.detail ?? 2,
        roughness: opts.roughness ?? 0.5,
        lacunarity: opts.lacunarity ?? 2,
        distortion: opts.distortion ?? 0,
        normalize: opts.normalize ?? true,
        output: opts.output ?? 'fac',
      },
      [v, opts.scale ?? 5],
    );
  }

  /* ---------------- ShaderNodeLayerWeight / ShaderNodeFresnel ---------------- */

  /** Layer Weight: `blend` in [0,1], output 'fresnel' or 'facing'. Uses the shading normal and the view vector. */
  layerWeight(blend: NodeInput = 0.5, output: 'fresnel' | 'facing' = 'fresnel'): GraphNode {
    return this.make('ShaderNodeLayerWeight', { output }, [blend]);
  }

  /** Fresnel node: dielectric reflectance for `ior`. */
  fresnel(ior: NodeInput = 1.45): GraphNode {
    return this.make('ShaderNodeFresnel', {}, [ior]);
  }

  /* ---------------- ShaderNodeMapping ---------------- */

  /** Mapping node: location / rotation (XYZ euler, radians) / scale, all constants; type per Blender. */
  mapping(
    vector: NodeInput,
    opts: { type?: MappingType; location?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] } = {},
  ): GraphNode {
    return this.make(
      'ShaderNodeMapping',
      {
        mappingType: opts.type ?? 'POINT',
        location: opts.location ?? [0, 0, 0],
        rotation: opts.rotation ?? [0, 0, 0],
        scale: opts.scale ?? [1, 1, 1],
      },
      [vector],
    );
  }

  /**
   * Mapping with DRIVEN inputs: location, rotation and scale may each be a node.
   *
   * Separate from `mapping` because the constant form folds its rotation into a
   * compile-time matrix, and a driven one cannot. It exists because real shaders
   * drive it: his patch-hatching graph feeds a Voronoi cell's random colour into
   * a Mapping rotation so every patch gets its own hatch angle. With a constant
   * rotation every patch runs the same way and the shader reads as one flat
   * hatch, which is not a subtle difference.
   *
   * Blender applies POINT as `euler_to_mat3(rotation) * (vector * scale) + location`.
   */
  mappingDynamic(
    vector: NodeInput,
    opts: { type?: MappingType; location?: NodeInput; rotation?: NodeInput; scale?: NodeInput } = {},
  ): GraphNode {
    return this.make(
      'GraphMappingDynamic',
      { mappingType: opts.type ?? 'POINT' },
      [vector, opts.location ?? 0, opts.rotation ?? 0, opts.scale ?? 1],
    );
  }

  /**
   * Texture Coordinate > Generated, fidelity: EXACT given the right bounds.
   *
   * Blender's Generated (the "orco" attribute) is the OBJECT-space position
   * normalised into the object's own bounding box: (P - min) / (max - min). It
   * is per-OBJECT, so two parts of one model get two different normalisations
   * and therefore two different patterns; passing one part's bounds to both is a
   * real error that looks like a texture scale being slightly off.
   *
   * The bounds are given rather than discovered because a material is built
   * before it is put on a mesh. Give them in the SAME space the geometry is in.
   * A glTF export has swapped the axes (Blender (x,y,z) -> (x, z, -y)), so
   * bounds read out of Blender have to be swapped to match, or the geometry
   * un-swapped to match them.
   *
   * Composed from Position and arithmetic rather than added as an emitter,
   * because that is all Blender does and a node that only rearranges existing
   * ones should not become a new thing to keep faithful.
   */
  generated(min: [number, number, number], max: [number, number, number]): GraphNode {
    const p = this.position('object');
    const axis = (ch: Channel, i: number): NodeInput => {
      const span = max[i] - min[i];
      // a flat object has a zero span on that axis; Blender's orco divides by
      // the box size and a degenerate axis simply reads 0 rather than NaN
      if (Math.abs(span) < 1e-12) return 0;
      return this.divide(this.subtract(this.separate(p, ch), min[i]), span);
    };
    return this.combine(axis('x', 0), axis('y', 1), axis('z', 2));
  }

  get size(): number {
    return this.nodes.length;
  }
}

export const graph = (): Graph => new Graph();
