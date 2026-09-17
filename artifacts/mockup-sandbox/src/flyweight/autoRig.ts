/**
 * Automatic skinning for the Meshy chassis meshes.
 *
 * The generated .glb files are a single welded island each — 12k triangles, no
 * skin, no animation, no parts to detach. Cutting one into limbs would leave the
 * shoulder and hip sockets open, and a rotating arm would show straight through a
 * hollow torso. So instead of splitting the mesh we bind it: every vertex gets
 * weights against a skeleton fitted to the mesh's own silhouette, and the geometry
 * deforms at the joints rather than coming apart.
 *
 * The fit is measured, not hardcoded. Limbs on these models are spatially separated
 * even though the surface is welded (two leg lobes from the feet to the crotch, two
 * arm lobes either side of the torso), so scanning horizontal bands and taking lobe
 * centroids recovers a limb centreline without any authoring. That matters because
 * the three chassis have different proportions and are regenerated from prompts.
 *
 * Pure array maths, no three.js — so it can be checked in node against the raw .glb
 * before it is ever asked to render.
 */

export type V3 = [number, number, number];

export interface RestBone {
  name: string;
  /** joint start, in fitted space: feet on y=0, centred in x/z, height 1 */
  a: V3;
  /** joint end */
  b: V3;
  /** drives FK: a child's start rides its parent's rotation */
  parent: string | null;
}

/** Bone names, matching poseBot() in @workspace/sim so its output can drive this. */
export const BONE_NAMES = [
  'spine', 'neck', 'head',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'upperArmL', 'foreArmL', 'fistL', 'upperArmR', 'foreArmR', 'fistR',
  'wingL', 'wingR',
] as const;

const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);

/** Distance from point p to segment ab, and nothing else — the whole weighting rule. */
function distToSegment(px: number, py: number, pz: number, a: V3, b: V3): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const dd = dx * dx + dy * dy + dz * dz;
  let t = dd > 1e-9 ? ((px - a[0]) * dx + (py - a[1]) * dy + (pz - a[2]) * dz) / dd : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t), pz - (a[2] + dz * t));
}

export interface Normalised {
  /** positions rewritten so the feet sit on y=0, x/z centred, height exactly 1 */
  positions: Float32Array;
  /** scale that was applied, for anything that needs the original units */
  scale: number;
}

/** Put a mesh in fitted space: feet on the floor, centred, unit height. */
export function normalise(src: ArrayLike<number>): Normalised {
  const n = src.length / 3;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const scale = 1 / Math.max(1e-6, maxY - minY);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = (src[i * 3] - cx) * scale;
    out[i * 3 + 1] = (src[i * 3 + 1] - minY) * scale;
    out[i * 3 + 2] = (src[i * 3 + 2] - cz) * scale;
  }
  return { positions: out, scale };
}

/** Centroid of the points in a horizontal band that fall on one side of x = 0. */
function lobe(pos: Float32Array, lo: number, hi: number, side: number, minAbsX: number) {
  let sx = 0, sz = 0, count = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    if (y < lo || y >= hi) continue;
    const x = pos[i * 3];
    if (side * x <= minAbsX) continue;
    sx += x; sz += pos[i * 3 + 2]; count++;
  }
  return count ? { x: sx / count, z: sz / count, count } : null;
}

/** Fraction of a band's points that sit near the midline — near zero means two limbs. */
function midlineShare(pos: Float32Array, lo: number, hi: number, halfGap: number) {
  let inner = 0, total = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    if (y < lo || y >= hi) continue;
    total++;
    if (Math.abs(pos[i * 3]) < halfGap) inner++;
  }
  return total < 8 ? 1 : inner / total;
}

/**
 * Fit a 17-bone skeleton to a normalised mesh.
 *
 * Heights come from the model (the crotch is found by scanning upward for the band
 * where the two leg lobes merge); lateral and fore/aft positions come from lobe
 * centroids at those heights. Anatomical fractions are only used to place the knee
 * and elbow along a limb that has already been located, because a bent knee is not
 * reliably detectable as curvature on a 12k remesh.
 */
