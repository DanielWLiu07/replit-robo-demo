/**
 * Reference semantics for the compositor node vocabulary, transcribed from
 * Blender's own sources (vendor/blender-glsl/<ver>/compositor/). Every
 * function names the file it mirrors. This is the executable spec: the CPU
 * evaluator calls these directly and the TSL emitter is written to agree.
 *
 * Domain note. Blender's compositor works on scene-linear, straight-alpha
 * images (premultiplied only where a node says so). Nothing here converts
 * colour spaces; the display transform is the renderer's job at the very end.
 */
import { clamp01, type Vec4 } from '../transpiler/blender-ops';

/* ---------------- colour utilities (common/gpu_shader_common_color_utils.glsl) ---------------- */

/** rgb_to_hsv, exact branch structure. Alpha passes through in w. */
export function rgbToHsv(rgb: Vec4): Vec4 {
  const cmax = Math.max(rgb[0], Math.max(rgb[1], rgb[2]));
  const cmin = Math.min(rgb[0], Math.min(rgb[1], rgb[2]));
  const cdelta = cmax - cmin;
  const v = cmax;
  let s: number;
  let h = 0;
  if (cmax !== 0) s = cdelta / cmax;
  else {
    s = 0;
    h = 0;
  }
  if (s === 0) h = 0;
  else {
    const c = [(cmax - rgb[0]) / cdelta, (cmax - rgb[1]) / cdelta, (cmax - rgb[2]) / cdelta];
    if (rgb[0] === cmax) h = c[2] - c[1];
    else if (rgb[1] === cmax) h = 2 + c[0] - c[2];
    else h = 4 + c[1] - c[0];
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, v, rgb[3]];
}

/** hsv_to_rgb, exact sextant table. */
export function hsvToRgb(hsv: Vec4): Vec4 {
  let h = hsv[0];
  const s = hsv[1];
  const v = hsv[2];
  let rgb: [number, number, number];
  if (s === 0) rgb = [v, v, v];
  else {
    if (h === 1) h = 0;
    h *= 6;
    const i = Math.floor(h);
    const f = h - i;
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));
    if (i === 0) rgb = [v, t, p];
    else if (i === 1) rgb = [q, v, p];
    else if (i === 2) rgb = [p, v, t];
    else if (i === 3) rgb = [p, q, v];
    else if (i === 4) rgb = [t, p, v];
    else rgb = [v, p, q];
  }
  return [rgb[0], rgb[1], rgb[2], hsv[3]];
}

/** Rec.709 coefficients: Blender's default for scene-linear sRGB working space. */
export const LUMINANCE_REC709: [number, number, number] = [0.2126, 0.7152, 0.0722];

/** color_to_luminance: dot(rgb, coefficients). */
export function luminance(c: Vec4, coeff: readonly [number, number, number] = LUMINANCE_REC709): number {
  return c[0] * coeff[0] + c[1] * coeff[1] + c[2] * coeff[2];
}

/* ---------------- per-pixel node functions (compositor/library/gpu_shader_compositor_*.glsl) ---------------- */

const lerp4 = (a: Vec4, b: Vec4, f: number): Vec4 => [
  a[0] + f * (b[0] - a[0]),
  a[1] + f * (b[1] - a[1]),
  a[2] + f * (b[2] - a[2]),
  a[3] + f * (b[3] - a[3]),
];

/** node_composite_hue_saturation_value: hue offset wraps through +0.5, rgb floored at 0, mixed by factor. */
export function hueSatVal(color: Vec4, hue: number, saturation: number, value: number, factor: number): Vec4 {
  const hsv = rgbToHsv(color);
  hsv[0] = fract(hsv[0] + hue + 0.5);
  hsv[1] *= saturation;
  hsv[2] *= value;
  const r = hsvToRgb(hsv);
  r[0] = Math.max(r[0], 0);
  r[1] = Math.max(r[1], 0);
  r[2] = Math.max(r[2], 0);
  return lerp4(color, r, factor);
}

const FLT_EPSILON = 1.192092896e-7;

