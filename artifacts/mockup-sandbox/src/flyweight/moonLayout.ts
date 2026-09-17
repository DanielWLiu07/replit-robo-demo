import * as THREE from "three";

/**
 * Baked scene authoring. This is the paste target for the editor's "copy
 * layout": edit in `?edit`, copy, paste the two literals over the ones below,
 * and the arrangement ships. Nothing here is read at runtime except at build.
 */
export type Vec3Tuple = [number, number, number];
export type PropKind =
  | "star" | "boulder" | "block" | "monolith"
  | "planet" | "saturn" | "crescent" | "arch";

export interface Placement {
  p: Vec3Tuple;
  r: Vec3Tuple;
  s: Vec3Tuple;
}

/** id -> transform, applied over whatever the scene authored in code. */
export type SceneLayout = Record<string, Placement>;

/** props created in the editor, rebuilt on load so viewers see them too */
export interface PropRecord extends Placement {
  kind: PropKind;
  id: string;
}

// ── paste below ──────────────────────────────────────────────────────────
export const SCENE_LAYOUT: SceneLayout = {
  "moon": { p: [0, -70, 0], r: [0, 0, 0], s: [1, 1, 1] },
  "title": { p: [-3.856, 2.637, -0.997], r: [-0.408, 0.226, 0.097], s: [1.6, 1.6, 1.6] },
  "enter": { p: [-7.448, 0.868, 0.165], r: [-0.408, 0.226, 0.097], s: [0.52, 0.52, 0.52] },
  "fly": { p: [2.976, -1.732, 5.282], r: [-0.186, -0.764, -0.015], s: [1.573, 1.573, 1.573] },
  "star-0": { p: [-7.877, 3.037, -6.027], r: [-0.785, 1.102, -2.039], s: [1, 1, 1] },
  "star-1": { p: [-5.808, 2.857, -9.265], r: [0.218, 0.762, 2.246], s: [1.261, 1.261, 1.261] },
  "star-2": { p: [-12.243, 3.081, -10.69], r: [-2.019, -0.603, 2.316], s: [0.883, 0.883, 0.883] },
  "star-3": { p: [-13.503, 1.298, -8.001], r: [-1.058, -1.142, -2.009], s: [1.658, 1.658, 1.658] },
  "star-4": { p: [7, 5, -14], r: [2.1, -2.8, -7], s: [1, 1, 1] },
  "star-5": { p: [-9, 5, -13], r: [-2.7, -2.6, -22], s: [1, 1, 1] },
  "star-6": { p: [2, 4, -12], r: [0.6, -2.4, -10], s: [1, 1, 1] },
  "star-7": { p: [15, 4, -12], r: [4.5, -2.4, 3], s: [1, 1, 1] },
  "star-8": { p: [-1.423, 2.529, -10.551], r: [0.126, -0.407, -2.74], s: [1.166, 1.166, 1.166] },
};

export const ADDED_PROPS: PropRecord[] = [
  { kind: "crescent", id: "crescent-add1", p: [-9, 7.5, -16], r: [0, 0, 0], s: [1.6, 1.6, 1.6] },
  { kind: "planet", id: "planet-add2", p: [9.5, 6.5, -20], r: [0, 0, 0], s: [1.5, 1.5, 1.5] },
  { kind: "arch", id: "arch-add4", p: [1.112, 2.867, -5.121], r: [0, 0, 0], s: [0.83, 0.83, 0.83] },
  { kind: "crescent", id: "crescent-add5", p: [6.618, 4.728, -2.341], r: [0.066, -0.12, 0.636], s: [0.771, 0.771, 0.771] },
  { kind: "star", id: "star-add6", p: [2.818, 5.405, -1.024], r: [0.24, -0.26, 0.3], s: [0.683, 0.683, 0.683] },
  { kind: "star", id: "star-add7", p: [4.29, 5.725, -1.261], r: [0, 0, 0], s: [0.279, 0.279, 0.279] },
];

export const CAMERA: { position: Vec3Tuple; target: Vec3Tuple } | null = { position: [0, 9, 10], target: [0, 1.6, 0] };

// ── paste above ──────────────────────────────────────────────────────────

export function applyPlacement(object: THREE.Object3D, place: Placement) {
  object.position.fromArray(place.p);
  object.rotation.set(place.r[0], place.r[1], place.r[2]);
  object.scale.fromArray(place.s);
}

/** Apply a saved layout to whatever ids are present; unknown ids are ignored. */
export function applyLayout(objects: Map<string, THREE.Object3D>, layout: SceneLayout) {
  for (const [id, place] of Object.entries(layout)) {
    const object = objects.get(id);
    if (object) applyPlacement(object, place);
  }
}
