/**
 * TSL twins of the Noise Texture reference ops in blender-ops.ts: Blender's
 * jenkins lookup3 hash on the integer lattice, classic Perlin with the fade
 * curve and 4-bit gradient table, the 0.9820 scale, and the fbm sum. Every
 * constant matches the vendored GLSL; the CPU side is the spec, the parity is
 * pinned by the probe.
 *
 * All hashing is done in u32 (wrapping WGSL arithmetic), so GPU and CPU agree
 * bit for bit on the lattice values.
 */
import { Fn, abs, dot, float, floatBitsToUint, floor, int, length, mix, normalize, pow, select, sin, smoothstep, uint, vec3, vec4 } from 'three/tsl';
import { hashUint2ToFloat, floatBitsOf } from '../transpiler/blender-ops';
import type { TSLNode } from './compile';

const rot = (x: TSLNode, k: number): TSLNode => x.shiftLeft(uint(k)).bitOr(x.shiftRight(uint(32 - k)));

/** jenkins final(a, b, c) -> c */
function jenkinsFinal(a0: TSLNode, b0: TSLNode, c0: TSLNode): TSLNode {
  let a: TSLNode = a0, b: TSLNode = b0, c: TSLNode = c0;
  c = c.bitXor(b); c = c.sub(rot(b, 14));
  a = a.bitXor(c); a = a.sub(rot(c, 11));
  b = b.bitXor(a); b = b.sub(rot(a, 25));
  c = c.bitXor(b); c = c.sub(rot(b, 16));
  a = a.bitXor(c); a = a.sub(rot(c, 4));
  b = b.bitXor(a); b = b.sub(rot(a, 14));
  c = c.bitXor(b); c = c.sub(rot(b, 24));
  return c;
}
const HASH_INIT3 = (0xdeadbeef + (3 << 2) + 13) >>> 0;

/** hash_uint3 on lattice ints (float nodes holding integers). */
export function tslHashInt3(x: TSLNode, y: TSLNode, z: TSLNode): TSLNode {
  const init = uint(HASH_INIT3);
  return jenkinsFinal(init.add(uint(int(x))), init.add(uint(int(y))), init.add(uint(int(z))));
}

const fade = (t: TSLNode): TSLNode => t.mul(t).mul(t).mul(t.mul(t.mul(6).sub(15)).add(10));
const negateIf = (v: TSLNode, cond: TSLNode): TSLNode => select(cond.notEqual(uint(0)), v.negate(), v);

function noiseGrad3(hash: TSLNode, x: TSLNode, y: TSLNode, z: TSLNode): TSLNode {
  const h = hash.bitAnd(uint(15));
  const u = select(h.lessThan(uint(8)), x, y);
  const vt = select(h.equal(uint(12)).or(h.equal(uint(14))), x, z);
  const v = select(h.lessThan(uint(4)), y, vt);
  return negateIf(u, h.bitAnd(uint(1))).add(negateIf(v, h.bitAnd(uint(2))));
}

/**
 * noise_perlin(float3), unscaled. Emitted as ONE WGSL function (TSL Fn) and called per lookup:
 * inlining it made a graph with ten Noise nodes a single expression of ~80 jenkins mixes, which
 * Metal's compiler took tens of seconds on (P7). The function body is identical to the inline form.
 */
const perlin3Fn = Fn(([pIn]: [TSLNode]) => tslNoisePerlin3Inline(pIn as TSLNode)).setLayout({
  name: 'b2t_perlin3',
  type: 'float',
  inputs: [{ name: 'p', type: 'vec3' }],
});
export function tslNoisePerlin3(p: TSLNode): TSLNode {
  return perlin3Fn(p) as unknown as TSLNode;
}
function tslNoisePerlin3Inline(p: TSLNode): TSLNode {
  const X: TSLNode = floor(p.x), Y: TSLNode = floor(p.y), Z: TSLNode = floor(p.z);
  const fx: TSLNode = p.x.sub(X), fy: TSLNode = p.y.sub(Y), fz: TSLNode = p.z.sub(Z);
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const g = (dx: number, dy: number, dz: number) =>
    noiseGrad3(tslHashInt3(X.add(dx), Y.add(dy), Z.add(dz)), fx.sub(dx), fy.sub(dy), fz.sub(dz));
  const x1 = float(1).sub(u), y1 = float(1).sub(v), z1 = float(1).sub(w);
  const lerpX = (a: TSLNode, b: TSLNode) => a.mul(x1).add(b.mul(u));
  const bottom = y1.mul(lerpX(g(0, 0, 0), g(1, 0, 0))).add(v.mul(lerpX(g(0, 1, 0), g(1, 1, 0))));
  const top = y1.mul(lerpX(g(0, 0, 1), g(1, 0, 1))).add(v.mul(lerpX(g(0, 1, 1), g(1, 1, 1))));
  return z1.mul(bottom).add(w.mul(top));
}