/** node_composite_bright_contrast: brightness/100, contrast/200, two branches on the sign of contrast. */
export function brightContrast(color: Vec4, brightness: number, contrast: number): Vec4 {
  const scaledBrightness = brightness / 100;
  let delta = contrast / 200;
  let multiplier: number;
  let offset: number;
  if (contrast > 0) {
    multiplier = 1 - delta * 2;
    multiplier = 1 / Math.max(multiplier, FLT_EPSILON);
    offset = multiplier * (scaledBrightness - delta);
  } else {
    delta *= -1;
    multiplier = Math.max(1 - delta * 2, 0);
    offset = multiplier * scaledBrightness + delta;
  }
  return [color[0] * multiplier + offset, color[1] * multiplier + offset, color[2] * multiplier + offset, color[3]];
}

/** fallback_pow (gpu_shader_math_vector_lib): pow where a > 0, else the fallback (here the input itself). */
export const fallbackPow = (a: number, b: number, fallback: number) => (a > 0 ? Math.pow(a, b) : fallback);

/** node_composite_gamma. */
export function gamma(color: Vec4, g: number): Vec4 {
  return [fallbackPow(color[0], g, color[0]), fallbackPow(color[1], g, color[1]), fallbackPow(color[2], g, color[2]), color[3]];
}

/** node_composite_exposure: rgb * 2^exposure. */
export function exposure(color: Vec4, e: number): Vec4 {
  const m = Math.pow(2, e);
  return [color[0] * m, color[1] * m, color[2] * m, color[3]];
}

/** node_composite_posterize: steps clamped to [2, 1024], floor(c * steps) / steps. */
export function posterize(color: Vec4, steps: number): Vec4 {
  const s = Math.min(1024, Math.max(2, steps));
  return [Math.floor(color[0] * s) / s, Math.floor(color[1] * s) / s, Math.floor(color[2] * s) / s, color[3]];
}

/** node_composite_alpha_over: bg * (1 - a) + fg (premultiplied if straight), mixed by factor. */
export function alphaOver(factor: number, background: Vec4, foreground: Vec4, straightAlpha: boolean): Vec4 {
  const alpha = clamp01(foreground[3]);
  const fg: Vec4 = straightAlpha
    ? [foreground[0] * alpha, foreground[1] * alpha, foreground[2] * alpha, alpha]
    : foreground;
  const mixResult: Vec4 = [
    background[0] * (1 - alpha) + fg[0],
    background[1] * (1 - alpha) + fg[1],
    background[2] * (1 - alpha) + fg[2],
    background[3] * (1 - alpha) + fg[3],
  ];
  return lerp4(background, mixResult, factor);
}

/** node_composite_invert: colour and/or alpha flags, then mixed by fac. */
export function invertComp(fac: number, color: Vec4, invertColor: boolean, invertAlpha: boolean): Vec4 {
  const r: Vec4 = [...color] as Vec4;
  if (invertColor) {
    r[0] = 1 - r[0];
    r[1] = 1 - r[1];
    r[2] = 1 - r[2];
  }
  if (invertAlpha) r[3] = 1 - r[3];
  return lerp4(color, r, fac);
}

/** node_composite_set_alpha_replace / _apply. */
export function setAlpha(color: Vec4, alpha: number, mode: 'REPLACE_ALPHA' | 'APPLY'): Vec4 {
  return mode === 'APPLY'
    ? [color[0] * alpha, color[1] * alpha, color[2] * alpha, color[3] * alpha]
    : [color[0], color[1], color[2], alpha];
}

/** node_composite_map_value: (v + offset) * size with optional min/max. */
export function mapValue(
  value: number,
  offset: number,
  size: number,
  useMin: boolean,
  min: number,
  useMax: boolean,
  max: number,
): number {
  let r = (value + offset) * size;
  if (useMin && r < min) r = min;
  if (useMax && r > max) r = max;
  return r;
}

/* ---------------- MixRGB (common/gpu_shader_common_mix_rgb.glsl, wired by node_composite_mixrgb.cc) ---------------- */

export type CompBlendType = 'MIX' | 'ADD' | 'MULTIPLY' | 'SUBTRACT' | 'SCREEN' | 'OVERLAY' | 'DIVIDE';

