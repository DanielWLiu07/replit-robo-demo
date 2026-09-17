import * as THREE from "three";
import { SceneEditor, type SceneEditorNode } from "./vendor/blender-to-threejs/stage/scene-editor";
import { transformGesture, type TransformPose } from "./vendor/blender-to-threejs/stage/transform-gesture";
import type { ModalAxis } from "./vendor/blender-to-threejs/stage/modal-transform";
import type { PropKind } from "./moonLayout";

/**
 * The moon scene's authoring owner.
 *
 * One `SceneEditor` per viewport, per the library's rule — it owns selection for
 * the Outliner, viewport picking and the Blender G/S/R keymap at once, so there
 * is never a second keyboard owner disagreeing with it.
 *
 * Nothing here is animated by a store, so the transform transactions write the
 * Object3D directly; `onBegin` still snapshots so Esc restores exactly.
 */
export type AddKind = PropKind;

const AXES: ModalAxis[] = ["x", "y", "z"];

export interface MoonEditorOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** the hatch material every authored prop shares */
  propMat: THREE.Material;
  outlineMat: THREE.Material;
}

function poseOf(o: THREE.Object3D): TransformPose {
  return { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() };
}

function applyPose(o: THREE.Object3D, p: TransformPose) {
  o.position.copy(p.position);
  o.quaternion.copy(p.quaternion);
  o.scale.copy(p.scale);
}

export class MoonEditor {
  readonly editor = new SceneEditor();
  /** true between onBegin and onCommit/onCancel, so a confirm click cannot re-pick */
  private gesturing = false;
  private opts: MoonEditorOptions;
  private disposers: Array<() => void> = [];
  private added: Array<{ id: string; object: THREE.Object3D; kind: AddKind }> = [];
  private removers = new Map<string, () => void>();
  private counter = 0;

