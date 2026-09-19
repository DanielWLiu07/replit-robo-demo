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
  "title": { p: [-2.6, 2.637, -0.997], r: [-0.408, 0.226, 0.097], s: [1.6, 1.6, 1.6] },
  "enter": { p: [-5.9, 0.868, 0.165], r: [-0.408, 0.226, 0.097], s: [0.52, 0.52, 0.52] },
  "fly": { p: [3.822, -0.204, 3.551], r: [2.956, 0.764, 3.127], s: [2.219, 2.219, 2.219] },
  "star-0": { p: [-7.877, 3.037, -6.027], r: [-0.785, 1.102, -2.039], s: [1, 1, 1] },
  "star-1": { p: [-5.808, 2.857, -9.265], r: [0.218, 0.762, 2.246], s: [1.261, 1.261, 1.261] },
  "star-2": { p: [-12.243, 3.081, -10.69], r: [-0.355, 0.517, -1.173], s: [0.883, 0.883, 0.883] },
  "star-3": { p: [-13.503, 1.298, -8.001], r: [-0.387, 0.666, 2.521], s: [1.658, 1.658, 1.658] },
  "star-4": { p: [7, 5, -14], r: [2.1, -2.8, -7], s: [1, 1, 1] },
  "star-5": { p: [-9, 5, -13], r: [0.018, 0.273, 2.415], s: [1, 1, 1] },
  "star-6": { p: [2, 4, -12], r: [-0.367, 0.143, 2.026], s: [1, 1, 1] },
  "star-7": { p: [15, 4, -12], r: [-0.035, -0.753, 0.031], s: [1, 1, 1] },
  "star-8": { p: [-1.423, 2.529, -10.551], r: [0.126, -0.407, -2.74], s: [1.166, 1.166, 1.166] },
};