export function fitSkeleton(positions: Float32Array): RestBone[] {
  const BANDS = 64, bandH = 1 / BANDS;
  const at = (yn: number, side: number, minAbsX = 0.012) =>
    lobe(positions, yn - bandH, yn + bandH, side, minAbsX);

  // crotch: walk up from the ankles until the gap between the legs closes
  let crotch = 0.47;
  for (let b = 6; b < BANDS * 0.7; b++) {
    const y = b * bandH;
    if (midlineShare(positions, y, y + bandH, 0.03) > 0.18) { crotch = y; break; }
  }
  crotch = Math.min(0.56, Math.max(0.38, crotch));

  // Two different heights, and conflating them wrecks the fit: the spine has to run
  // all the way up to the neck so the torso keeps its own vertices, while the arm
  // pivots from a socket lower down. Measure them separately.

  // chest top: the last band that still has mass out at the shoulders, i.e. below
  // the point where the silhouette narrows into the head.
  let chestTop = 0.80;
  for (let b = Math.round(crotch * BANDS); b < BANDS; b++) {
    const y = b * bandH;
    const l = lobe(positions, y, y + bandH, -1, 0.14), r = lobe(positions, y, y + bandH, 1, 0.14);
    if (l && r && l.count > 6 && r.count > 6) chestTop = y;
  }
  chestTop = Math.min(0.86, Math.max(0.70, chestTop));

  // arm pivot: an arm hanging at the side leaves a gap in the lateral profile, so
  // look for a radius with almost nothing at it and real mass still outboard of it —
  // torso shell, air, then arm. The socket sits a little above the top of that gap.
  const armSeparated = (y: number) => {
    let sides = 0;
    for (const side of [-1, 1] as const) {
      const profile = new Array(14).fill(0);
      let n = 0;
      for (let i = 0; i < positions.length / 3; i++) {
        const vy = positions[i * 3 + 1];
        if (vy < y || vy >= y + bandH * 2) continue;
        const ax = side * positions[i * 3];
        if (ax <= 0) continue;
        profile[Math.min(13, Math.floor(ax / 0.035))]++; n++;
      }
      if (n < 25) continue;
      for (let k = 3; k < 10; k++) {
        let outboard = 0;
        for (let j = k + 1; j < 14; j++) outboard += profile[j];
        if (profile[k] < n * 0.035 && outboard > n * 0.12) { sides++; break; }
      }
    }
    return sides === 2;
  };
  let gapTop = 0.66;
  for (let b = Math.round(crotch * BANDS); b < Math.round(0.92 * BANDS); b++) {
    if (armSeparated(b * bandH)) gapTop = b * bandH + bandH * 2;
  }
  const shoulder = Math.min(0.80, Math.max(0.62, gapTop + 0.06));

  const bones: RestBone[] = [];
  const push = (name: string, a: V3, b: V3, parent: string | null) => bones.push({ name, a, b, parent });

  // torso: a straight column on the midline, leaning with the mesh's own z drift
  const hipZ = at(crotch - 0.04, 1)?.z ?? 0;
  const chestZ = at((crotch + chestTop) / 2 + 0.06, 1)?.z ?? 0;
  const pelvis: V3 = [0, crotch, hipZ];
  const chest: V3 = [0, chestTop, chestZ];
  const headBase: V3 = [0, chestTop + (1 - chestTop) * 0.28, chestZ];
  const headTop: V3 = [0, 0.985, chestZ - 0.02];
  push('spine', pelvis, chest, null);
  push('neck', chest, headBase, 'spine');
  push('head', headBase, headTop, 'neck');

  for (const side of [-1, 1] as const) {
    // poseBot lays its pose out with forward on −x and the sides on ±z; rotating that
    // into the arena's −z-forward frame sends poseBot's left onto +x. Name the fitted
    // bones to match, or every limb is rotated across the body to reach the other side.
    const tag = side < 0 ? 'R' : 'L';
    // legs: centreline sampled at hip, knee and ankle height on this side only
    const hipY = crotch, kneeY = crotch * 0.54, ankleY = 0.055;
    const hipS = at(hipY - 0.03, side, 0.01), kneeS = at(kneeY, side, 0.01), ankleS = at(ankleY, side, 0.01);
    const hip: V3 = [hipS?.x ?? side * 0.09, hipY, hipS?.z ?? hipZ];
    const knee: V3 = [kneeS?.x ?? side * 0.11, kneeY, kneeS?.z ?? hipZ];
    const ankle: V3 = [ankleS?.x ?? side * 0.12, ankleY, ankleS?.z ?? hipZ];
    // the toe is the most forward point of this foot, so the foot bone spans the sole
    let toeZ = ankle[2];
    for (let i = 0; i < positions.length / 3; i++) {
      const y = positions[i * 3 + 1];
      if (y > 0.075) continue;
      if (side * positions[i * 3] <= 0.01) continue;
      if (positions[i * 3 + 2] < toeZ) toeZ = positions[i * 3 + 2];
    }
    push(`thigh${tag}`, hip, knee, 'spine');
    push(`shin${tag}`, knee, ankle, `thigh${tag}`);
    push(`foot${tag}`, ankle, [ankle[0], 0.012, toeZ], `shin${tag}`);

    // arms: the outer lobe between crotch and shoulder is the arm hanging at the side
    const shoY = shoulder - 0.035;
    const sampleArm = (yn: number): { x: number; z: number } | null => {
      const band = lobe(positions, yn - bandH * 1.5, yn + bandH * 1.5, side, 0.11);
      return band && band.count > 5 ? band : null;
    };
    const armTop = sampleArm(shoY), armMid = sampleArm((shoY + crotch) / 2), armLow = sampleArm(crotch + 0.02);
    const shoulderPt: V3 = [armTop?.x ?? side * 0.2, shoY, armTop?.z ?? chestZ];
    const elbow: V3 = [armMid?.x ?? side * 0.24, (shoY + crotch) / 2 + 0.02, armMid?.z ?? chestZ];
    const fist: V3 = [armLow?.x ?? side * 0.25, crotch + 0.02, armLow?.z ?? chestZ];
    push(`upperArm${tag}`, shoulderPt, elbow, 'spine');
    push(`foreArm${tag}`, elbow, fist, `upperArm${tag}`);
    push(`fist${tag}`, fist, [fist[0], fist[1] - 0.055, fist[2] - 0.02], `foreArm${tag}`);

    // wing spars: whatever sits high and behind the chest
    const wingRoot: V3 = [side * 0.07, chestTop + 0.02, chestZ + 0.05];
    push(`wing${tag}`, wingRoot, [side * 0.26, chestTop + 0.1, chestZ + 0.26], 'spine');
  }
  return bones;
}