  constructor(opts: MoonEditorOptions) {
    this.opts = opts;
    const { canvas } = opts;
    canvas.tabIndex = 0;
    canvas.style.outline = "none";

    // connect() binds the CONFIRM click (and contextmenu) on whatever element it
    // is given. The canvas is inside a pointer-events:none, z-index:-1 stage, so
    // it is never in the event path and a click could not end a gesture — the
    // object just kept following the mouse. document.body always is in the path.
    this.disposers.push(
      this.editor.connect(document.body, {
        profile: "blender",
        axes: AXES,
        pivot: () => this.pivotCss(),
        axisScreen: () => this.axisScreen(),
      }),
    );

    // on window, not the canvas: the canvas lives inside a pointer-events:none
    // stage, and a listener there never fires.
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (this.gesturing) return; // a click during G/S/R confirms it, never re-picks
      const target = e.target as HTMLElement | null;
      if (target?.closest(".moon-editor")) return; // the panel owns its own clicks
      const rect = canvas.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      canvas.focus();
      this.editor.pick(this.raycast(e));
    };
    window.addEventListener("pointerdown", onPointerDown);
    this.disposers.push(() => window.removeEventListener("pointerdown", onPointerDown));
  }

  /** Register an authored root. Picking a descendant resolves back to it. */
  register(id: string, object: THREE.Object3D, name: string) {
    let start: TransformPose = poseOf(object);
    let view = { quaternion: new THREE.Quaternion(), unitsPerPixel: 0.01 };
    if (this.removers.has(id)) this.removers.get(id)!(); // re-registering an id replaces it
    const remove = this.editor.add(id, object, {
      name,
      transform: {
        onBegin: () => {
          this.gesturing = true;
          start = poseOf(object);
          view = {
            quaternion: this.opts.camera.getWorldQuaternion(new THREE.Quaternion()),
            unitsPerPixel: this.unitsPerPixel(object),
          };
        },
        onUpdate: (g) => applyPose(object, transformGesture(start, g, view)),
        onCommit: () => { this.gesturing = false; },
        onCancel: () => { this.gesturing = false; applyPose(object, start); },
      },
    });
    this.removers.set(id, remove);
    this.disposers.push(remove);
    return remove;
  }

  /** World distance one CSS pixel subtends at the object's depth. */
  private unitsPerPixel(object: THREE.Object3D) {
    const { camera, canvas } = this.opts;
    const world = object.getWorldPosition(new THREE.Vector3());
    const distance = camera.position.distanceTo(world) || 1;
    const heightPx = canvas.getBoundingClientRect().height || 1;
    return (2 * Math.tan((camera.fov * Math.PI) / 360) * distance) / heightPx;
  }

  private toCss(world: THREE.Vector3) {
    const { camera, canvas } = this.opts;
    const rect = canvas.getBoundingClientRect();
    const p = world.clone().project(camera);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  private pivotCss() {
    const object = this.selectedObject();
    const world = object ? object.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    return this.toCss(world);
  }

  private axisScreen(): Record<ModalAxis, { x: number; y: number }> {
    const object = this.selectedObject();
    const origin = object ? object.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const base = this.toCss(origin);
    const out = {} as Record<ModalAxis, { x: number; y: number }>;
    for (const axis of AXES) {
      const dir = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
      const tip = this.toCss(origin.clone().add(dir));
      out[axis] = { x: tip.x - base.x, y: tip.y - base.y };
    }
    return out;
  }

  private selectedObject(): THREE.Object3D | null {
    const find = (nodes: SceneEditorNode[]): string | null => {
      for (const n of nodes) {
        if (n.selected) return n.id;
        const child = find(n.children);
        if (child) return child;
      }
      return null;
    };
    const id = find(this.editor.tree());
    if (!id) return null;
    return this.objects.get(id) ?? null;
  }

  /** id -> object, kept so the panel and pivot maths can resolve a selection. */
  readonly objects = new Map<string, THREE.Object3D>();

  track(id: string, object: THREE.Object3D) {
    this.objects.set(id, object);
  }

  private raycast(e: PointerEvent): THREE.Object3D | null {
    const { camera, canvas, scene } = this.opts;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(scene.children, true);
    return hits.length ? hits[0]!.object : null;
  }

  /** New set dressing, on the same hatch material so it belongs to the scene. */
  add(kind: AddKind): string {
    const { scene, propMat, outlineMat, camera } = this.opts;
    const group = makeProp(kind, propMat, outlineMat);

    // drop it in front of the camera so it is on screen the moment it exists
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    group.position.copy(camera.position).addScaledVector(forward, 11);
    if (kind !== "star") group.position.y = 0;

    scene.add(group);
    // NOT `${kind}-${n}`: the baked set dressing already owns star-0..star-8 and
    // the editor rejects a duplicate id, which is what broke adding a Star.
    const id = `${kind}-add${++this.counter}`;
    group.name = id;
    this.track(id, group);
    this.register(id, group, `${kind[0]!.toUpperCase()}${kind.slice(1)} ${this.counter}`);
    this.added.push({ id, object: group, kind });
    this.editor.select(id);
    return id;
  }

  /** Re-adopt a prop rebuilt from a saved layout so it is editable again. */
  adopt(id: string, object: THREE.Object3D, kind: AddKind, name: string) {
    this.track(id, object);
    this.register(id, object, name);
    this.added.push({ id, object, kind });
    const n = Number(id.replace(/^.*-add/, ""));
    if (Number.isFinite(n)) this.counter = Math.max(this.counter, n);
  }

  remove(id: string) {
    const object = this.objects.get(id);
    if (!object) return;
    this.removers.get(id)?.();          // take the row out of the Outliner too
    this.removers.delete(id);
    object.removeFromParent();
    // mesh and hull share one geometry, so dispose once per unique geometry
    const seen = new Set<THREE.BufferGeometry>();
    object.traverse((o) => {
      if (o instanceof THREE.Mesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    });
    this.objects.delete(id);
    this.added = this.added.filter((a) => a.id !== id);
    this.editor.select(null);
  }

  /**
   * Paste-ready source for `moonLayout.ts`.
   *
   * Everything registered gets a placement, added props carry their kind so
   * they can be rebuilt on load, and the camera goes out too — so a copy is the
   * whole arrangement, not just the things that happened to be dragged.
   */
  layout(): string {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const vec = (v: THREE.Vector3 | THREE.Euler) =>
      `[${r((v as THREE.Vector3).x)}, ${r((v as THREE.Vector3).y)}, ${r((v as THREE.Vector3).z)}]`;
    const place = (o: THREE.Object3D) =>
      `{ p: ${vec(o.position)}, r: ${vec(o.rotation as unknown as THREE.Vector3)}, s: ${vec(o.scale)} }`;

    const addedIds = new Set(this.added.map((a) => a.id));
    const rows: string[] = [];
    for (const [id, o] of this.objects) {
      if (addedIds.has(id)) continue; // added props carry their own placement
      rows.push(`  ${JSON.stringify(id)}: ${place(o)},`);
    }

    const props = this.added.map(({ id, object, kind }) =>
      `  { kind: ${JSON.stringify(kind)}, id: ${JSON.stringify(id)}, ` +
      `p: ${vec(object.position)}, r: ${vec(object.rotation as unknown as THREE.Vector3)}, s: ${vec(object.scale)} },`,
    );

    const cam = this.opts.camera;
    const target = this.cameraTarget;

    return [
      "export const SCENE_LAYOUT: SceneLayout = {",
      ...rows,
      "};",
      "",
      "export const ADDED_PROPS: PropRecord[] = [",
      ...props,
      "];",
      "",
      `export const CAMERA: { position: Vec3Tuple; target: Vec3Tuple } | null = ` +
        `{ position: ${vec(cam.position)}, target: ${target ? vec(target) : "[0, 1.6, 0]"} };`,
    ].join("\n");
  }

  /** Where the camera is aimed, so a copy can round-trip the framing. */
  cameraTarget: THREE.Vector3 | null = null;

  tree() { return this.editor.tree(); }
  select(id: string | null) { this.editor.select(id); }
  onChange(fn: () => void) { return this.editor.onChange(fn); }

  dispose() {
    for (const d of this.disposers.splice(0)) d();
    this.removers.clear();
    this.editor.dispose();
    this.objects.clear();
  }
}

interface PropPart {
  g: THREE.BufferGeometry;
  pos?: [number, number, number];
  rot?: [number, number, number];
}

/** A crescent: one disc with a second swung through it. */
function crescentGeometry(r = 1.2): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r, Math.PI * 0.5, Math.PI * 1.5, false);
  shape.absarc(r * 0.46, 0, r * 0.96, Math.PI * 1.5, Math.PI * 0.5, true);
  return new THREE.ExtrudeGeometry(shape, {
    depth: r * 0.26, bevelEnabled: true,
    bevelThickness: r * 0.05, bevelSize: r * 0.05, bevelSegments: 1,
  });
}

