import { Quaternion, Vector3 } from 'three';
import type { ModalAxis, ModalGesture } from './modal-transform';

export interface TransformPose {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}
export interface TransformView {
  /** Camera world orientation, captured when the gesture begins. */
  quaternion: Quaternion;
  /** World distance subtended by one CSS pixel at the selected pivot. */
  unitsPerPixel: number;
  /** Increment snapping, in scene world units. Default 1. */
  moveSnap?: number;
}
const AXES: ModalAxis[] = ['x', 'y', 'z'];
const unit = (axis: ModalAxis) => new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
const snapped = (value: number, step: number, enabled: boolean) => enabled ? Math.round(value / step) * step : value;

/**
 * Object-mode transforms about the object's own pivot. Always evaluates from
 * the original pose; callers write the result into their animation-owned store.
 * Uses global/local axes and a camera-facing plane for unconstrained movement.
 * No surface snapping, multi-selection pivot, mesh editing or unit parser.
 */
export function transformGesture(start: TransformPose, g: ModalGesture, view: TransformView): TransformPose {
  const pose = { position: start.position.clone(), quaternion: start.quaternion.clone(), scale: start.scale.clone() };
  const basis = g.orientation === 'local' ? start.quaternion : new Quaternion();
  const selected = (axis: ModalAxis) => g.axis === null || (g.plane ? axis !== g.axis : axis === g.axis);
  const numeric = g.exact !== null;
  const snap = !!g.snap && !numeric;

  if (g.mode === 'move') {
    const delta = new Vector3(g.dx * view.unitsPerPixel, -g.dy * view.unitsPerPixel, 0)
      .applyQuaternion(view.quaternion).applyQuaternion(basis.clone().invert());
    if (numeric) {
      delta.set(0, 0, 0);
      for (const axis of AXES) if (selected(axis) && (g.axis !== null || axis === 'x')) delta[axis] = g.exact!;
    }
    for (const axis of AXES) {
      if (!selected(axis)) delta[axis] = 0;
      else delta[axis] = snapped(delta[axis], (view.moveSnap ?? 1) * (g.fine ? 0.1 : 1), snap);
    }
    pose.position.add(delta.applyQuaternion(basis));
  } else if (g.mode === 'scale') {
    const factor = numeric ? g.exact! : snapped(g.scale ?? (1 - g.dy * 0.005), g.fine ? 0.01 : 0.1, snap);
    const scale = new Vector3(...AXES.map(a => selected(a) ? factor : 1) as [number, number, number]);
    if (!g.axis || g.orientation === 'local') pose.scale.multiply(scale);
    else {
      // Blender Object Mode's ElementResize / TransMat3ToSize preserves
      // rotation. Scale each oriented basis vector, keeping its signed length.
      // Decomposing the whole matrix instead adds a spurious rotation.
      for (const axis of AXES) {
        const original = unit(axis).applyQuaternion(start.quaternion);
        const scaled = original.clone().multiply(scale);
        pose.scale[axis] *= scaled.length() * (scaled.dot(original) < 0 ? -1 : 1);
      }
    }
  } else {
    const step = (g.fine ? 1 : 5) * Math.PI / 180;
    if (g.trackball) {
      const x = new Vector3(1, 0, 0).applyQuaternion(view.quaternion);
      const y = new Vector3(0, 1, 0).applyQuaternion(view.quaternion);
      const horizontal = numeric ? g.exact! * Math.PI / 180 : snapped(g.dx * 0.006, step, snap);
      const vertical = numeric ? 0 : snapped(g.dy * 0.006, step, snap);
      pose.quaternion.premultiply(new Quaternion().setFromAxisAngle(x, vertical))
        .premultiply(new Quaternion().setFromAxisAngle(y, horizontal));
    } else {
      const axis = g.axis ? unit(g.axis).applyQuaternion(basis) : new Vector3(0, 0, 1).applyQuaternion(view.quaternion);
      let angle = numeric ? g.exact! * Math.PI / 180 : (g.angle ?? g.dx * 0.006);
      // Blender's unconstrained numeric R uses the negative view axis; an
      // explicit X/Y/Z numeric constraint uses the positive named axis.
      if (numeric && !g.axis) angle = -angle;
      // A positive screen angle follows the visible side of the chosen axis.
      if (!numeric && axis.dot(new Vector3(0, 0, 1).applyQuaternion(view.quaternion)) < 0) angle = -angle;
      pose.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, snapped(angle, step, snap)));
    }
  }
  return pose;
}
