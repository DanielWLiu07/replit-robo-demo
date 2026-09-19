/**
 * Automatic skinning for the Meshy chassis meshes.
 *
 * The generated .glb files are a single welded island each, 12k triangles, no
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
 * Pure array maths, no three.js, so it can be checked in node against the raw .glb
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

/**
 * Bone names, matching poseBot() in @workspace/sim so its output can drive this.
 *
 * IN THE ORDER fitSkeleton ACTUALLY PUSHES THEM: the torso, then one whole side
 * (leg, then arm, then wing), then the other. It used to list every leg and then
 * every arm, which is not what the loop below builds: nothing read it, so nothing
 * broke, but it cost an afternoon of chasing a skinning bug that was not there.
 * Rig code should index through `rest`, which carries its own names.
 */
export const BONE_NAMES = [
  'spine', 'neck', 'head',
  'thighR', 'shinR', 'footR', 'upperArmR', 'foreArmR', 'fistR', 'wingR',
  'thighL', 'shinL', 'footL', 'upperArmL', 'foreArmL', 'fistL', 'wingL',
] as const;

const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);

/** Distance from point p to segment ab, and nothing else, the whole weighting rule. */
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

/**
 * Does this mesh face +Z, and so need turning around?
 *
 * The arena drives everything with forward on local −Z, but the generator emits these
 * facing +Z, which is why an unturned fighter moonwalks and throws its punches out of
 * its own back. Decide it from the feet: a biped's foot is strongly asymmetric about
 * the ankle, with the toe reaching several times further than the heel, and that holds
 * on all three chassis. The head is not usable for this, on these models the greatest
 * protrusion at head height is the swept-back wing spar, which points the other way.
 */
