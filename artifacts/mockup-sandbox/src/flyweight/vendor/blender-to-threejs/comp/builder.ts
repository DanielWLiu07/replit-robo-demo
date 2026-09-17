/**
 * Authoring surface for compositor graphs.
 *
 * Same idea as the material builder: every method lands on a transcribed op in
 * comp-ops.ts (or reuses a shader op with identical semantics), so the
 * vocabulary has one correct meaning. Names mirror Blender's compositor nodes.
 *
 * Two kinds of node live here and it matters which is which:
 *  - per-pixel nodes (mix, math, ramp, hue/sat, ...) read their inputs at the
 *    same pixel they write; they compile to inline expressions
 *  - kernel nodes (filter, blur, displace) read their input at OTHER pixels;
 *    the backends materialise that input into a buffer first, exactly as
 *    Blender's compositor runs each such operation on its own result buffer
 */
import type { Texture } from 'three';
import type { ColorStop, RampInterpolation } from '../transpiler/blender-ops';
import type { MathOptions } from '../graph/builder';
import type { BlurFilterType, CompBlendType, CompMixFlags, FilterType } from './comp-ops';
import type { CompInput, CompNode, CompValue } from './types';

export type ImageFit = 'stretch' | 'tile';
export type CoordinateMode = 'normalized' | 'pixel' | 'uniform';
export type CompChannel = 'r' | 'g' | 'b' | 'a';

export interface CustomNodeSpec {
  /** Shown in reports; a custom node is never mistaken for a Blender one. */
  name: string;
  /** Output socket kind. */
  kind: 'color' | 'scalar';
  /**
   * CPU semantics. `inputs` are the evaluated input values at this pixel;
   * `ctx.x/y` is the FRAGMENT CENTRE (texel + 0.5, gl_FragCoord convention),
   * the same value the GPU twin receives as `ctx.px`.
   */
  cpu: (inputs: CompValue[], ctx: { x: number; y: number; width: number; height: number; time: number }) => CompValue;
  /**
   * GPU semantics: TSL nodes for the same inputs. `ctx.px` is screenCoordinate,
   * `ctx.uv` screenUV, `ctx.size` screenSize, `ctx.time` the time uniform.
   */
  tsl: (inputs: unknown[], ctx: { px: unknown; uv: unknown; size: unknown; time: unknown }) => unknown;
}

export class CompGraph {
  private nextId = 0;
  private readonly nodes: CompNode[] = [];

  private make(type: string, params: Record<string, unknown>, inputs: readonly CompInput[]): CompNode {
    const node: CompNode = { id: this.nextId++, type, params, inputs };
    this.nodes.push(node);
    return node;
  }

  /* ---------------- inputs ---------------- */

  /**
   * CompositorNodeRLayers. 'image' is the rendered scene, scene-linear with
   * alpha. 'position' is Blender's Position pass: world-space position per
   * pixel in rgb (the runtime renders it with an override material), alpha 1
   * where geometry exists.
   */
  renderLayer(pass: 'image' | 'position' = 'image'): CompNode {
    return this.make('CompositorNodeRLayers', { pass }, []);
  }

  /**
   * CompositorNodeImage. `stretch` maps the image over the whole frame;
   * `tile` repeats it at native pixel size (paper textures, hatch sheets).
   */
  image(map: Texture, fit: ImageFit = 'stretch'): CompNode {
    return this.make('CompositorNodeImage', { texture: map, fit }, []);
  }

  /** CompositorNodeValue: a float constant. */
  value(v: number): CompNode {
    return this.make('CompositorNodeValue', { value: v }, []);
  }

  /**
   * A float the application drives at runtime (grit, scroll, impact age).
   * Compiles to a TSL uniform; the compositor exposes it by name.
   */
  uniform(name: string, initial: number): CompNode {
    return this.make('CompositorNodeValue', { value: initial, uniform: name }, []);
  }

  /** CompositorNodeRGB: a colour constant (scene-linear). */
  rgb(r: number, g: number, b: number, a = 1): CompNode {
    return this.make('CompositorNodeRGB', { color: [r, g, b, a] }, []);
  }

  /** Seconds since start. Blender's Time node counts frames; here it is wall time. */
  time(): CompNode {
    return this.make('CompositorNodeTime', {}, []);
  }

  /**
   * CompositorNodeImageCoordinates: normalized (texel + 0.5) / size in [0,1],
   * pixel (integer texel), or uniform (centred, divided by the larger side,
   * times 2). Colour socket with xy in rg.
   */
  coords(mode: CoordinateMode = 'normalized'): CompNode {
    return this.make('CompositorNodeCoordinates', { mode }, []);
  }

