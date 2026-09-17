/**
 * Custom compositor nodes: things the recipes need that Blender's compositor
 * does not have as nodes. Each is tagged 'custom' by construction (they go
 * through compGraph.custom) so a fidelity report never mistakes them for
 * transcribed Blender behaviour.
 *
 * Both backends are written side by side here so they cannot drift apart
 * without it being visible in one file. Same hash constants as the GLSL
 * originals in pomme's watercolour and manga passes so the grain matches.
 */
import { abs, cos, float, floor, fract, int, length, mix, sin, smoothstep, uint, vec2 } from 'three/tsl';
import type { TSLNode } from '../graph/compile';
import type { CompGraph } from './builder';
import type { CompInput, CompNode } from './types';

/* ---------------- hashing ----------------
 * The GLSL originals used fract(sin(dot(p, k)) * 43758.5453). That hash is not
 * reproducible: float32 sin of arguments in the thousands differs between GPU
 * and double-precision JS by whole periods, so the two backends produced
 * unrelated noise fields (the probe measured mean 5e-2, worst 0.84). Integer
 * lattice coordinates hashed with 32-bit wrapping arithmetic are bit-exact on
 * both sides; the value noise keeps the same lattice and smoothstep blend, so
 * the look is the same family, only the random field is a different draw. */

const HASH_OFFSET = 32768; // keep lattice coordinates positive before uint conversion
const K1 = 0x27d4eb2d, K2 = 0x165667b1, K3 = 0x2c1b3c6d, K4 = 0x297a2d39;

/* ---------------- CPU twins ---------------- */

