/**
 * Binds a generated chassis mesh to the simulation's own skeleton.
 *
 * autoRig fits a 17-bone rest skeleton to the welded mesh and weights every vertex
 * against it. This file is the other half: it takes poseBot() from @workspace/sim —
 * the same pure function the sim could pose a bot with on any tick — and drives the
 * bound mesh from it, so the fighters animate off simulation state rather than off
 * anything hand-keyed here.
 *
 * Only directions are taken from poseBot, never absolute positions. The rig's own
 * proportions are hardcoded ratios while the mesh's are whatever the generator
 * produced, so reading positions across would stretch limbs to fit a skeleton the
 * geometry does not have. Taking the angle and walking the fitted bone lengths keeps
 * the mesh intact, and a final shift plants the lower foot on the floor — which is
 * what the IK in poseBot was for, recovered without needing the two to agree on how
 * long a shin is.
 */

import * as THREE from 'three';
import { poseBot, rigHeight } from '@workspace/sim';
import type { ArenaBotState, Chassis } from '@workspace/contract';
import { normalise, fitSkeleton, computeSkinWeights, facesPositiveZ, type RestBone, type V3 } from './autoRig';

/** poseBot builds its pose with forward on −x; the arena puts forward on −z. */
const toArena = (v: readonly number[]): V3 => [-v[2], v[1], v[0]];

/** Fighters read a little larger than the rig's nominal height at this camera. */
const DISPLAY = 1.25;

/** The expensive half of binding — fit and weights — done once per chassis. */
export interface ChassisBind {
  geometry: THREE.BufferGeometry;
  rest: RestBone[];
}

export interface SkinnedBot {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  rest: RestBone[];
  index: Map<string, number>;
  restDir: THREE.Vector3[];
  /** scratch, reused every frame so posing allocates nothing per bot */
  quats: THREE.Quaternion[];
  ax: Float64Array; ay: Float64Array; az: Float64Array;
}

/**
 * Fit and weight one chassis. A squad may field five identical units a side, so this
 * runs once per chassis and every unit shares the result — only the skeleton and the
 * material are per-unit. The geometry is re-centred to unit height with its feet on
 * y=0 first, so the fitted skeleton and the display scale are both in known units
 * whatever the generator emitted.
 */
export function bindChassis(source: THREE.Mesh): ChassisBind {
  source.updateMatrixWorld(true);
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);

  // Turn the model to face the way the arena drives it. applyMatrix4 carries the
  // normals round with the positions, which a hand-rolled coordinate flip would not.
  if (facesPositiveZ(geometry.getAttribute('position').array as ArrayLike<number>)) {
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
  }

  const { positions } = normalise(geometry.getAttribute('position').array as ArrayLike<number>);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const rest = fitSkeleton(positions);
  const { skinIndex, skinWeight } = computeSkinWeights(positions, rest);
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geometry.computeBoundingSphere();
  return { geometry, rest };
}

/** One poseable unit off a bound chassis. */
export function buildSkinnedBot(bind: ChassisBind, material: THREE.Material, chassis: Chassis): SkinnedBot {
  const { geometry, rest } = bind;
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const bones = rest.map(() => new THREE.Bone());
  for (const bone of bones) mesh.add(bone);
  // Identity bind: every bone sits at the origin at rest, so the matrix written each
  // frame is the whole rest-to-pose transform and no inverse bind pose is needed.
  mesh.bind(new THREE.Skeleton(bones, rest.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  mesh.scale.setScalar(rigHeight(chassis) * DISPLAY);
  // the skeleton moves vertices well outside the bind-pose bounds
  mesh.frustumCulled = false;

  const index = new Map(rest.map((b, i) => [b.name, i]));
  const restDir = rest.map(b =>
    new THREE.Vector3(b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]).normalize());
  return {
    mesh, bones, rest, index, restDir,
    quats: rest.map(() => new THREE.Quaternion()),
    ax: new Float64Array(rest.length), ay: new Float64Array(rest.length), az: new Float64Array(rest.length),
  };
}

const _dir = new THREE.Vector3(), _off = new THREE.Vector3();

/** Pose a bound mesh from one tick of simulation state. */
export function poseSkinnedBot(rig: SkinnedBot, state: ArenaBotState, chassis: Chassis) {
  const pose = poseBot(state, chassis);
  const { rest, index, quats, ax, ay, az } = rig;

  // rotation per bone: rest direction onto the direction poseBot put it in
  for (let i = 0; i < rest.length; i++) quats[i].identity();
  for (const bone of pose.bones) {
    const i = index.get(bone.name);
    if (i === undefined) continue;
    const a = toArena(bone.a), b = toArena(bone.b);
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (_dir.lengthSq() > 1e-10) quats[i].setFromUnitVectors(rig.restDir[i], _dir.normalize());
  }

  // joint positions: a child starts wherever its parent's rotation carries it, so
  // limbs stay connected and keep the fitted mesh's own bone lengths
  for (let i = 0; i < rest.length; i++) {
    const bone = rest[i];
    if (bone.parent === null) { ax[i] = bone.a[0]; ay[i] = bone.a[1]; az[i] = bone.a[2]; continue; }
    const p = index.get(bone.parent)!;
    _off.set(bone.a[0] - rest[p].a[0], bone.a[1] - rest[p].a[1], bone.a[2] - rest[p].a[2])
        .applyQuaternion(quats[p]);
    ax[i] = ax[p] + _off.x; ay[i] = ay[p] + _off.y; az[i] = az[p] + _off.z;
  }

  // Plant the body on the floor: the gait lifts one foot and leaves the other down,
  // so holding the lowest point at the surface gives the stride its bob for free.
  //
  // This used to measure the FEET only, which is right up to the moment somebody
  // gets knocked over. On the floor the feet are the HIGHEST part of a bot, so the
  // lift went negative and drove the whole body down through the surface — the one
  // pose where the plant mattered most was the one it inverted. Measuring every
  // bone costs a few dozen comparisons and is correct in both.
  let lowest = Infinity;
  for (let i = 0; i < rest.length; i++) {
    _off.set(rest[i].b[0] - rest[i].a[0], rest[i].b[1] - rest[i].a[1], rest[i].b[2] - rest[i].a[2])
        .applyQuaternion(quats[i]);
    lowest = Math.min(lowest, ay[i], ay[i] + _off.y);
  }
  const lift = Number.isFinite(lowest) ? 0.012 - lowest : 0;

  for (let i = 0; i < rest.length; i++) {
    const bone = rig.bones[i];
    bone.quaternion.copy(quats[i]);
    _off.set(rest[i].a[0], rest[i].a[1], rest[i].a[2]).applyQuaternion(quats[i]);
    bone.position.set(ax[i] - _off.x, ay[i] - _off.y + lift, az[i] - _off.z);
  }
}

/** Put a bound mesh back in its bind pose, for the idle stance between matches. */
export function restSkinnedBot(rig: SkinnedBot) {
  for (const bone of rig.bones) { bone.quaternion.identity(); bone.position.set(0, 0, 0); }
}