  /* ---------------- per-pixel colour nodes ---------------- */

  /** CompositorNodeMixRGB. */
  mix(blend: CompBlendType, fac: CompInput, a: CompInput, b: CompInput, flags: CompMixFlags = {}): CompNode {
    return this.make('CompositorNodeMixRGB', { blend, useAlpha: Boolean(flags.useAlpha), clamp: Boolean(flags.clamp) }, [fac, a, b]);
  }
  blend = (fac: CompInput, a: CompInput, b: CompInput, f?: CompMixFlags) => this.mix('MIX', fac, a, b, f);
  multiply = (fac: CompInput, a: CompInput, b: CompInput, f?: CompMixFlags) => this.mix('MULTIPLY', fac, a, b, f);
  screen = (fac: CompInput, a: CompInput, b: CompInput, f?: CompMixFlags) => this.mix('SCREEN', fac, a, b, f);
  overlay = (fac: CompInput, a: CompInput, b: CompInput, f?: CompMixFlags) => this.mix('OVERLAY', fac, a, b, f);
  addColor = (fac: CompInput, a: CompInput, b: CompInput, f?: CompMixFlags) => this.mix('ADD', fac, a, b, f);
  subtractColor = (fac: CompInput, a: CompInput, b: CompInput, f?: CompMixFlags) => this.mix('SUBTRACT', fac, a, b, f);

  /** CompositorNodeMath: identical semantics to the shader Math node (blender-ops mathOps). */
  math(operation: string, a: CompInput, b: CompInput = 0, c: CompInput = 0, opts: MathOptions = {}): CompNode {
    return this.make('CompositorNodeMath', { operation, useClamp: Boolean(opts.clamp) }, [a, b, c]);
  }
  add = (a: CompInput, b: CompInput, o?: MathOptions) => this.math('ADD', a, b, 0, o);
  subtract = (a: CompInput, b: CompInput, o?: MathOptions) => this.math('SUBTRACT', a, b, 0, o);
  mul = (a: CompInput, b: CompInput, o?: MathOptions) => this.math('MULTIPLY', a, b, 0, o);
  divide = (a: CompInput, b: CompInput, o?: MathOptions) => this.math('DIVIDE', a, b, 0, o);
  power = (a: CompInput, b: CompInput, o?: MathOptions) => this.math('POWER', a, b, 0, o);
  greaterThan = (a: CompInput, b: CompInput, o?: MathOptions) => this.math('GREATER_THAN', a, b, 0, o);
  lessThan = (a: CompInput, b: CompInput, o?: MathOptions) => this.math('LESS_THAN', a, b, 0, o);
  smoothMin = (a: CompInput, b: CompInput, c: CompInput, o?: MathOptions) => this.math('SMOOTH_MIN', a, b, c, o);

  /** CompositorNodeValToRGB (Color Ramp), same baking rules as the shader ramp. */
  colorRamp(fac: CompInput, stops: readonly ColorStop[], interpolation: RampInterpolation = 'LINEAR'): CompNode {
    return this.make('CompositorNodeValToRGB', { stops: stops.map((s) => ({ ...s })), interpolation }, [fac]);
  }

  /** CompositorNodeSeparateColor (RGB mode): one channel as a float. */
  separate(color: CompInput, channel: CompChannel): CompNode {
    return this.make('CompositorNodeSeparateColor', { channel }, [color]);
  }

  /** CompositorNodeCombineColor (RGB mode). */
  combine(r: CompInput, g: CompInput, b: CompInput = 0, a: CompInput = 1): CompNode {
    return this.make('CompositorNodeCombineColor', {}, [r, g, b, a]);
  }

  /** CompositorNodeInvert. */
  invert(fac: CompInput, color: CompInput, opts: { color?: boolean; alpha?: boolean } = { color: true }): CompNode {
    return this.make('CompositorNodeInvert', { invertColor: opts.color !== false, invertAlpha: Boolean(opts.alpha) }, [fac, color]);
  }

  /** CompositorNodeHueSat: hue offset (0.5 = none), saturation and value multipliers, factor. */
  hueSat(color: CompInput, hue: CompInput = 0.5, saturation: CompInput = 1, value: CompInput = 1, fac: CompInput = 1): CompNode {
    return this.make('CompositorNodeHueSat', {}, [color, hue, saturation, value, fac]);
  }