/** compatible_mod for the 100000 repeat: a - trunc(a / b) * b. */
const compatMod = (a: TSLNode, b: number): TSLNode => a.sub(a.div(b).trunc().mul(b));

/** snoise(float3): repeat, precision correction, 0.9820 scale. */
export function tslSnoise3(p: TSLNode): TSLNode {
  const corr = vec3(
    select(abs(p.x).greaterThanEqual(1e6), 0.5, 0),
    select(abs(p.y).greaterThanEqual(1e6), 0.5, 0),
    select(abs(p.z).greaterThanEqual(1e6), 0.5, 0),
  );
  const q = vec3(compatMod(p.x, 100000), compatMod(p.y, 100000), compatMod(p.z, 100000)).add(corr);
  return tslNoisePerlin3(q).mul(0.982);
}

/** noise_fbm(float3) with constant detail/roughness/lacunarity (loop unrolled). */
export function tslNoiseFbm3(p: TSLNode, detail: number, roughness: number, lacunarity: number, normalize: boolean): TSLNode {
  let fscale = 1, amp = 1, maxamp = 0;
  let sum: TSLNode = float(0);
  for (let i = 0; i <= Math.trunc(detail); i++) {
    sum = sum.add(tslSnoise3(p.mul(fscale)).mul(amp));
    maxamp += amp;
    amp *= roughness;
    fscale *= lacunarity;
  }
  const rmd = detail - Math.floor(detail);
  if (rmd !== 0) {
    const t = tslSnoise3(p.mul(fscale));
    const sum2 = sum.add(t.mul(amp));
    if (normalize) return mix(sum.mul(0.5 / maxamp).add(0.5), sum2.mul(0.5 / (maxamp + amp)).add(0.5), rmd);
    return mix(sum, sum2, rmd);
  }
  return normalize ? sum.mul(0.5 / maxamp).add(0.5) : sum;
}

/** random_vec3_offset(seed) as constants (seed and k are float32 bit patterns hashed together). */
function randomVec3Offset(seed: number): TSLNode {
  const s = floatBitsOf(seed);
  return vec3(
    100 + hashUint2ToFloat(s, floatBitsOf(0)) * 100,
    100 + hashUint2ToFloat(s, floatBitsOf(1)) * 100,
    100 + hashUint2ToFloat(s, floatBitsOf(2)) * 100,
  );
}

export interface TslNoiseParams {
  scale: TSLNode;
  detail: number;
  roughness: number;
  lacunarity: number;
  distortion: number;
  normalize: boolean;
}

/** node_noise_tex_fbm_3d: { fac, color }. */
export function tslNoiseTex3D(co: TSLNode, params: TslNoiseParams): { fac: TSLNode; color: TSLNode } {
  const detail = Math.min(15, Math.max(0, params.detail));
  const roughness = Math.max(params.roughness, 0);
  let p: TSLNode = co.mul(params.scale);
  if (params.distortion !== 0) {
    p = p.add(
      vec3(
        tslSnoise3(p.add(randomVec3Offset(0))).mul(params.distortion),
        tslSnoise3(p.add(randomVec3Offset(1))).mul(params.distortion),
        tslSnoise3(p.add(randomVec3Offset(2))).mul(params.distortion),
      ),
    );
  }
  const fac = tslNoiseFbm3(p, detail, roughness, params.lacunarity, params.normalize);
  const g = tslNoiseFbm3(p.add(randomVec3Offset(3)), detail, roughness, params.lacunarity, params.normalize);
  const b = tslNoiseFbm3(p.add(randomVec3Offset(4)), detail, roughness, params.lacunarity, params.normalize);
  return { fac, color: vec4(fac, g, b, 1) };
}