/**
 * Per-vertex bone weights.
 *
 * Distance to the nearest bone segment decides ownership, and only bones within
 * `band` of that nearest one get any share. A robot wants stiff joints, so the blend
 * zone is deliberately narrow — wide enough that the shoulder stretches instead of
 * tearing, tight enough that the torso does not follow a punch.
 */
export function computeSkinWeights(positions: ArrayLike<number>, bones: RestBone[], band = 0.05) {
  const n = positions.length / 3, nb = bones.length;
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const d = new Float64Array(nb);
  for (let i = 0; i < n; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    let best = Infinity;
    for (let b = 0; b < nb; b++) {
      d[b] = distToSegment(px, py, pz, bones[b].a, bones[b].b);
      if (d[b] < best) best = d[b];
    }
    // keep the four closest bones that fall inside the blend band
    const picked: Array<{ b: number; w: number }> = [];
    for (let b = 0; b < nb; b++) {
      if (d[b] > best + band) continue;
      const t = 1 - (d[b] - best) / band;
      picked.push({ b, w: t * t * t });
    }
    picked.sort((p, q) => q.w - p.w);
    picked.length = Math.min(4, picked.length);
    let sum = 0;
    for (const p of picked) sum += p.w;
    for (let k = 0; k < 4; k++) {
      const p = picked[k];
      skinIndex[i * 4 + k] = p ? p.b : 0;
      skinWeight[i * 4 + k] = p ? p.w / sum : 0;
    }
  }
  return { skinIndex, skinWeight };
}

/** Rough per-bone vertex ownership, for checking a fit without rendering it. */
export function boneOwnership(positions: ArrayLike<number>, bones: RestBone[]) {
  const counts = new Array(bones.length).fill(0);
  for (let i = 0; i < positions.length / 3; i++) {
    let best = Infinity, bestB = 0;
    for (let b = 0; b < bones.length; b++) {
      const dd = distToSegment(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], bones[b].a, bones[b].b);
      if (dd < best) { best = dd; bestB = b; }
    }
    counts[bestB]++;
  }
  return counts;
}

export const boneLength = (b: RestBone) => len(sub(b.b, b.a));