const fractN = (x: number) => x - Math.floor(x);
/** hash of integer lattice point -> [0,1), bit-exact with hashT */
function h21(ix: number, iy: number): number {
  const x = (ix + HASH_OFFSET) >>> 0;
  const y = (iy + HASH_OFFSET) >>> 0;
  let h = (Math.imul(x, K1) ^ Math.imul(y, K2)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), K3) >>> 0;
  h = Math.imul(h ^ (h >>> 12), K4) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return Math.fround(h / 4294967296);
}
function vnoiseCPU(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
const fbmCPU = (x: number, y: number) =>
  vnoiseCPU(x, y) * 0.55 + vnoiseCPU(x * 2.13 + 7.7, y * 2.13 + 7.7) * 0.28 + vnoiseCPU(x * 4.71 + 3.1, y * 4.71 + 3.1) * 0.17;

/* ---------------- TSL twins ---------------- */

/** hash of an integer lattice point (as a float vec2 of integers) -> [0,1) */
function hashT(i: TSLNode): TSLNode {
  const x = uint(int(i.x).add(int(HASH_OFFSET)));
  const y = uint(int(i.y).add(int(HASH_OFFSET)));
  let h: TSLNode = x.mul(uint(K1)).bitXor(y.mul(uint(K2)));
  h = h.bitXor(h.shiftRight(uint(15))).mul(uint(K3));
  h = h.bitXor(h.shiftRight(uint(12))).mul(uint(K4));
  h = h.bitXor(h.shiftRight(uint(15)));
  return float(h).div(4294967296);
}
const h21T = (p: TSLNode) => hashT(floor(p));
function vnoiseT(p: TSLNode): TSLNode {
  const i: TSLNode = floor(p);
  let f: TSLNode = fract(p);
  f = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hashT(i), b = hashT(i.add(vec2(1, 0))), c = hashT(i.add(vec2(0, 1))), d = hashT(i.add(vec2(1, 1)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
const fbmT = (p: TSLNode): TSLNode =>
  vnoiseT(p).mul(0.55).add(vnoiseT(p.mul(2.13).add(7.7)).mul(0.28)).add(vnoiseT(p.mul(4.71).add(3.1)).mul(0.17));

/* ---------------- node constructors ---------------- */

/**
 * Value noise in [0,1] of (coords.xy * scale + offset). `coords` is a colour
 * socket carrying xy (from c.coords()).
 */
export function valueNoise(c: CompGraph, coords: CompInput, scale: number, offset: [number, number] = [0, 0]): CompNode {
  return c.custom(
    {
      name: `vnoise(${scale})`,
      kind: 'scalar',
      cpu: ([p]) => {
        const v = p as [number, number, number, number];
        return vnoiseCPU(v[0] * scale + offset[0], v[1] * scale + offset[1]);
      },
      tsl: ([p]) => vnoiseT((p as TSLNode).xy.mul(scale).add(vec2(offset[0], offset[1]))),
    },
    coords,
  );
}

/** Three-octave fbm of value noise (0.55 / 0.28 / 0.17), same as the GLSL originals. */
export function fbm(c: CompGraph, coords: CompInput, scale: number, offset: [number, number] = [0, 0]): CompNode {
  return c.custom(
    {
      name: `fbm(${scale})`,
      kind: 'scalar',
      cpu: ([p]) => {
        const v = p as [number, number, number, number];
        return fbmCPU(v[0] * scale + offset[0], v[1] * scale + offset[1]);
      },
      tsl: ([p]) => fbmT((p as TSLNode).xy.mul(scale).add(vec2(offset[0], offset[1]))),
    },
    coords,
  );
}

/**
 * Manga tone for a luminance: 1 = paper, 0 = ink. Halftone dots in the mids,
 * crosshatch in the shadows, solid ink in the core, in screen pixels. Ported
 * from pomme's mangaPass; `grit` widens the hatch and deepens the blacks.
 */
export function mangaTone(c: CompGraph, lum: CompInput, grit: CompInput, dotScale = 4, hatchScale = 3.4): CompNode {
  const halftoneCPU = (px: number, py: number, amt: number) => {
    const a = 0.7853981634;
    const cs = Math.cos(a), sn = Math.sin(a);
    const rx = (px * cs - py * sn) / dotScale, ry = (px * sn + py * cs) / dotScale;
    const cx = fractN(rx) - 0.5, cy = fractN(ry) - 0.5;
    const d = Math.hypot(cx, cy);
    const rad = amt * 0.72;
    const t = Math.min(1, Math.max(0, (d - (rad - 0.08)) / 0.16));
    return 1 - t * t * (3 - 2 * t);
  };
  const hatchCPU = (px: number, py: number, scale: number, dir: number) => {
    const v = ((px + py) * (1 - dir) + (px - py) * dir) / scale;
    const f = Math.abs(fractN(v) - 0.5) * 2;
    const t = Math.min(1, Math.max(0, (f - 0.55) / 0.3));
    return t * t * (3 - 2 * t);
  };
  return c.custom(
    {
      name: 'mangaTone',
      kind: 'scalar',
      cpu: ([L0, g0], ctx) => {
        const L = L0 as number, g = g0 as number;
        const Lg = Math.min(1, Math.max(0, L * 1.15 + 0.05));
        const dots = halftoneCPU(ctx.x, ctx.y, Math.min(1, Math.max(0, (0.62 - Lg) * 2.4)));
        const hA = hatchCPU(ctx.x, ctx.y, hatchScale, 0);
        const hB = hatchCPU(ctx.x, ctx.y, hatchScale * 1.18, 1);
        const shade = hA + (Math.max(hA, hB) - hA) * g;
        if (Lg > 0.72) return 1;
        if (Lg > 0.42) return 1 - dots * 0.9;
        if (Lg > 0.2) return 0.5 + (0.12 - 0.5) * shade;
        return 0.12 + (0.03 - 0.12) * g;
      },
      tsl: ([L0, g0], ctx) => {
        const L = L0 as TSLNode, g = g0 as TSLNode;
        const px = ctx.px as TSLNode;
        const Lg = (L.mul(1.15).add(0.05) as TSLNode).clamp(0, 1);
        const a = float(0.7853981634);
        const r = vec2(px.x.mul(cos(a)).sub(px.y.mul(sin(a))), px.x.mul(sin(a)).add(px.y.mul(cos(a)))).div(dotScale);
        const cell = fract(r).sub(0.5);
        const d = length(cell);
        const rad = (float(0.62).sub(Lg).mul(2.4) as TSLNode).clamp(0, 1).mul(0.72);
        const dots = float(1).sub(smoothstep(rad.sub(0.08), rad.add(0.08), d));
        const hatch = (scale: number, dir: number) => {
          const v = mix(px.x.add(px.y), px.x.sub(px.y), dir).div(scale);
          const f = abs(fract(v).sub(0.5)).mul(2);
          return smoothstep(0.55, 0.85, f);
        };
        const hA = hatch(hatchScale, 0), hB = hatch(hatchScale * 1.18, 1);
        const shade = mix(hA, hA.max(hB), g);
        const highlight = float(1);
        const mid = float(1).sub(dots.mul(0.9));
        const shadow = mix(0.5, 0.12, shade);
        const core = mix(0.12, 0.03, g);
        return Lg.greaterThan(0.72).select(highlight, Lg.greaterThan(0.42).select(mid, Lg.greaterThan(0.2).select(shadow, core)));
      },
    },
    lum,
    grit,
  );
}

/** Coarse + fine paper grain in [-0.5, 0.5], biased by the caller. */
export function paperGrain(c: CompGraph): CompNode {
  return c.custom(
    {
      name: 'paperGrain',
      kind: 'scalar',
      cpu: (_, ctx) => {
        const g1 = h21(Math.floor(ctx.x / 2), Math.floor(ctx.y / 2)) - 0.5;
        const g2 = h21(Math.floor(ctx.x) + 3, Math.floor(ctx.y) + 7) - 0.5;
        return g1 * 0.07 + g2 * 0.03;
      },
      tsl: (_, ctx) => {
        const px = ctx.px as TSLNode;
        const g1 = h21T(px.div(2)).sub(0.5);
        const g2 = h21T(px.add(vec2(3, 7))).sub(0.5);
        return g1.mul(0.07).add(g2.mul(0.03));
      },
    },
  );
}