export function facesPositiveZ(positions: ArrayLike<number>): boolean {
  const n = positions.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = positions[i * 3 + 1];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const h = Math.max(1e-6, maxY - minY);
  let ankleZ = 0, ankleN = 0;
  for (let i = 0; i < n; i++) {
    const yn = (positions[i * 3 + 1] - minY) / h;
    if (yn >= 0.09 && yn < 0.15) { ankleZ += positions[i * 3 + 2]; ankleN++; }
  }
  if (!ankleN) return false;
  ankleZ /= ankleN;
  let toe = 0, heel = 0;
  for (let i = 0; i < n; i++) {
    if ((positions[i * 3 + 1] - minY) / h >= 0.05) continue;
    const d = positions[i * 3 + 2] - ankleZ;
    if (d > toe) toe = d;
    if (-d > heel) heel = -d;
  }
  return toe > heel;
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

/** Fraction of a band's points that sit near the midline, near zero means two limbs. */
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
  // look for a radius with almost nothing at it and real mass still outboard of it,
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

    /**
     * Arms: the outer lobe between crotch and shoulder.
     *
     * This depends entirely on the model being posed with its arms OUT, away from
     * the torso. The first fly models were generated in a boxing guard, elbows bent,
     * forearms folded up beside the head, and a folded limb doubles back on itself,
     * so no silhouette fit can separate forearm from bicep. Measured on those: the
     * hand bone owned 57 and 50 vertices while the shoulder owned 1414, and a punch
     * visibly rotated the shoulder plate instead of an arm.
     *
     * Regenerating the chassis with arms extended fixed it at the source, the same
     * code now gives the hands 830 and 749. If the models are ever regenerated again,
     * keep the arms out and straight, and keep a distinct forearm and fist.
     */
    // the outer lobe between crotch and shoulder is the arm held out at the side
    const shoY = shoulder - 0.035;
    /**
     * Where this side's arm sits, laterally, at the shoulder, the line the limb
     * follows down. Everything below keys off it rather than off a fixed 0.11,
     * which is close enough to the midline to also catch hip and abdomen armour:
     * the downward walk then ran past the real hand and the fist bone swept up a
     * band 0.15 units tall of body plating, which is what made a punch drag the
     * armour along with it.
     */
    const armLineX = Math.abs(lobe(positions, shoY - bandH * 1.5, shoY + bandH * 1.5, side, 0.11)?.x ?? 0.2);
    const sampleArm = (yn: number, strict = false): { x: number; z: number } | null => {
      const minX = strict ? armLineX * 0.72 : 0.11;
      const band = lobe(positions, yn - bandH * 1.5, yn + bandH * 1.5, side, minX);
      return band && band.count > 5 ? band : null;
    };

    /**
     * Fit the chain to where the arm ACTUALLY ENDS, not to a hardcoded crotch line.
     *
     * The elbow and wrist used to be placed at fixed fractions between the shoulder
     * and the crotch, on the assumption that an arm hangs the full height of the
     * torso. This model's does not, so the lower two bones were left dangling below
     * the geometry. Measured: `upperArm` owned 1436 vertices of shoulder plate while
     * `foreArm` owned 214 and `fist` owned FOUR on one side and ZERO on the other.
     * Throwing a punch therefore rotated the pauldron and moved nothing that looks
     * like an arm.
     *
     * Walking down the side until the lobe runs out finds the real bottom of the
     * limb, and thirds of THAT give each bone a share of the geometry to drive.
     */
    //
    // The walk must STOP at the hips. Below the crotch the "outer lobe" this samples
    // is the LEG, not the arm, so an unbounded search ran the chain down the thigh
    // and the hand ended up owning 243 vertices of upper leg (y 0.28-0.42 against a
    // thigh spanning 0.25-0.54), a punch would then drag the thigh with it.
    let armBottom = shoY;
    const floorY = crotch + 0.04;
    for (let yn = shoY; yn > floorY; yn -= 0.01) {
      if (!sampleArm(yn, true)) break;   // strict: must still be out on the arm line
      armBottom = yn;
    }
    if (armBottom < floorY) armBottom = floorY;
    // a limb needs enough length to be worth three bones; fall back if the lobe is
    // too shallow to split
    if (shoY - armBottom < 0.12) armBottom = Math.max(crotch + 0.02, shoY - 0.12);

    /**
     * Elbow and wrist at fractions of the limb's LENGTH.
     *
     * I tried splitting by vertex count instead, so each bone would drive an equal
     * share of geometry. It backfired: 45% of this arm's vertices sit above y 0.68
     * because the shoulder is bulky, so both joints were dragged up next to it and
     * the forearm bone came out 0.06 long against a 0.37 limb. Bone placement should
     * follow the limb; the skin weights are what handle an uneven taper.
     */
    const limb = shoY - armBottom;
    const elbowY = shoY - limb * 0.45;
    const wristY = shoY - limb * 0.80;
    const armTop = sampleArm(shoY), armMid = sampleArm(elbowY), armLow = sampleArm(wristY);
    const shoulderPt: V3 = [armTop?.x ?? side * 0.2, shoY, armTop?.z ?? chestZ];
    const elbow: V3 = [armMid?.x ?? side * 0.24, elbowY, armMid?.z ?? chestZ];
    const fist: V3 = [armLow?.x ?? side * 0.25, wristY, armLow?.z ?? chestZ];
    push(`upperArm${tag}`, shoulderPt, elbow, 'spine');
    push(`foreArm${tag}`, elbow, fist, `upperArm${tag}`);
    // the hand continues the forearm's own direction rather than dropping straight
    // down, so it lands on geometry instead of in the air below the limb
    const armDir: V3 = [fist[0] - elbow[0], fist[1] - elbow[1], fist[2] - elbow[2]];
    const adLen = Math.hypot(armDir[0], armDir[1], armDir[2]) || 1;
    const hand = 0.055;
    push(`fist${tag}`, fist, [fist[0] + (armDir[0] / adLen) * hand,
                              fist[1] + (armDir[1] / adLen) * hand,
                              fist[2] + (armDir[2] / adLen) * hand], `foreArm${tag}`);

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
 * zone is deliberately narrow, wide enough that the shoulder stretches instead of
 * tearing, tight enough that the torso does not follow a punch.
 */
/**
 * Smooth skin weights by inverse-power falloff, the goose rig's scheme.
 *
 * This used to keep only bones within a 0.05 BAND of the nearest one, which on a
 * long thin limb is not a blend at all: `upperArm` is closest to nearly every arm
 * vertex, so the elbow and wrist were excluded outright. Measured on the chassis,
 * `foreArm` owned ~200 vertices per side and `fist` owned FOUR and ZERO. Rotating
 * those joints deformed almost nothing, so an arm swung like one rigid stick and
 * a thrown punch barely changed the silhouette.
 *
 * Weighting every bone by 1/d^falloff and keeping the best four gives each joint
 * real ownership of the geometry around it, and the limb bends where a limb bends.
 * Higher falloff = stiffer, more local; 3.2 is what the goose uses.
 */
/** How much further than the NEAREST bone another may be and still matter. */
const SPREAD = 2.2;

export function computeSkinWeights(positions: ArrayLike<number>, bones: RestBone[], falloff = 3.2) {
  const n = positions.length / 3, nb = bones.length;
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);

  /**
   * Which bones may share a vertex: itself, its parent, and its children.
   *
   * Distance alone cannot rig this model. `fitSkeleton` hangs the arms down to
   * crotch height, so the fist bone ends up sitting almost exactly on the thigh,
   * measured, the fist centroid is at x −0.107 against the thigh's −0.104. Any
   * purely spatial weighting therefore hands arm bones real ownership of leg
   * geometry, and a thrown punch drags part of the leg with it (worst vertex: 60%
   * arm-driven).
   *
   * The skeleton already knows what is connected to what. A thigh and an upper arm
   * are SIBLINGS, both children of the spine, so they never share a vertex, while
   * a forearm still blends smoothly into its own upper arm and fist. This is the
   * cheap stand-in for geodesic (along-the-surface) distance that a real rigger
   * would use, and it costs one lookup.
   */
  const index = new Map(bones.map((b, i) => [b.name, i]));
  const kin: Array<Set<number>> = bones.map((b, i) => {
    const k = new Set<number>([i]);
    if (b.parent !== null) {
      const p = index.get(b.parent);
      if (p !== undefined) k.add(p);
    }
    return k;
  });
  bones.forEach((b, i) => {
    if (b.parent === null) return;
    const p = index.get(b.parent);
    if (p !== undefined) kin[p]!.add(i);      // children may share with their parent
  });

  const scored: Array<{ b: number; w: number }> = [];
  const dist = new Float64Array(nb);
  for (let i = 0; i < n; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    scored.length = 0;
    let nearest = Infinity, owner = 0;
    for (let b = 0; b < nb; b++) {
      dist[b] = distToSegment(px, py, pz, bones[b].a, bones[b].b);
      if (dist[b]! < nearest) { nearest = dist[b]!; owner = b; }
    }
    // only the owning bone's own family, and only while genuinely nearby
    const family = kin[owner]!;
    const cutoff = nearest * SPREAD + 1e-4;
    for (const b of family) {
      if (dist[b]! > cutoff) continue;
      scored.push({ b, w: 1 / Math.pow(dist[b]! + 1e-4, falloff) });
    }
    scored.sort((p2, q) => q.w - p2.w);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += scored[k]?.w ?? 0;
    for (let k = 0; k < 4; k++) {
      const q = scored[k];
      skinIndex[i * 4 + k] = q ? q.b : owner;
      skinWeight[i * 4 + k] = q ? q.w / sum : 0;
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