/**
 * node_tex_wave / calc_wave (gpu_shader_material_tex_wave.glsl), on the GPU.
 *
 * The branches on type, direction and profile are resolved at BUILD time from
 * the node's enum params rather than emitted as selects, because Blender stores
 * them as enums and they cannot change without rebuilding the graph anyway.
 * That keeps the emitted WGSL to the one path actually taken.
 */
export interface TslWaveParams {
  scale: TSLNode;
  distortion: TSLNode;
  detail: number;
  detailScale: TSLNode;
  detailRoughness: number;
  phase: TSLNode;
  waveType: 'BANDS' | 'RINGS';
  bandsDirection: 'X' | 'Y' | 'Z' | 'DIAGONAL';
  ringsDirection: 'X' | 'Y' | 'Z' | 'SPHERICAL';
  waveProfile: 'SIN' | 'SAW' | 'TRI';
}

export function tslWaveTex3D(co: TSLNode, o: TslWaveParams): { fac: TSLNode; color: TSLNode } {
  const scaled = co.mul(o.scale);
  // Blender's own precision guard on unit coordinates, kept verbatim
  const p = scaled.add(float(0.000001)).mul(float(0.999999));

  let n: TSLNode;
  if (o.waveType === 'BANDS') {
    if (o.bandsDirection === 'X') n = p.x.mul(20);
    else if (o.bandsDirection === 'Y') n = p.y.mul(20);
    else if (o.bandsDirection === 'Z') n = p.z.mul(20);
    else n = p.x.add(p.y).add(p.z).mul(10);
  } else {
    const rp =
      o.ringsDirection === 'X' ? vec3(0, p.y, p.z)
      : o.ringsDirection === 'Y' ? vec3(p.x, 0, p.z)
      : o.ringsDirection === 'Z' ? vec3(p.x, p.y, 0)
      : p;
    n = length(rp).mul(20);
  }
  n = n.add(o.phase);
  // the distortion term is always emitted: `distortion` is a socket and may be
  // driven, so branching on it at build time would bake in whatever it was
  n = n.add(o.distortion.mul(tslNoiseFbm3(p.mul(o.detailScale), o.detail, o.detailRoughness, 2, true).mul(2).sub(1)));

  let f: TSLNode;
  if (o.waveProfile === 'SIN') {
    f = float(0.5).add(float(0.5).mul(sin(n.sub(float(Math.PI / 2)))));
  } else if (o.waveProfile === 'SAW') {
    const m = n.div(float(2 * Math.PI));
    f = m.sub(floor(m));
  } else {
    const m = n.div(float(2 * Math.PI));
    f = abs(m.sub(floor(m.add(float(0.5))))).mul(2);
  }
  return { fac: f, color: vec4(f, f, f, 1) };
}

/* ---------------- Voronoi, on the GPU ----------------
 * The cell loops are unrolled at BUILD time because their bounds are fixed by
 * the feature (3x3x3 for F1 and Distance to Edge, 5x5x5 for Smooth F1). What is
 * NOT inlined is the hash: 125 copies of a jenkins chain is the compile bomb P7
 * documents, so hash_vec3_to_vec3 is emitted once as a WGSL function and called
 * per cell. */

const HASH_INIT4 = (0xdeadbeef + (4 << 2) + 13) >>> 0;

/** the Jenkins mix step, needed by hash_uint4 (hash_uint3 only needs final). */
function jenkinsMixTsl(a0: TSLNode, b0: TSLNode, c0: TSLNode): [TSLNode, TSLNode, TSLNode] {
  const rot = (x: TSLNode, k: number) => x.shiftLeft(uint(k)).bitOr(x.shiftRight(uint(32 - k)));
  let a = a0, b = b0, c = c0;
  a = a.sub(c); a = a.bitXor(rot(c, 4)); c = c.add(b);
  b = b.sub(a); b = b.bitXor(rot(a, 6)); a = a.add(c);
  c = c.sub(b); c = c.bitXor(rot(b, 8)); b = b.add(a);
  a = a.sub(c); a = a.bitXor(rot(c, 16)); c = c.add(b);
  b = b.sub(a); b = b.bitXor(rot(a, 19)); a = a.add(c);
  c = c.sub(b); c = c.bitXor(rot(b, 4)); b = b.add(a);
  return [a, b, c];
}

