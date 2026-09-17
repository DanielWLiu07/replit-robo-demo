/**
 * TSL emission for compositor graphs.
 *
 * Execution model. Blender runs each compositor operation on its own result
 * buffer; a Blur reads its input buffer at many texels. We do the same, in the
 * only place it matters: kernel nodes (Filter, Blur, Displace) MATERIALISE
 * their input into a render target ("stage") and sample it with texel
 * semantics; everything else stays an inline expression, evaluated at whatever
 * coordinate the consumer asks for. So an emitted socket is a closure over uv,
 * `at(uv) -> node`, and a stage is "render this closure at screenUV into this
 * target".
 *
 * Stages come out in dependency order (an input is compiled before the kernel
 * that taps it), which is the order the runtime renders them.
 *
 * Every per-pixel node here mirrors the same-named function in comp-ops.ts;
 * the parity test pins that both backends know every node type.
 */
import { ClampToEdgeWrapping, HalfFloatType, LinearFilter, RenderTarget, RepeatWrapping, Texture } from 'three';
import {
  Fn,
  clamp,
  dot,
  exp2,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  pow,
  screenSize,
  screenUV,
  select,
  sqrt,
  texture,
  textureSize,
  time as tslTime,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { ColorStop, RampInterpolation, Vec4 } from '../transpiler/blender-ops';
import { emitColorRamp, emitMapRange, emitMath, type TSLNode } from '../graph/compile';
import {
  FILTER_KERNELS,
  LUMINANCE_REC709,
  blurWeights,
  blurWeights1D,
  isEdgeFilter,
  type BlurFilterType,
  type CompBlendType,
  type FilterType,
} from './comp-ops';
import type { CustomNodeSpec } from './builder';
import { isCompColor, isCompNode, type CompInput, type CompNode } from './types';

export type CompKind = 'color' | 'scalar';

/** An emitted socket: a closure from screen uv to a TSL value. */
export interface CompEmit {
  kind: CompKind;
  at: (uv: TSLNode) => TSLNode;
}

/** A materialisation step: render `node` (a vec4 over screenUV) into `target`. */
export interface CompStage {
  name: string;
  node: TSLNode;
  target: RenderTarget;
}

export interface CompiledComp {
  /** The final vec4 over screenUV. */
  output: TSLNode;
  stages: CompStage[];
  /** Runtime-driven floats by name (from compGraph.uniform). */
  uniforms: Record<string, TSLNode & { value: number }>;
}

export interface CompCompileOptions {
  /** The scene render for CompositorNodeRLayers 'image'. */
  sceneTexture: Texture;
  /** World position per pixel for CompositorNodeRLayers 'position'. */
  positionTexture?: Texture;
  /** Set by the emitter when the graph reads the position pass. */
  onUsesPosition?: () => void;
}

const ZERO = float(0);
const ONE = float(1);

const toColor = (e: CompEmit, uv: TSLNode): TSLNode => {
  const v = e.at(uv);
  return e.kind === 'color' ? v : vec4(v, v, v, ONE);
};
const toScalar = (e: CompEmit, uv: TSLNode, where: string): TSLNode => {
  if (e.kind === 'color') throw new Error(`[comp] ${where} received a colour where a float was expected; take a channel explicitly.`);
  return e.at(uv);
};

const constColor = (c: Vec4) => vec4(c[0], c[1], c[2], c[3]);

/** A fresh screen-sized target; the runtime resizes it. Linear + clamp gives texel_load semantics at texel centres. */
function makeTarget(name: string): RenderTarget {
  const rt = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  rt.texture.name = name;
  rt.texture.minFilter = LinearFilter;
  rt.texture.magFilter = LinearFilter;
  rt.texture.wrapS = ClampToEdgeWrapping;
  rt.texture.wrapT = ClampToEdgeWrapping;
  rt.texture.generateMipmaps = false;
  return rt;
}

/* ---------------- colour helpers, transcribed (see comp-ops for the CPU twins) ---------------- */

const rgbToHsv = Fn(([c]: [TSLNode]) => {
  const cmax = max(c.x, max(c.y, c.z));
  const cmin = min(c.x, min(c.y, c.z));
  const cdelta = cmax.sub(cmin);
  const v = cmax;
  const s = select(cmax.notEqual(ZERO), cdelta.div(cmax), ZERO);
  const cc = vec3(cmax).sub(c.xyz).div(max(cdelta, float(1e-20)));
  const hR = cc.z.sub(cc.y);
  const hG = float(2).add(cc.x).sub(cc.z);
  const hB = float(4).add(cc.y).sub(cc.x);
  let h = select(c.x.equal(cmax), hR, select(c.y.equal(cmax), hG, hB)).div(6);
  h = select(h.lessThan(ZERO), h.add(1), h);
  h = select(s.equal(ZERO), ZERO, h);
  return vec4(h, s, v, c.w);
});

const hsvToRgb = Fn(([hsv]: [TSLNode]) => {
  const s = hsv.y;
  const v = hsv.z;
  let h = select(hsv.x.equal(ONE), ZERO, hsv.x).mul(6);
  const i = floor(h);
  const f = h.sub(i);
  const p = v.mul(ONE.sub(s));
  const q = v.mul(ONE.sub(s.mul(f)));
  const t = v.mul(ONE.sub(s.mul(ONE.sub(f))));
  let rgb: TSLNode = vec3(v, p, q);
  rgb = select(i.equal(float(4)), vec3(t, p, v), rgb);
  rgb = select(i.equal(float(3)), vec3(p, q, v), rgb);
  rgb = select(i.equal(float(2)), vec3(p, v, t), rgb);
  rgb = select(i.equal(ONE), vec3(q, v, p), rgb);
  rgb = select(i.equal(ZERO), vec3(v, t, p), rgb);
  rgb = select(s.equal(ZERO), vec3(v, v, v), rgb);
  return vec4(rgb, hsv.w);
});

const luma = (c: TSLNode) => dot(c.xyz, vec3(...LUMINANCE_REC709));

const fallbackPow = (a: TSLNode, b: TSLNode) => select(a.greaterThan(ZERO), pow(a, b), a);

function mixRgbTSL(blend: CompBlendType, facIn: TSLNode, col1: TSLNode, col2: TSLNode, useAlpha: boolean, doClamp: boolean): TSLNode {
  const f = useAlpha ? facIn.mul(col2.w) : facIn;
  const facm = ONE.sub(f);
  let rgb: TSLNode;
  const c1 = col1.xyz;
  const c2 = col2.xyz;
  switch (blend) {
    case 'MIX':
      rgb = mix(c1, c2, f);
      break;
    case 'ADD':
      rgb = c1.add(c2.mul(f));
      break;
    case 'MULTIPLY':
      rgb = mix(c1, c1.mul(c2), f);
      break;
    case 'SUBTRACT':
      rgb = c1.sub(c2.mul(f));
      break;
    case 'SCREEN':
      rgb = vec3(1).sub(vec3(facm).add(vec3(1).sub(c2).mul(f)).mul(vec3(1).sub(c1)));
      break;
    case 'OVERLAY': {
      const ch = (a: TSLNode, b: TSLNode): TSLNode =>
        select(a.lessThan(float(0.5)), a.mul(facm.add(b.mul(f).mul(2))), ONE.sub(facm.add(ONE.sub(b).mul(f).mul(2)).mul(ONE.sub(a))));
      rgb = vec3(ch(c1.x, c2.x), ch(c1.y, c2.y), ch(c1.z, c2.z));
      break;
    }
    case 'DIVIDE': {
      const ch = (a: TSLNode, b: TSLNode): TSLNode => select(b.notEqual(ZERO), facm.mul(a).add(f.mul(a).div(b)), ZERO);
      rgb = vec3(ch(c1.x, c2.x), ch(c1.y, c2.y), ch(c1.z, c2.z));
      break;
    }
    default:
      throw new Error(`[comp] MixRGB blend type '${blend}' is not transcribed yet; refusing to guess.`);
  }
  let out: TSLNode = vec4(rgb, col1.w);
  if (doClamp) out = clamp(out, vec4(0), vec4(1));
  return out;
}

export function compileComp(target: CompInput, opts: CompCompileOptions): CompiledComp {
  const memo = new Map<number, CompEmit>();
  const stages: CompStage[] = [];
  const uniforms: Record<string, TSLNode & { value: number }> = {};

  /**
   * Render `e` into a stage and return a closure that samples that stage.
   * Memoised per emitted socket: twelve Displace nodes tapping the same input
   * share one buffer, the way Blender shares one result between consumers.
   */
  interface Sampler {
    (uv: TSLNode): TSLNode;
    /** one texel of THIS stage's texture (not the current viewport): exact when the internal render scale differs from the canvas */
    texel: TSLNode;
  }
  const materialized = new Map<CompEmit, Sampler>();
  const materialize = (e: CompEmit, name: string): Sampler => {
    const hit = materialized.get(e);
    if (hit) return hit;
    const rt = makeTarget(name);
    stages.push({ name, node: toColor(e, screenUV), target: rt });
    const sampler = ((uv: TSLNode) => texture(rt.texture, uv)) as Sampler;
    sampler.texel = vec2(1).div(vec2(textureSize(texture(rt.texture)) as TSLNode));
    materialized.set(e, sampler);
    return sampler;
  };

  const em = (input: CompInput): CompEmit => {
    if (!isCompNode(input)) {
      return isCompColor(input) ? { kind: 'color', at: () => constColor(input) } : { kind: 'scalar', at: () => float(input) };
    }
    const hit = memo.get(input.id);
    if (hit) return hit;
    const raw = emitNode(input);
    // Memoise per uv object: a socket read by several consumers at the same
    // coordinate must become ONE TSL subtree, or a shared upstream (three
    // channels of the same density image, say) is re-emitted per consumer and
    // the shader grows exponentially. TSL emits a shared node object once.
    const perUv = new Map<TSLNode, TSLNode>();
    const out: CompEmit = {
      kind: raw.kind,
      at: (uv) => {
        const cached = perUv.get(uv);
        if (cached) return cached;
        const node = raw.at(uv);
        perUv.set(uv, node);
        return node;
      },
    };
    memo.set(input.id, out);
    return out;
  };

  const emitNode = (node: CompNode): CompEmit => {
    const p = node.params;
    const ins = node.inputs.map(em);
    const color = (at: (uv: TSLNode) => TSLNode): CompEmit => ({ kind: 'color', at });
    const scalar = (at: (uv: TSLNode) => TSLNode): CompEmit => ({ kind: 'scalar', at });

    switch (node.type) {
      case 'CompositorNodeRLayers':
        if (p.pass === 'position') {
          if (!opts.positionTexture) throw new Error('[comp] compile: graph reads the position pass but no positionTexture was provided');
          opts.onUsesPosition?.();
          const pt = opts.positionTexture;
          return color((uv) => texture(pt, uv));
        }
        return color((uv) => texture(opts.sceneTexture, uv));
      case 'CompositorNodeImage': {
        const tex = p.texture as Texture;
        if (p.fit === 'tile') {
          tex.wrapS = RepeatWrapping;
          tex.wrapT = RepeatWrapping;
          return color((uv) => {
            const tn: TSLNode = texture(tex);
            const ts: TSLNode = vec2(textureSize(tn) as TSLNode);
            return texture(tex, uv.mul(screenSize).div(ts));
          });
        }
        return color((uv) => texture(tex, uv));
      }
      case 'CompositorNodeValue': {
        const name = p.uniform as string | undefined;
        if (name) {
          const u = uniforms[name] ?? (uniforms[name] = uniform(p.value as number));
          return scalar(() => u);
        }
        return scalar(() => float(p.value as number));
      }
      case 'CompositorNodeRGB':
        return color(() => constColor(p.color as Vec4));
      case 'CompositorNodeTime':
        return scalar(() => tslTime);
      case 'CompositorNodeCoordinates': {
        const mode = p.mode as string;
        return color((uv) => {
          if (mode === 'pixel') return vec4(floor(uv.mul(screenSize)) as TSLNode, ZERO, ZERO);
          if (mode === 'uniform') {
            const maxSize = max(screenSize.x, screenSize.y);
            const centred = uv.mul(screenSize).sub(screenSize.div(2));
            return vec4(centred.div(maxSize).mul(2), ZERO, ZERO);
          }
          return vec4(uv, ZERO, ZERO);
        });
      }

      /* per-pixel */
      case 'CompositorNodeMixRGB':
        return color((uv) =>
          mixRgbTSL(
            p.blend as CompBlendType,
            toScalar(ins[0], uv, 'Mix.fac'),
            toColor(ins[1], uv),
            toColor(ins[2], uv),
            p.useAlpha as boolean,
            p.clamp as boolean,
          ),
        );
      case 'CompositorNodeMath':
        return scalar((uv) =>
          emitMath(
            p.operation as string,
            toScalar(ins[0], uv, 'Math.a'),
            toScalar(ins[1], uv, 'Math.b'),
            toScalar(ins[2], uv, 'Math.c'),
            p.useClamp as boolean,
          ),
        );
      case 'CompositorNodeValToRGB':
        return color((uv) => emitColorRamp(node, p.stops as ColorStop[], p.interpolation as RampInterpolation, toScalar(ins[0], uv, 'ColorRamp.fac')));
      case 'CompositorNodeSeparateColor': {
        const ch = { r: 'x', g: 'y', b: 'z', a: 'w' }[p.channel as string]!;
        return scalar((uv) => toColor(ins[0], uv)[ch]);
      }
      case 'CompositorNodeCombineColor':
        return color((uv) =>
          vec4(toScalar(ins[0], uv, 'Combine.r'), toScalar(ins[1], uv, 'Combine.g'), toScalar(ins[2], uv, 'Combine.b'), toScalar(ins[3], uv, 'Combine.a')),
        );
      case 'CompositorNodeInvert':
        return color((uv) => {
          const fac = toScalar(ins[0], uv, 'Invert.fac');
          const c = toColor(ins[1], uv);
          const rgb = p.invertColor ? vec3(1).sub(c.xyz) : c.xyz;
          const a = p.invertAlpha ? ONE.sub(c.w) : c.w;
          return mix(c, vec4(rgb, a), fac);
        });
      case 'CompositorNodeHueSat':
        return color((uv) => {
          const c = toColor(ins[0], uv);
          const hsv: TSLNode = rgbToHsv(c);
          const h: TSLNode = fract(hsv.x.add(toScalar(ins[1], uv, 'HueSat.hue')).add(0.5));
          const s = hsv.y.mul(toScalar(ins[2], uv, 'HueSat.saturation'));
          const v = hsv.z.mul(toScalar(ins[3], uv, 'HueSat.value'));
          const r: TSLNode = hsvToRgb(vec4(h as TSLNode, s, v, hsv.w));
          const rr: TSLNode = vec4(max(r.xyz, vec3(0)) as TSLNode, r.w);
          return mix(c, rr, toScalar(ins[4], uv, 'HueSat.fac'));
        });
      case 'CompositorNodeBrightContrast':
        return color((uv) => {
          const c = toColor(ins[0], uv);
          const scaledB = toScalar(ins[1], uv, 'BrightContrast.bright').div(100);
          const contrast = toScalar(ins[2], uv, 'BrightContrast.contrast');
          const delta = contrast.div(200);
          const posMul = ONE.div(max(ONE.sub(delta.mul(2)), float(1.192092896e-7)));
          const posOff = posMul.mul(scaledB.sub(delta));
          const nDelta = delta.negate();
          const negMul = max(ONE.sub(nDelta.mul(2)), ZERO);
          const negOff = negMul.mul(scaledB).add(nDelta);
          const pos = contrast.greaterThan(ZERO);
          const mul = select(pos, posMul, negMul);
          const off = select(pos, posOff, negOff);
          return vec4(c.xyz.mul(mul).add(off), c.w);
        });
      case 'CompositorNodeGamma':
        return color((uv) => {
          const c = toColor(ins[0], uv);
          const g = toScalar(ins[1], uv, 'Gamma.gamma');
          return vec4(fallbackPow(c.x, g), fallbackPow(c.y, g), fallbackPow(c.z, g), c.w);
        });
      case 'CompositorNodeExposure':
        return color((uv) => {
          const c = toColor(ins[0], uv);
          return vec4(c.xyz.mul(exp2(toScalar(ins[1], uv, 'Exposure.exposure'))), c.w);
        });
      case 'CompositorNodePosterize':
        return color((uv) => {
          const c = toColor(ins[0], uv);
          const s = clamp(toScalar(ins[1], uv, 'Posterize.steps'), float(2), float(1024));
          return vec4(floor(c.xyz.mul(s)).div(s), c.w);
        });
      case 'CompositorNodeAlphaOver':
        return color((uv) => {
          const fac = toScalar(ins[0], uv, 'AlphaOver.fac');
          const bg = toColor(ins[1], uv);
          const fgIn = toColor(ins[2], uv);
          const alpha = clamp(fgIn.w, ZERO, ONE);
          const fg = p.straightAlpha ? vec4(fgIn.xyz.mul(alpha), alpha) : fgIn;
          const mixResult = bg.mul(ONE.sub(alpha)).add(fg);
          return mix(bg, mixResult, fac);
        });
      case 'CompositorNodeSetAlpha':
        return color((uv) => {
          const c = toColor(ins[0], uv);
          const a = toScalar(ins[1], uv, 'SetAlpha.alpha');
          return p.mode === 'APPLY' ? c.mul(a) : vec4(c.xyz, a);
        });
      case 'CompositorNodeRGBToBW':
        return scalar((uv) => luma(toColor(ins[0], uv)));
      case 'CompositorNodeMapValue':
        return scalar((uv) => {
          let r = toScalar(ins[0], uv, 'MapValue.value').add(float(p.offset as number)).mul(float(p.size as number));
          if (p.useMin) r = max(r, float(p.min as number));
          if (p.useMax) r = min(r, float(p.max as number));
          return r;
        });
      case 'CompositorNodeMapRange':
        return scalar((uv) =>
          emitMapRange(
            toScalar(ins[0], uv, 'MapRange.value'),
            p.fromMin as number,
            p.fromMax as number,
            p.toMin as number,
            p.toMax as number,
            p.clamp as boolean,
          ),
        );

      /* kernels: materialise the input, then tap it */
      case 'CompositorNodeFilter': {
        const type = p.filterType as FilterType;
        const k = FILTER_KERNELS[type];
        const src = materialize(ins[0], `filter:${type}:${node.id}`);
        return color((uv) => {
          const t = src.texel;
          const tap = (i: number, j: number) => src(uv.add(vec2(i - 1, j - 1).mul(t)));
          const fac = toScalar(ins[1], uv, 'Filter.fac');
          const center = tap(1, 1);
          if (!isEdgeFilter(type)) {
            let acc: TSLNode = vec4(0);
            for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (k[j][i] !== 0) acc = acc.add(tap(i, j).mul(k[j][i]));
            return max(mix(center, acc, fac), vec4(0));
          }
          let cx: TSLNode = vec3(0);
          let cy: TSLNode = vec3(0);
          for (let j = 0; j < 3; j++)
            for (let i = 0; i < 3; i++) {
              const c = tap(i, j).xyz;
              if (k[j][i] !== 0) cx = cx.add(c.mul(k[j][i]));
              if (k[i][j] !== 0) cy = cy.add(c.mul(k[i][j]));
            }
          const mag = sqrt(cx.mul(cx).add(cy.mul(cy)));
          return vec4(mix(center.xyz, mag, fac), center.w);
        });
      }
      case 'CompositorNodeBlur': {
        const size = p.size as [number, number];
        const type = p.filterType as BlurFilterType;
        if (p.separable) {
          // Blender's separable form: horizontal pass into a stage, vertical pass on top
          const wx = blurWeights1D(type, size[0]);
          const wy = blurWeights1D(type, size[1]);
          const src = materialize(ins[0], `blur:h:in:${node.id}`);
          const horizontal: CompEmit = color((uv) => {
            const t = src.texel;
            let acc: TSLNode = src(uv).mul(wx[0]);
            for (let x = 1; x < wx.length; x++) {
              acc = acc.add(src(uv.add(vec2(x, 0).mul(t))).mul(wx[x]));
              acc = acc.add(src(uv.sub(vec2(x, 0).mul(t))).mul(wx[x]));
            }
            return acc;
          });
          const mid = materialize(horizontal, `blur:v:in:${node.id}`);
          return color((uv) => {
            const t = mid.texel;
            let acc: TSLNode = mid(uv).mul(wy[0]);
            for (let y = 1; y < wy.length; y++) {
              acc = acc.add(mid(uv.add(vec2(0, y).mul(t))).mul(wy[y]));
              acc = acc.add(mid(uv.sub(vec2(0, y).mul(t))).mul(wy[y]));
            }
            return acc;
          });
        }
        const w = blurWeights(type, size);
        const src = materialize(ins[0], `blur:${type}:${node.id}`);
        return color((uv) => {
          const t = src.texel;
          const tap = (dx: number, dy: number) => src(uv.add(vec2(dx, dy).mul(t)));
          let acc: TSLNode = tap(0, 0).mul(w.w[0][0]);
          for (let x = 1; x < w.size[0]; x++) acc = acc.add(tap(x, 0).add(tap(-x, 0)).mul(w.w[0][x]));
          for (let y = 1; y < w.size[1]; y++) acc = acc.add(tap(0, y).add(tap(0, -y)).mul(w.w[y][0]));
          for (let y = 1; y < w.size[1]; y++)
            for (let x = 1; x < w.size[0]; x++) {
              const wgt = w.w[y][x];
              if (wgt !== 0) acc = acc.add(tap(x, y).add(tap(-x, y)).add(tap(x, -y)).add(tap(-x, -y)).mul(wgt));
            }
          return acc;
        });
      }
      case 'CompositorNodeDisplace': {
        const src = materialize(ins[0], `displace:in:${node.id}`);
        return color((uv) => {
          const vecIn = toColor(ins[1], uv);
          const sx = toScalar(ins[2], uv, 'Displace.xScale');
          const sy = toScalar(ins[3], uv, 'Displace.yScale');
          // coords - displacement * scale / size, displacement in pixels.
          // Blender samples with a zero border: outside the image is transparent
          // black. WebGPU samplers have no border colour, so mask by the
          // displaced uv (per pixel, not per tap: exact except in the last texel).
          // displacement is in pixels of the SOURCE image (Blender divides by input size)
          const size = vec2(1).div(src.texel);
          const disp = vecIn.xy.mul(vec2(sx, sy)).div(size);
          const d = uv.sub(disp);
          // edge mask, half-width 0.25 texel (see evaluate.ts displaceEdgeMask)
          const t = d.mul(size);
          const ramp = (x: TSLNode) => clamp(x.add(0.25).div(0.5), 0, 1);
          const inside = ramp(t.x).mul(ramp(size.x.sub(t.x))).mul(ramp(t.y)).mul(ramp(size.y.sub(t.y)));
          return src(d).mul(inside);
        });
      }

      case 'Custom': {
        const spec = p.spec as CustomNodeSpec;
        const at = (uv: TSLNode) => {
          const vals = ins.map((e) => e.at(uv));
          return spec.tsl(vals, { px: uv.mul(screenSize), uv, size: screenSize, time: tslTime }) as TSLNode;
        };
        return spec.kind === 'color' ? color(at) : scalar(at);
      }
      default:
        throw new Error(`[comp] compile: node type '${node.type}' has no emitter`);
    }
  };

  const root = em(target);
  const output = toColor(root, screenUV);
  return { output, stages, uniforms };
}

/** The node types this emitter understands (parity test against the evaluator). */
export const compEmittableTypes = (): string[] => [
  'CompositorNodeRLayers',
  'CompositorNodeImage',
  'CompositorNodeValue',
  'CompositorNodeRGB',
  'CompositorNodeTime',
  'CompositorNodeCoordinates',
  'CompositorNodeMixRGB',
  'CompositorNodeMath',
  'CompositorNodeValToRGB',
  'CompositorNodeSeparateColor',
  'CompositorNodeCombineColor',
  'CompositorNodeInvert',
  'CompositorNodeHueSat',
  'CompositorNodeBrightContrast',
  'CompositorNodeGamma',
  'CompositorNodeExposure',
  'CompositorNodePosterize',
  'CompositorNodeAlphaOver',
  'CompositorNodeSetAlpha',
  'CompositorNodeRGBToBW',
  'CompositorNodeMapValue',
  'CompositorNodeMapRange',
  'CompositorNodeFilter',
  'CompositorNodeBlur',
  'CompositorNodeDisplace',
  'Custom',
];