export interface CompMixFlags {
  /** node_composite_mixrgb "Include Alpha": fac *= col2.a before mixing. */
  useAlpha?: boolean;
  /** node_composite_mixrgb "Clamp": clamp_color on the result. */
  clamp?: boolean;
}

/** The compositor MixRGB. Alpha always comes from col1 (every mix_* keeps col1.a). */
export function mixRgb(blend: CompBlendType, fac: number, col1: Vec4, col2: Vec4, flags: CompMixFlags = {}): Vec4 {
  const f = flags.useAlpha ? fac * col2[3] : fac;
  const facm = 1 - f;
  let out: Vec4;
  switch (blend) {
    case 'MIX':
      out = [col1[0] + f * (col2[0] - col1[0]), col1[1] + f * (col2[1] - col1[1]), col1[2] + f * (col2[2] - col1[2]), col1[3]];
      break;
    case 'ADD':
      out = [col1[0] + f * col2[0], col1[1] + f * col2[1], col1[2] + f * col2[2], col1[3]];
      break;
    case 'MULTIPLY':
      out = [
        col1[0] + f * (col1[0] * col2[0] - col1[0]),
        col1[1] + f * (col1[1] * col2[1] - col1[1]),
        col1[2] + f * (col1[2] * col2[2] - col1[2]),
        col1[3],
      ];
      break;
    case 'SUBTRACT':
      out = [col1[0] - f * col2[0], col1[1] - f * col2[1], col1[2] - f * col2[2], col1[3]];
      break;
    case 'SCREEN': {
      const ch = (a: number, b: number) => 1 - (facm + f * (1 - b)) * (1 - a);
      out = [ch(col1[0], col2[0]), ch(col1[1], col2[1]), ch(col1[2], col2[2]), col1[3]];
      break;
    }
    case 'OVERLAY': {
      const ch = (a: number, b: number) => (a < 0.5 ? a * (facm + 2 * f * b) : 1 - (facm + 2 * f * (1 - b)) * (1 - a));
      out = [ch(col1[0], col2[0]), ch(col1[1], col2[1]), ch(col1[2], col2[2]), col1[3]];
      break;
    }
    case 'DIVIDE': {
      // mix_div: channels where col2 == 0 come out 0, alpha from col1
      const ch = (a: number, b: number) => (b !== 0 ? facm * a + (f * a) / b : 0);
      out = [ch(col1[0], col2[0]), ch(col1[1], col2[1]), ch(col1[2], col2[2]), col1[3]];
      break;
    }
    default:
      throw new Error(`[comp] MixRGB blend type '${blend}' is not transcribed yet; refusing to guess.`);
  }
  if (flags.clamp) out = [clamp01(out[0]), clamp01(out[1]), clamp01(out[2]), clamp01(out[3])];
  return out;
}

/* ---------------- Filter node (nodes/node_composite_filter.cc + compositor_filter.glsl / compositor_edge_filter.glsl) ---------------- */

export type FilterType =
  | 'SOFTEN'
  | 'SHARPEN'
  | 'SHARPEN_DIAMOND'
  | 'LAPLACE'
  | 'SOBEL'
  | 'PREWITT'
  | 'KIRSCH'
  | 'SHADOW';

/** Row-major, top row first, exactly as get_filter_kernel() initialises them. */
export const FILTER_KERNELS: Record<FilterType, readonly [number, number, number][]> = {
  SOFTEN: [
    [1 / 16, 2 / 16, 1 / 16],
    [2 / 16, 4 / 16, 2 / 16],
    [1 / 16, 2 / 16, 1 / 16],
  ],
  SHARPEN: [
    [-1, -1, -1],
    [-1, 9, -1],
    [-1, -1, -1],
  ],
  LAPLACE: [
    [-1 / 8, -1 / 8, -1 / 8],
    [-1 / 8, 1, -1 / 8],
    [-1 / 8, -1 / 8, -1 / 8],
  ],
  SOBEL: [
    [1, 0, -1],
    [2, 0, -2],
    [1, 0, -1],
  ],
  PREWITT: [
    [1, 0, -1],
    [1, 0, -1],
    [1, 0, -1],
  ],
  KIRSCH: [
    [5, -3, -2],
    [5, -3, -2],
    [5, -3, -2],
  ],
  SHADOW: [
    [1, 2, 1],
    [0, 1, 0],
    [-1, -2, -1],
  ],
  SHARPEN_DIAMOND: [
    [0, -1, 0],
    [-1, 5, -1],
    [0, -1, 0],
  ],
};