/** hash_vec3_to_vec3, as one function rather than 125 inlined copies. */
const hashVec3ToVec3Fn = Fn(([k]: [TSLNode]) => {
  const kv = k as TSLNode;
  const bx = floatBitsToUint(kv.x) as TSLNode, by = floatBitsToUint(kv.y) as TSLNode, bz = floatBitsToUint(kv.z) as TSLNode;
  const inv = float(1).div(float(0xffffffff));
  const h3 = tslHashUint3(bx, by, bz).toFloat().mul(inv);
  const one = floatBitsToUint(float(1)) as TSLNode;
  const two = floatBitsToUint(float(2)) as TSLNode;
  const h4a = tslHashUint4(bx, by, bz, one).toFloat().mul(inv);
  const h4b = tslHashUint4(bx, by, bz, two).toFloat().mul(inv);
  return vec3(h3, h4a, h4b);
}).setLayout({ name: 'b2t_hash_vec3_to_vec3', type: 'vec3', inputs: [{ name: 'k', type: 'vec3' }] });

function tslHashUint3(x: TSLNode, y: TSLNode, z: TSLNode): TSLNode {
  const init = uint(HASH_INIT3);
  return jenkinsFinal(init.add(x), init.add(y), init.add(z));
}
function tslHashUint4(x: TSLNode, y: TSLNode, z: TSLNode, w: TSLNode): TSLNode {
  const init = uint(HASH_INIT4);
  const [a, b, c] = jenkinsMixTsl(init.add(x), init.add(y), init.add(z));
  return jenkinsFinal(a.add(w), b, c);
}

export interface TslVoronoiParams {
  scale: TSLNode;
  randomness: TSLNode;
  smoothness: TSLNode;
  exponent: TSLNode;
  metric: 'EUCLIDEAN' | 'MANHATTAN' | 'CHEBYCHEV' | 'MINKOWSKI';
  feature: 'F1' | 'SMOOTH_F1' | 'DISTANCE_TO_EDGE';
  dimensions: '2D' | '3D';
}

function voroDist(a: TSLNode, b: TSLNode, o: TslVoronoiParams): TSLNode {
  const d = a.sub(b).abs();
  const three = o.dimensions === '3D';
  switch (o.metric) {
    case 'EUCLIDEAN': return three ? length(a.sub(b)) : length(vec3(d.x, d.y, 0));
    case 'MANHATTAN': return three ? d.x.add(d.y).add(d.z) : d.x.add(d.y);
    case 'CHEBYCHEV': return three ? d.x.max(d.y).max(d.z) : d.x.max(d.y);
    case 'MINKOWSKI': {
      const e = o.exponent;
      const s = pow(d.x, e).add(pow(d.y, e)).add(three ? pow(d.z, e) : float(0));
      return pow(s, float(1).div(e));
    }
  }
}

/**
 * Voronoi F1 COLOR: the winning cell's random colour.
 *
 * Carries the winning OFFSET alongside the running minimum instead of finding
 * the minimum and then re-scanning for it. A second pass comparing against the
 * final minimum would rely on two separately-compiled expressions producing a
 * bit-identical float, which is not something to bet a shader on.
 *
 * Every step is materialised with .toVar(). Without it the 27 nested selects
 * grow the expression tree superlinearly and the shader stops compiling, which
 * is the same failure the distance-to-edge feature hit.
 */