export const ADDED_PROPS: PropRecord[] = [
  // Hand-placed, close to the wordmark.
  { kind: "crescent", id: "crescent-add1", p: [-9, 7.5, -16], r: [0, 0, 0], s: [1.6, 1.6, 1.6] },
  { kind: "planet", id: "planet-add2", p: [9.5, 6.5, -20], r: [0, 0, 0], s: [1.5, 1.5, 1.5] },
  { kind: "crescent", id: "crescent-add5", p: [6.618, 4.728, -2.341], r: [0.066, -0.12, 0.636], s: [0.771, 0.771, 0.771] },
  { kind: "star", id: "star-add6", p: [2.818, 5.405, -1.024], r: [0.24, -0.26, 0.3], s: [0.683, 0.683, 0.683] },
  { kind: "star", id: "star-add7", p: [4.29, 5.725, -1.261], r: [0, 0, 0], s: [0.279, 0.279, 0.279] },

  // ── sky field, generated ────────────────────────────────────────────────
  // Not scattered by hand and not scattered on a dome either: the ARRIVAL camera
  // pitches 36 deg down, so its top edge sits 14 deg BELOW the horizon and a dome
  // puts nearly everything above the frame (measured: 1 of 58 on screen). These
  // are seeded by picking a point on the FRAME, unprojecting it to a distance,
  // and keeping it only if the moon does not hide it, then sized by how big it
  // should LOOK rather than by a world scale, and spaced by screen distance so
  // nothing clumps. Checked against ARRIVAL and BAY, kept off the fighter and off
  // the wordmark's slab. Mostly stars on purpose: chunkier shapes this close read
  // as white slabs rather than debris. Stars and crescents are flat extruded
  // shapes, so their rotation AIMS the face at the camera (plus a spin and a
  // small tilt); a free rotation shows most of them edge-on as white slivers.
  { kind: "star", id: "sky-star-0", p: [7.356, 2.347, -24.652], r: [-0.19, -0.199, 1.324], s: [0.39, 0.39, 0.39] },
  { kind: "star", id: "sky-star-1", p: [18.946, 10.941, -13.48], r: [0.174, -0.428, 1.406], s: [0.606, 0.606, 0.606] },
  { kind: "star", id: "sky-star-2", p: [15.441, 5.063, -8.716], r: [-0.467, -0.647, -1.248], s: [0.219, 0.219, 0.219] },
  { kind: "star", id: "sky-star-3", p: [12.943, 14.477, -22.651], r: [-0.138, -0.481, -1.122], s: [0.27, 0.27, 0.27] },
  { kind: "star", id: "sky-star-4", p: [26.258, -2.639, -18.764], r: [-0.522, -0.437, -1.97], s: [0.295, 0.295, 0.295] },
  { kind: "star", id: "sky-star-5", p: [24.548, 10.377, -13.607], r: [0.401, -0.759, -0.551], s: [0.663, 0.663, 0.663] },
  { kind: "star", id: "sky-star-6", p: [2.956, -1.297, -43.695], r: [-0.296, 0.04, -2.183], s: [0.8, 0.8, 0.8] },
  { kind: "star", id: "sky-star-7", p: [-23.855, 6.208, -22.104], r: [-0.022, 0.508, -1.307], s: [0.252, 0.252, 0.252] },
  { kind: "star", id: "sky-star-8", p: [-4.483, -10.786, -43.296], r: [-0.323, 0.104, 1.415], s: [0.951, 0.951, 0.951] },
  { kind: "star", id: "sky-star-9", p: [-24.049, -4.997, -25.253], r: [-0.275, 0.515, -3.035], s: [0.704, 0.704, 0.704] },
  { kind: "star", id: "sky-star-10", p: [-22.844, 1.715, -22.381], r: [-0.145, 0.655, 1.866], s: [0.397, 0.397, 0.397] },
  { kind: "star", id: "sky-star-11", p: [21.64, -0.512, -8.614], r: [-0.491, -0.727, -2.712], s: [0.422, 0.422, 0.422] },
  { kind: "boulder", id: "sky-boulder-12", p: [-2.777, 17.369, -35.083], r: [-0.522, -2.807, -1.184], s: [0.225, 0.225, 0.225] },
  { kind: "star", id: "sky-star-13", p: [38.009, -1.601, -31.019], r: [-0.194, -0.706, -0.04], s: [0.78, 0.78, 0.78] },
  { kind: "star", id: "sky-star-14", p: [13.554, 16.209, -31.026], r: [0.208, -0.316, 2.116], s: [0.345, 0.345, 0.345] },
  { kind: "star", id: "sky-star-15", p: [5.159, -1.732, -26.641], r: [-0.277, -0.178, 1.936], s: [0.274, 0.274, 0.274] },
  { kind: "star", id: "sky-star-16", p: [-15.129, -1.099, -29.465], r: [-0.224, 0.294, -2.444], s: [0.465, 0.465, 0.465] },
  { kind: "star", id: "sky-star-17", p: [-14.29, 6.027, -2.228], r: [-0.008, 0.598, 2.627], s: [0.204, 0.204, 0.204] },
  { kind: "boulder", id: "sky-boulder-18", p: [17.169, 0.897, -9.266], r: [0.217, -0.885, 0.125], s: [0.188, 0.188, 0.188] },
  { kind: "star", id: "sky-star-19", p: [-28.328, 1.407, -5.763], r: [-0.384, 0.725, -2.204], s: [0.526, 0.526, 0.526] },
  { kind: "boulder", id: "sky-boulder-20", p: [-3.463, 0.395, -22.628], r: [-1.438, -0.331, 0.481], s: [0.202, 0.202, 0.202] },
  { kind: "boulder", id: "sky-boulder-21", p: [-17.668, 11.49, -7.917], r: [1.285, 0.814, -0.813], s: [0.185, 0.185, 0.185] },
  { kind: "crescent", id: "sky-crescent-22", p: [-8.736, 1.064, -29.191], r: [-0.186, 0.092, 1.538], s: [0.405, 0.405, 0.405] },
  { kind: "star", id: "sky-star-23", p: [-22.032, -3.401, -34.342], r: [-0.356, 0.554, -2.364], s: [0.666, 0.666, 0.666] },
  { kind: "star", id: "sky-star-24", p: [1.952, 17.965, -35.945], r: [0.07, 0.014, -2.894], s: [0.853, 0.853, 0.853] },
  { kind: "star", id: "sky-star-25", p: [-11.063, -1.022, -15.658], r: [-0.354, 0.481, -1.1], s: [0.326, 0.326, 0.326] },
  { kind: "star", id: "sky-star-26", p: [-17.238, 1.396, -4.683], r: [-0.338, 0.719, -0.038], s: [0.173, 0.173, 0.173] },
  { kind: "star", id: "sky-star-27", p: [-28.65, 2.445, -21.956], r: [-0.189, 0.707, -0.836], s: [0.662, 0.662, 0.662] },
  { kind: "star", id: "sky-star-28", p: [-34.612, 11.493, -15.57], r: [0.166, 0.795, 2.587], s: [0.489, 0.489, 0.489] },
  { kind: "star", id: "sky-star-29", p: [-28.902, -3.331, -39.963], r: [-0.173, 0.564, -2.165], s: [0.308, 0.308, 0.308] },
  { kind: "star", id: "sky-star-30", p: [-35.01, 12.089, -29.494], r: [0.451, 0.556, 2.722], s: [0.998, 0.998, 0.998] },
  { kind: "planet", id: "sky-planet-31", p: [-33.365, -1.06, -33.705], r: [1.95, 1.603, 3.038], s: [0.594, 0.594, 0.594] },
  { kind: "star", id: "sky-star-32", p: [16.512, 4.072, -7.029], r: [-0.42, -0.82, 0.892], s: [0.187, 0.187, 0.187] },
  { kind: "star", id: "sky-star-33", p: [-17.804, 8.443, -3.052], r: [0.1, 0.752, 0.327], s: [0.381, 0.381, 0.381] },
  { kind: "star", id: "sky-star-34", p: [25.829, -1.315, -41.871], r: [-0.295, -0.402, -0.928], s: [0.366, 0.366, 0.366] },
  { kind: "star", id: "sky-star-35", p: [-29.889, 6.959, -23.706], r: [-0.32, 0.693, -0.438], s: [0.437, 0.437, 0.437] },
  { kind: "star", id: "sky-star-36", p: [22.304, 0.173, -13.778], r: [-0.344, -0.721, -3.107], s: [0.506, 0.506, 0.506] },
  { kind: "star", id: "sky-star-37", p: [-17.303, 12.263, -12.985], r: [0.253, 0.621, 2.461], s: [0.175, 0.175, 0.175] },
  { kind: "star", id: "sky-star-38", p: [14.027, 6.022, -5.495], r: [-0.479, -0.754, 1.294], s: [0.179, 0.179, 0.179] },
  { kind: "star", id: "sky-star-39", p: [32.434, -3.2, -21.93], r: [-0.258, -0.885, -1.583], s: [0.291, 0.291, 0.291] },
  { kind: "boulder", id: "sky-boulder-40", p: [-24.1, 13.316, -23.179], r: [3.037, 1.494, 2.942], s: [0.189, 0.189, 0.189] },
  { kind: "star", id: "sky-star-41", p: [29.036, -5.152, -16.837], r: [-0.553, -0.81, 0.383], s: [0.364, 0.364, 0.364] },
  { kind: "star", id: "sky-star-42", p: [-24.084, 12.885, -31.461], r: [0.146, 0.581, -2.834], s: [0.381, 0.381, 0.381] },
  { kind: "star", id: "sky-star-43", p: [-21.298, -1.042, -40.229], r: [-0.194, 0.396, 2.073], s: [0.273, 0.273, 0.273] },
  { kind: "boulder", id: "sky-boulder-44", p: [18.555, 10.957, -27.634], r: [-2.172, -0.236, 1.125], s: [0.341, 0.341, 0.341] },
  { kind: "star", id: "sky-star-45", p: [-36.594, -5.892, -26.054], r: [-0.301, 0.732, -2.779], s: [0.9, 0.9, 0.9] },
  { kind: "star", id: "sky-star-46", p: [35.859, 1.04, -27.294], r: [-0.667, -0.869, 0.433], s: [0.802, 0.802, 0.802] },
  { kind: "star", id: "sky-star-47", p: [-23.416, 8.454, -29.335], r: [0.092, 0.479, 0.736], s: [0.347, 0.347, 0.347] },
  { kind: "star", id: "sky-star-48", p: [-0.288, -0.155, -29.648], r: [-0.183, -0.019, 0.74], s: [0.522, 0.522, 0.522] },
  { kind: "star", id: "sky-star-49", p: [14.957, 13.07, -16.327], r: [0.455, -0.44, -0.483], s: [0.476, 0.476, 0.476] },
  { kind: "boulder", id: "sky-boulder-50", p: [7.853, 3.022, -20.846], r: [-2.099, -1.632, 3.114], s: [0.156, 0.156, 0.156] },
  { kind: "star", id: "sky-star-51", p: [3.299, 8.564, -21.603], r: [0.157, -0.148, 0.41], s: [0.562, 0.562, 0.562] },
  { kind: "star", id: "sky-star-52", p: [21.093, -1.766, -46.131], r: [-0.188, -0.343, 2.862], s: [0.632, 0.632, 0.632] },
  { kind: "boulder", id: "sky-boulder-53", p: [-11.536, 9.36, -18.733], r: [2.384, -1.466, 0.907], s: [0.189, 0.189, 0.189] },
  { kind: "crescent", id: "sky-crescent-54", p: [-13.892, 0.904, -8.853], r: [-0.405, 0.614, -0.474], s: [0.21, 0.21, 0.21] },
  { kind: "boulder", id: "sky-boulder-55", p: [-40.098, -3.218, -29.156], r: [1.804, 1.347, 0.971], s: [0.336, 0.336, 0.336] },
  { kind: "star", id: "sky-star-56", p: [-8.087, 20.089, -38.272], r: [0.238, 0.203, -0.789], s: [0.509, 0.509, 0.509] },
  { kind: "star", id: "sky-star-57", p: [3.577, -3.569, -28.399], r: [-0.387, 0.101, -1.994], s: [0.526, 0.526, 0.526] },
  { kind: "star", id: "sky-star-58", p: [-28.377, 4.83, -35.433], r: [-0.026, 0.535, 2.385], s: [0.279, 0.279, 0.279] },
  { kind: "star", id: "sky-star-59", p: [-24.315, 1.543, -15.539], r: [-0.524, 0.703, -1.89], s: [0.369, 0.369, 0.369] },
  { kind: "crescent", id: "sky-crescent-60", p: [-1.812, 12.991, -9.639], r: [0.25, 0.02, 1.32], s: [0.3, 0.3, 0.3] },
  { kind: "star", id: "sky-star-61", p: [-16.638, 3.615, -16.933], r: [-0.49, 0.589, -2.23], s: [0.561, 0.561, 0.561] },
  { kind: "star", id: "sky-star-62", p: [-37.887, -11.691, -20.063], r: [-0.601, 0.804, 0.339], s: [0.601, 0.601, 0.601] },
  { kind: "star", id: "sky-star-63", p: [22.551, 0.526, -16.402], r: [-0.262, -0.698, -1.578], s: [0.396, 0.396, 0.396] },
  { kind: "star", id: "sky-star-64", p: [2.378, 3.004, -13.053], r: [-0.313, -0.085, 1.145], s: [0.179, 0.179, 0.179] },
  { kind: "star", id: "sky-star-65", p: [30.895, 5.303, -24.624], r: [-0.112, -0.567, -1.788], s: [0.358, 0.358, 0.358] },
  { kind: "star", id: "sky-star-66", p: [-9.239, -5.623, -39.356], r: [-0.418, 0.035, 2.107], s: [0.851, 0.851, 0.851] },
  { kind: "star", id: "sky-star-67", p: [-13.19, 6.452, -17.937], r: [0.028, 0.321, 2.05], s: [0.325, 0.325, 0.325] },
  { kind: "star", id: "sky-star-68", p: [11.677, 5.138, -10.171], r: [-0.217, -0.578, -2.509], s: [0.372, 0.372, 0.372] },
  { kind: "star", id: "sky-star-69", p: [-0.43, -5.024, -41.659], r: [-0.111, 0.169, 1.318], s: [0.705, 0.705, 0.705] },
  { kind: "star", id: "sky-star-70", p: [-33.177, 8.023, -25.28], r: [0.023, 0.662, -0.091], s: [0.8, 0.8, 0.8] },
  { kind: "star", id: "sky-star-71", p: [35.073, -0.064, -36.081], r: [0.062, -0.563, -1.041], s: [0.333, 0.333, 0.333] },
  { kind: "star", id: "sky-star-72", p: [28.687, 13.148, -23.948], r: [0.151, -0.689, -1.828], s: [0.43, 0.43, 0.43] },
  { kind: "star", id: "sky-star-73", p: [-29.907, -1.56, -18.407], r: [-0.315, 1.088, 1.388], s: [0.57, 0.57, 0.57] },
  { kind: "star", id: "sky-star-74", p: [21.17, 12.532, -8.426], r: [-0.036, -0.475, 2.023], s: [0.201, 0.201, 0.201] },
  { kind: "star", id: "sky-star-75", p: [-34.589, -7.844, -31.786], r: [-0.437, 0.684, 0.054], s: [0.976, 0.976, 0.976] },
  { kind: "star", id: "sky-star-76", p: [-12.58, 12.614, -7.163], r: [0.127, 0.454, 1.566], s: [0.459, 0.459, 0.459] },
  { kind: "star", id: "sky-star-77", p: [-14.679, -5.836, -42.596], r: [-0.248, 0.114, -1.45], s: [0.681, 0.681, 0.681] },
  { kind: "planet", id: "sky-planet-78", p: [2.636, -9.489, -38.541], r: [0.749, -2.854, 2.95], s: [0.549, 0.549, 0.549] },
  { kind: "star", id: "sky-star-79", p: [34.099, 1.492, -22.261], r: [-0.434, -0.664, -0.441], s: [0.516, 0.516, 0.516] },
  { kind: "star", id: "sky-star-80", p: [-2.293, 1.177, -24.173], r: [-0.189, 0.205, 0.579], s: [0.306, 0.306, 0.306] },
  { kind: "star", id: "sky-star-81", p: [36.067, 3.079, -23.681], r: [-0.317, -0.602, 0.613], s: [0.42, 0.42, 0.42] },
  { kind: "star", id: "sky-star-82", p: [-24.485, -6.821, -36.051], r: [-0.366, 0.507, 1.902], s: [0.575, 0.575, 0.575] },
  { kind: "star", id: "sky-star-83", p: [-33.262, 18.935, -32.131], r: [0.278, 0.515, -2.273], s: [0.64, 0.64, 0.64] },
  { kind: "boulder", id: "sky-boulder-84", p: [-16.327, -1.288, -39.534], r: [1.267, 0.532, -2.481], s: [0.191, 0.191, 0.191] },
  { kind: "star", id: "sky-star-85", p: [-18.139, -0.038, -9.158], r: [-0.343, 0.628, -0.416], s: [0.177, 0.177, 0.177] },
  { kind: "star", id: "sky-star-86", p: [-20.803, 5.158, -0.234], r: [-0.122, 0.889, 2.859], s: [0.219, 0.219, 0.219] },
  { kind: "star", id: "sky-star-87", p: [-27.147, -2.107, -24.329], r: [-0.346, 0.67, -2.531], s: [0.776, 0.776, 0.776] },
  { kind: "star", id: "sky-star-88", p: [9.67, 5.643, -2.023], r: [0.007, -0.666, -0.79], s: [0.334, 0.334, 0.334] },
  { kind: "star", id: "sky-star-89", p: [-28.865, -5.669, -13.834], r: [-0.834, 0.727, 1.289], s: [0.41, 0.41, 0.41] },
  { kind: "boulder", id: "sky-boulder-90", p: [11.41, 10.732, -6.162], r: [0.47, 1.713, -2.645], s: [0.185, 0.185, 0.185] },
  { kind: "star", id: "sky-star-91", p: [12.464, 2.548, -3.736], r: [-0.643, -0.78, -1.534], s: [0.277, 0.277, 0.277] },
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

/**
 * Camera stations on the one moon. The app does not swap pages; it flies the
 * camera between these, so every entry is a pose on the same surface.
 *
 * Declared OUTSIDE the paste markers above: a "copy layout" bake rewrites that
 * block wholesale and would otherwise delete them.
 *
 * RING sits out at d≈11.7 from the crown, where the sphere has already dropped
 * to about y=-1.0, the fighters stand on that, not on y=0.
 */
export type StationName = "ARRIVAL" | "BAY" | "RING";

export interface Station {
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export const RING_CENTRE: Vec3Tuple = [-19, -2.9, -6];

export const STATIONS: Record<StationName, Station> = {
  ARRIVAL: { position: [0, 9, 10], target: [0, 1.6, 0] },
  // The plinth is the fly, and the roster glass owns everything left of x=920,
  // so the figure is framed into the free half. Solved rather than nudged: fit
  // the projected silhouette to a target rect and iterate. It lands at 1262..1598
  // across and 178..796 down in a 1920x937 window, head and feet both clear.
  // The sign that keeps catching people: aim LEFT of the figure (target x below
  // the fly's x) to push it RIGHT. Aiming right of it is what buried it behind
  // the panels at 335..825 with its head 120px above the top edge.
  BAY: { position: [-1.481, 6.591, 17.075], target: [-2.212, 3.115, 0.654] },
  // Framed against the tangent plane, not guessed: 9.6 units out at 37 deg above
  // the surface, aimed at chest height. Frames 12.7 units across, and the arena is
  // 9.0 wide with fighters up to 7.1 apart - so BOTH stay on screen. The old
  // pose framed too tight and the second fighter spent the match outside the shot.
  RING: { position: [-19.38, 3.65, 1.01], target: [-19.20, -2.18, -6.06] },
};

/** Moon radius and centre, so anything standing on it can ask how high the ground is. */
export const MOON_RADIUS = 70;

/**
 * Surface height under a point.
 *
 * The moon is a 70-unit sphere sunk so its crown sits at y=0, which means the
 * ground drops away as you move out: at 5 units from the crown it is already
 * -0.18, at 20 units it is -2.9. Anything placed at a flat y therefore either
 * floats or has its feet buried, and the further out it stands the worse it is.
 */
export function groundY(x: number, z: number): number {
  const d2 = x * x + z * z;
  const r2 = MOON_RADIUS * MOON_RADIUS;
  return d2 >= r2 ? -MOON_RADIUS : -MOON_RADIUS + Math.sqrt(r2 - d2);
}