function partsFor(kind: PropKind): PropPart[] {
  switch (kind) {
    case "star": return [{ g: starGeometry(0.8) }];
    case "boulder": return [{ g: new THREE.IcosahedronGeometry(0.7, 0) }];
    case "monolith": return [{ g: new THREE.BoxGeometry(0.4, 3.2, 0.9) }];
    case "planet": return [{ g: new THREE.SphereGeometry(1.6, 36, 22) }];
    case "crescent": return [{ g: crescentGeometry(1.2) }];
    // a half torus reads as a rock arch once the hatch shader is on it
    case "arch": return [{ g: new THREE.TorusGeometry(1.5, 0.34, 10, 28, Math.PI) }];
    case "saturn": return [
      { g: new THREE.SphereGeometry(1.25, 36, 22) },
      { g: new THREE.RingGeometry(1.85, 2.95, 64), rot: [-Math.PI / 2 + 0.34, 0, 0.18] },
    ];
    default: return [{ g: new THREE.BoxGeometry(1, 1, 1) }];
  }
}

/**
 * One prop, built the same way whether it comes from a layout or the Add menu.
 * Each part carries its own ink hull, so a multi-part body (Saturn and its
 * ring) outlines correctly instead of getting one hull around the whole group.
 */
export function makeProp(kind: PropKind, propMat: THREE.Material, outlineMat: THREE.Material) {
  const group = new THREE.Group();
  for (const part of partsFor(kind)) {
    const holder = new THREE.Group();
    if (part.pos) holder.position.set(...part.pos);
    if (part.rot) holder.rotation.set(...part.rot);
    const hull = new THREE.Mesh(part.g, outlineMat);
    hull.scale.setScalar(1.04);
    holder.add(hull, new THREE.Mesh(part.g, propMat));
    group.add(holder);
  }
  return group;
}

/** the prototype's five-point star, shared with MoonStage */
export function starGeometry(r: number) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * 6.2832 - 1.5708;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, {
    depth: r * 0.4, bevelEnabled: true,
    bevelThickness: r * 0.07, bevelSize: r * 0.07, bevelSegments: 1,
  });
}