export function tslVoronoiColorF1(co: TSLNode, o: TslVoronoiParams): TSLNode {
  const three = o.dimensions === '3D';
  const c = three ? co.mul(o.scale) : vec3(co.x.mul(o.scale), co.y.mul(o.scale), 0);
  const cell = floor(c).toVar();
  const local = c.sub(cell).toVar();
  const rnd = o.randomness.clamp(0, 1);

  const jitter = (i: number, j: number, k: number): TSLNode => {
    const off = vec3(i, j, three ? k : 0);
    const at = cell.add(off);
    const h = three
      ? hashVec3ToVec3Fn(at)
      : vec3(hashVec2ToVec2Fn(vec3(at.x, at.y, 0)).x, hashVec2ToVec2Fn(vec3(at.x, at.y, 0)).y, 0);
    return off.add(h.mul(rnd));
  };

  const R = three ? 1 : 0;
  let minD: TSLNode = float(1e30).toVar();
  let target: TSLNode = vec3(0, 0, 0).toVar();
  for (let k = -R; k <= R; k++)
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const off = vec3(i, j, three ? k : 0);
        const d = voroDist(jitter(i, j, k), local, o).toVar();
        // the winner is decided against the PREVIOUS minimum, so the offset and
        // the distance stay in step
        target = select(d.lessThan(minD), off, target).toVar();
        minD = minD.min(d).toVar();
      }
  // TSLNode is the codebase's `any` alias; .toVar() narrows cell to a typed
  // node and the swizzles below stop type-checking without it
  const at: TSLNode = cell.add(target);
  return three ? hashVec3ToVec3Fn(at) : hashVec2ToVec3Fn(vec3(at.x, at.y, 0));
}

export function tslVoronoiTex(co: TSLNode, o: TslVoronoiParams): TSLNode {
  const three = o.dimensions === '3D';
  const c = three ? co.mul(o.scale) : vec3(co.x.mul(o.scale), co.y.mul(o.scale), 0);
  const cell = floor(c);
  const local = c.sub(cell);
  // Blender halves and clamps smoothness in INITIALIZE_VORONOIPARAMS
  const smooth = o.smoothness.div(2).clamp(0, 0.5);
  const rnd = o.randomness.clamp(0, 1);

  const jitter = (i: number, j: number, k: number): TSLNode => {
    const off = vec3(i, j, three ? k : 0);
    const at = cell.add(off);
    const h = three
      ? hashVec3ToVec3Fn(at)
      : vec3(hashVec2ToVec2Fn(vec3(at.x, at.y, 0)).x, hashVec2ToVec2Fn(vec3(at.x, at.y, 0)).y, 0);
    return off.add(h.mul(rnd));
  };

  const R = three ? 1 : 0;
  if (o.feature === 'F1') {
    let minD: TSLNode = float(1e30);
    for (let k = -R; k <= R; k++)
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) minD = minD.min(voroDist(jitter(i, j, k), local, o)).toVar();
    return minD;
  }

  if (o.feature === 'SMOOTH_F1') {
    const S = three ? 2 : 0;
    let sd: TSLNode = float(0);
    let first = true;
    for (let k = -S; k <= S; k++)
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const d = voroDist(jitter(i, j, k), local, o);
          // h is 1 on the first cell (Blender's h == -1 sentinel), smoothstep after
          const h: TSLNode = first ? float(1) : (smoothstep(float(0), float(1), float(0.5).add((float(0.5).mul(sd.sub(d) as TSLNode) as TSLNode).div(smooth)) as TSLNode) as TSLNode).toVar();
          first = false;
          sd = mix(sd, d, h).sub(smooth.mul(h).mul(float(1).sub(h))).toVar();
        }
    return sd;
  }

  // DISTANCE_TO_EDGE
  //
  // Every accumulator here is .toVar(). Without it each iteration NESTS inside
  // the last (minSq references minSq references minSq...), and because
  // `toClosest` also branches on `minSq` the expression tree grows faster than
  // linearly over 27 cells: the probe page stopped compiling altogether, which
  // is P7's compile bomb by a different route than inlining. toVar materialises
  // each step as a WGSL variable, so the shader is 27 assignments rather than
  // one enormous expression. The values are identical; only the emitted form
  // changes.
  // Wrapped in Fn(). TSL's .assign() is a STATEMENT, and a statement needs a
  // function body to be appended to: built at the top level of a node graph the
  // assigns are silently dropped, which is why this read back 65504 (the
  // half-float ceiling, i.e. minD never written) while F1 next door was fine.
  // F1 is a pure .min() expression chain and needs no scope; distance-to-edge
  // genuinely needs statements, so it gets a function.
  return Fn(() => {
  // ONE variable per accumulator, mutated with .assign(). Two earlier forms were
  // wrong: building a fresh nested select each iteration made the expression
  // tree grow faster than linearly and the shader stopped compiling at all
  // (P7's bomb by a different route than inlining), and rebinding to a NEW
  // .toVar() each iteration compiled but read back zero, because the reads and
  // the writes no longer referred to the same storage. This is the canonical
  // TSL mutable-accumulator shape and it is what the loop actually means.
  const minSq = float(1e30).toVar();
  const toClosest = vec3(0, 0, 0).toVar();
  for (let k = -R; k <= R; k++)
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const v = (jitter(i, j, k).sub(local) as TSLNode).toVar();
        const d = (dot(v, v) as TSLNode).toVar();
        const closer = d.lessThan(minSq);
        toClosest.assign(select(closer, v, toClosest as TSLNode) as TSLNode);
        minSq.assign(select(closer, d, minSq as TSLNode) as TSLNode);
      }
  // Copied into its own variable before the second pass. The first pass's
  // assignments reference the per-cell `v` variables, and the second pass
  // creates its own; reading `toClosest` directly there picked up the wrong
  // storage and the edge test never fired (GPU read back 65504, the half-float
  // ceiling, i.e. minD untouched).
  const closest = vec3((toClosest as TSLNode).x, (toClosest as TSLNode).y, (toClosest as TSLNode).z).toVar();
  const minD = float(1e30).toVar();
  for (let k = -R; k <= R; k++)
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const v = (jitter(i, j, k).sub(local) as TSLNode).toVar();
        const perp = (v.sub(closest as TSLNode) as TSLNode).toVar();
        const pl = dot(perp, perp);
        const dEdge = dot((closest as TSLNode).add(v).div(2) as TSLNode, normalize(perp) as TSLNode);
        minD.assign(select(pl.greaterThan(float(0.0001)), (minD as TSLNode).min(dEdge) as TSLNode, minD as TSLNode) as TSLNode);
      }
  return minD as TSLNode;
  })() as TSLNode;
}