/** is_edge_filter(): these run the X kernel and its transpose and take the per-channel magnitude. */
export const isEdgeFilter = (t: FilterType) => t === 'LAPLACE' || t === 'SOBEL' || t === 'PREWITT' || t === 'KIRSCH';

/**
 * One output pixel of the Filter node. `tap(i, j)` returns the input at
 * offset (i - 1, j - 1) with Blender's texture_load clamp-to-bounds.
 *   non-edge: mix(center, sum(kernel * window), fac), then max(0)
 *   edge:     per-channel sqrt(x^2 + y^2) of kernel and transposed kernel, mixed into rgb, alpha kept
 */
export function filterPixel(type: FilterType, fac: number, tap: (i: number, j: number) => Vec4): Vec4 {
  const k = FILTER_KERNELS[type];
  const center = tap(1, 1);
  if (!isEdgeFilter(type)) {
    const acc: Vec4 = [0, 0, 0, 0];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const c = tap(i, j);
        const w = k[j][i];
        acc[0] += c[0] * w;
        acc[1] += c[1] * w;
        acc[2] += c[2] * w;
        acc[3] += c[3] * w;
      }
    const m = lerp4(center, acc, fac);
    return [Math.max(m[0], 0), Math.max(m[1], 0), Math.max(m[2], 0), Math.max(m[3], 0)];
  }
  const cx = [0, 0, 0];
  const cy = [0, 0, 0];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const c = tap(i, j);
      const wx = k[j][i];
      const wy = k[i][j];
      cx[0] += c[0] * wx;
      cx[1] += c[1] * wx;
      cx[2] += c[2] * wx;
      cy[0] += c[0] * wy;
      cy[1] += c[1] * wy;
      cy[2] += c[2] * wy;
    }
  const mag = [Math.sqrt(cx[0] * cx[0] + cy[0] * cy[0]), Math.sqrt(cx[1] * cx[1] + cy[1] * cy[1]), Math.sqrt(cx[2] * cx[2] + cy[2] * cy[2])];
  return [
    center[0] + fac * (mag[0] - center[0]),
    center[1] + fac * (mag[1] - center[1]),
    center[2] + fac * (mag[2] - center[2]),
    center[3],
  ];
}

/* ---------------- Blur node weights (cached_resources/symmetric_blur_weights.cc + render/initrender.cc RE_filter_value) ---------------- */

export type BlurFilterType = 'GAUSS' | 'BOX' | 'TENT';

/** RE_filter_value for the filter types the compositor blur exposes here. gaussfac = 1.6. */
export function reFilterValue(type: BlurFilterType, xIn: number): number {
  const gaussfac = 1.6;
  const x = Math.abs(xIn);
  switch (type) {
    case 'BOX':
      return x > 1 ? 0 : 1;
    case 'TENT':
      return x > 1 ? 0 : 1 - x;
    case 'GAUSS': {
      const twoGaussfac2 = 2 * gaussfac * gaussfac;
      const xs = x * 3 * gaussfac;
      return (1 / Math.sqrt(Math.PI * twoGaussfac2)) * Math.exp((-xs * xs) / twoGaussfac2);
    }
  }
}

export interface BlurWeights {
  /** (ceil(rx) + 1, ceil(ry) + 1): the positive quadrant including the centre row/column. */
  size: [number, number];
  /** Row-major [y][x], normalised so the full symmetric kernel sums to 1. */
  w: number[][];
}

/**
 * SymmetricBlurWeights: weights on the positive quadrant, sampled at
 * (x, y) * (1 / radius), normalised against the full mirrored sum (centre once,
 * axes twice, quadrant four times). A radius of 0 on an axis yields size 1
 * there (safe_divide gives scale 0, so only the centre column/row exists).
 */
