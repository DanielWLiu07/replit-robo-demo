/**
 * Overlay objects (userData.compOverlay: gizmos, helpers, debug lines) skip a
 * post pipeline entirely: hidden while `draw` renders the styled frame, then
 * drawn plainly on top with the same camera. Add them at the scene root.
 *
 *   withOverlay(renderer, scene, camera, () => post.render())
 */
import type { Camera, Object3D, Scene } from 'three';
import { MeshBasicNodeMaterial, type Renderer } from 'three/webgpu';
import { skipsPosition } from './decal';

// depth-only material for the occlusion prepass: writes depth, no colour
let depthOnly: MeshBasicNodeMaterial | null = null;
function depthMaterial(): MeshBasicNodeMaterial {
  if (!depthOnly) {
    depthOnly = new MeshBasicNodeMaterial();
    depthOnly.colorWrite = false;
  }
  return depthOnly;
}

export function collectOverlays(scene: Scene): Object3D[] {
  const out: Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData?.compOverlay && o.visible) out.push(o);
  });
  return out;
}

/**
 * Draw only `overlays` (and their ancestor chain) on top of whatever is on the current target.
 *
 * The target has no usable depth (the styled frame arrived as a blit), so occlusion is rebuilt: the
 * non-overlay scene is rendered depth-only first, then the overlays are drawn with depth testing. An
 * overlay inside a model (a page inside a folder) therefore stays crisp AND stays behind what covers it.
 */
export function drawOverlays(renderer: Renderer, scene: Scene, camera: Camera, overlays: Object3D[]): void {
  if (!overlays.length) return;
  const keep = new Set<Object3D>();
  for (const o of overlays) for (let a: Object3D | null = o; a; a = a.parent) keep.add(a);
  const prevAuto = renderer.autoClear;
  const prevOverride = scene.overrideMaterial;
  renderer.autoClear = false;
  renderer.clearDepth();

  // 1) occluders, depth only (overlays themselves excluded, and decals with them: this pass renders
  // through one override material, so a transparent quad would write depth over its WHOLE rectangle and
  // cull the overlay behind it there, leaving a rectangle of styled frame around every letter or label)
  for (const o of overlays) o.visible = false;
  const notOccluding: Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible || !skipsPosition(o)) return;
    o.visible = false;
    notOccluding.push(o);
  });
  scene.overrideMaterial = depthMaterial();
  renderer.render(scene, camera);
  scene.overrideMaterial = prevOverride;
  for (const o of notOccluding) o.visible = true;

  // 2) the overlays, depth-tested against that. EVERY other renderable is hidden, not just the scene's
  // top-level children: hiding only those left meshes deeper inside a kept ancestor drawing a second time,
  // crisp, over the styled frame (it read as the same object having two different textures).
  for (const o of overlays) o.visible = true;
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    const renderable = (o as { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean });
    if (!renderable.isMesh && !renderable.isPoints && !renderable.isLine && !renderable.isSprite) return;
    if (keep.has(o) || !o.visible) return;
    o.visible = false;
    hidden.push(o);
  });
  renderer.render(scene, camera);
  for (const c of hidden) c.visible = true;
  renderer.autoClear = prevAuto;
}

export function withOverlay(renderer: Renderer, scene: Scene, camera: Camera, draw: () => void): void {
  const overlays = collectOverlays(scene);
  for (const o of overlays) o.visible = false;
  draw();
  drawOverlays(renderer, scene, camera, overlays);
}