/** hash_vec2_to_vec2: second component hashes vec3(k, 1) through the THREE-input chain. */
const hashVec2ToVec2Fn = Fn(([k]: [TSLNode]) => {
  const kv = k as TSLNode;
  const bx = floatBitsToUint(kv.x) as TSLNode, by = floatBitsToUint(kv.y) as TSLNode;
  const inv = float(1).div(float(0xffffffff));
  const one = floatBitsToUint(float(1)) as TSLNode;
  return vec3(
    jenkinsFinal(uint(HASH_INIT2).add(bx), uint(HASH_INIT2).add(by), uint(HASH_INIT2)).toFloat().mul(inv),
    tslHashUint3(bx, by, one).toFloat().mul(inv),
    float(0),
  );
}).setLayout({ name: 'b2t_hash_vec2_to_vec2', type: 'vec3', inputs: [{ name: 'k', type: 'vec3' }] });

const HASH_INIT2 = (0xdeadbeef + (2 << 2) + 13) >>> 0;
/**
 * hash_vector2_to_vector3: the 2D Voronoi CELL COLOUR.
 *
 * The third channel is hash_vec3_to_float(k, 2) and is NOT zero. Reusing
 * hashVec2ToVec2Fn here (whose third component is a literal 0) tints the whole
 * 2D field blue, which reads as a colour-space problem rather than a wrong hash.
 */
const hashVec2ToVec3Fn = Fn(([k]: [TSLNode]) => {
  const kv = k as TSLNode;
  const bx = floatBitsToUint(kv.x) as TSLNode, by = floatBitsToUint(kv.y) as TSLNode;
  const inv = float(1).div(float(0xffffffff));
  const one = floatBitsToUint(float(1)) as TSLNode;
  const two = floatBitsToUint(float(2)) as TSLNode;
  return vec3(
    jenkinsFinal(uint(HASH_INIT2).add(bx), uint(HASH_INIT2).add(by), uint(HASH_INIT2)).toFloat().mul(inv),
    tslHashUint3(bx, by, one).toFloat().mul(inv),
    tslHashUint3(bx, by, two).toFloat().mul(inv),
  );
}).setLayout({ name: 'b2t_hash_vec2_to_vec3', type: 'vec3', inputs: [{ name: 'k', type: 'vec3' }] });