export function blurWeights(type: BlurFilterType, radius: readonly [number, number]): BlurWeights {
  const scale: [number, number] = [radius[0] > 0 ? 1 / radius[0] : 0, radius[1] > 0 ? 1 / radius[1] : 0];
  const size: [number, number] = [Math.ceil(radius[0]) + 1, Math.ceil(radius[1]) + 1];
  const w: number[][] = Array.from({ length: size[1] }, () => new Array<number>(size[0]).fill(0));
  let sum = 0;
  const center = reFilterValue(type, 0);
  w[0][0] = center;
  sum += center;
  for (let x = 1; x < size[0]; x++) {
    const v = reFilterValue(type, x * scale[0]);
    w[0][x] = v;
    sum += v * 2;
  }
  for (let y = 1; y < size[1]; y++) {
    const v = reFilterValue(type, y * scale[1]);
    w[y][0] = v;
    sum += v * 2;
  }
  for (let y = 1; y < size[1]; y++)
    for (let x = 1; x < size[0]; x++) {
      const v = reFilterValue(type, Math.hypot(x * scale[0], y * scale[1]));
      w[y][x] = v;
      sum += v * 4;
    }
  for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) w[y][x] /= sum;
  return { size, w };
}

/**
 * One output pixel of the symmetric blur (compositor_symmetric_blur.glsl,
 * extend_bounds off): centre once, axes mirrored, quadrant mirrored four ways.
 * `tap(dx, dy)` reads the input with clamp-to-bounds.
 */
export function blurPixel(weights: BlurWeights, tap: (dx: number, dy: number) => Vec4): Vec4 {
  const acc: Vec4 = [0, 0, 0, 0];
  const add = (c: Vec4, wgt: number) => {
    acc[0] += c[0] * wgt;
    acc[1] += c[1] * wgt;
    acc[2] += c[2] * wgt;
    acc[3] += c[3] * wgt;
  };
  const { size, w } = weights;
  add(tap(0, 0), w[0][0]);
  for (let x = 1; x < size[0]; x++) {
    add(tap(x, 0), w[0][x]);
    add(tap(-x, 0), w[0][x]);
  }
  for (let y = 1; y < size[1]; y++) {
    add(tap(0, y), w[y][0]);
    add(tap(0, -y), w[y][0]);
  }
  for (let y = 1; y < size[1]; y++)
    for (let x = 1; x < size[0]; x++) {
      const wgt = w[y][x];
      add(tap(x, y), wgt);
      add(tap(-x, y), wgt);
      add(tap(x, -y), wgt);
      add(tap(-x, -y), wgt);
    }
  return acc;
}

/**
 * Gaussian weights are separable EXACTLY: exp(-k(x^2 + y^2)) = exp(-kx^2) exp(-ky^2)
 * and normalising each axis then multiplying equals normalising the product.
 * Box (a disc) and Tent (a cone) are not. The GPU path uses this to run GAUSS
 * as two 1D passes; the CPU reference always runs the 2D form, and the test
 * suite pins that the two agree.
 */
export const isSeparableBlur = (type: BlurFilterType) => type === 'GAUSS';

/** 1D normalised weights along one axis for the separable path (index 0 = centre). */
export function blurWeights1D(type: BlurFilterType, radius: number): number[] {
  const scale = radius > 0 ? 1 / radius : 0;
  const n = Math.ceil(radius) + 1;
  const w: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = reFilterValue(type, i * scale);
    w.push(v);
    sum += i === 0 ? v : v * 2;
  }
  return w.map((v) => v / sum);
}

/* ---------------- Displace node (compositor_displace.glsl) ---------------- */

/**
 * The displaced sample coordinate in normalised [0,1] space:
 *   coords = (texel + 0.5) / size - displacement.xy * scale / size
 * displacement is in pixels; the caller samples the input bilinearly there.
 */
export function displaceCoords(
  texel: readonly [number, number],
  size: readonly [number, number],
  displacement: readonly [number, number],
  scale: readonly [number, number],
): [number, number] {
  return [
    (texel[0] + 0.5) / size[0] - (displacement[0] * scale[0]) / size[0],
    (texel[1] + 0.5) / size[1] - (displacement[1] * scale[1]) / size[1],
  ];
}

const fract = (x: number) => x - Math.floor(x);