  /** CompositorNodeBrightContrast: brightness in [-100,100], contrast in [-100,100]. */
  brightContrast(color: CompInput, brightness: CompInput = 0, contrast: CompInput = 0): CompNode {
    return this.make('CompositorNodeBrightContrast', {}, [color, brightness, contrast]);
  }

  gamma(color: CompInput, g: CompInput = 1): CompNode {
    return this.make('CompositorNodeGamma', {}, [color, g]);
  }

  exposure(color: CompInput, e: CompInput = 0): CompNode {
    return this.make('CompositorNodeExposure', {}, [color, e]);
  }

  posterize(color: CompInput, steps: CompInput = 8): CompNode {
    return this.make('CompositorNodePosterize', {}, [color, steps]);
  }

  /** CompositorNodeAlphaOver: foreground over background. */
  alphaOver(fac: CompInput, background: CompInput, foreground: CompInput, opts: { straightAlpha?: boolean } = {}): CompNode {
    return this.make('CompositorNodeAlphaOver', { straightAlpha: Boolean(opts.straightAlpha) }, [fac, background, foreground]);
  }

  setAlpha(color: CompInput, alpha: CompInput, mode: 'REPLACE_ALPHA' | 'APPLY' = 'REPLACE_ALPHA'): CompNode {
    return this.make('CompositorNodeSetAlpha', { mode }, [color, alpha]);
  }

  /** CompositorNodeRGBToBW: Rec.709 luminance. */
  luminance(color: CompInput): CompNode {
    return this.make('CompositorNodeRGBToBW', {}, [color]);
  }

  mapValue(value: CompInput, opts: { offset?: number; size?: number; min?: number; max?: number } = {}): CompNode {
    return this.make(
      'CompositorNodeMapValue',
      {
        offset: opts.offset ?? 0,
        size: opts.size ?? 1,
        useMin: opts.min !== undefined,
        min: opts.min ?? 0,
        useMax: opts.max !== undefined,
        max: opts.max ?? 1,
      },
      [value],
    );
  }

  /** CompositorNodeMapRange, linear, same op as the shader Map Range. */
  mapRange(value: CompInput, opts: { from: readonly [number, number]; to: readonly [number, number]; clamp?: boolean }): CompNode {
    return this.make(
      'CompositorNodeMapRange',
      { fromMin: opts.from[0], fromMax: opts.from[1], toMin: opts.to[0], toMax: opts.to[1], clamp: Boolean(opts.clamp) },
      [value],
    );
  }

  /* ---------------- kernel nodes (read neighbouring pixels) ---------------- */

  /** CompositorNodeFilter: 3x3 kernels, or edge magnitude for the edge filters. */
  filter(image: CompInput, type: FilterType, fac: CompInput = 1): CompNode {
    return this.make('CompositorNodeFilter', { filterType: type }, [image, fac]);
  }

  /**
   * CompositorNodeBlur, constant size in pixels. `separable` mirrors Blender's
   * "Separable" input (default ON in 4.5): two 1D passes with per-axis
   * normalised weights. Exact for GAUSS either way; for BOX/TENT the separable
   * form is what Blender itself produces by default, the 2D form is the true
   * disc/cone. Non-separable radius is capped at 16 to keep the shader finite.
   */
  blur(
    image: CompInput,
    size: readonly [number, number] | number,
    type: BlurFilterType = 'GAUSS',
    opts: { separable?: boolean } = {},
  ): CompNode {
    const s: [number, number] = typeof size === 'number' ? [size, size] : [size[0], size[1]];
    const separable = opts.separable ?? true;
    if (!separable && Math.max(s[0], s[1]) > 16) {
      throw new Error(`[comp] non-separable ${type} blur radius ${Math.max(s[0], s[1])} exceeds 16.`);
    }
    return this.make('CompositorNodeBlur', { size: s, filterType: type, separable }, [image]);
  }

  /**
   * CompositorNodeDisplace: sample `image` at this pixel minus `vector.xy` (in
   * pixels) times the scales.
   */
  displace(image: CompInput, vector: CompInput, xScale: CompInput = 1, yScale: CompInput = 1): CompNode {
    return this.make('CompositorNodeDisplace', {}, [image, vector, xScale, yScale]);
  }

  /* ---------------- escape hatch ---------------- */

  /**
   * A node that is NOT a Blender node (halftone dots, hatch lines). Per-pixel
   * only. Tagged 'custom' everywhere it is reported.
   */
  custom(spec: CustomNodeSpec, ...inputs: CompInput[]): CompNode {
    return this.make('Custom', { spec }, inputs);
  }

  get size(): number {
    return this.nodes.length;
  }
}

export const compGraph = (): CompGraph => new CompGraph();
