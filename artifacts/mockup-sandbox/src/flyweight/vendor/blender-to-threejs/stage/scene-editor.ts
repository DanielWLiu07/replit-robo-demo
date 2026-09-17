import type { Object3D } from 'three';
import { modalTransform, type ModalGesture, type ModalMode, type ModalTransformHandle, type ModalTransformOptions } from './modal-transform';

export interface SceneEditorEntry {
  readonly name?: string;
  /** Authoring transactions write the store that owns an animated transform. */
  readonly transform?: Omit<ModalTransformOptions, 'axes' | 'keys'>;
}

/** Serializable, structurally compatible with the panel tree schema. */
export interface SceneEditorNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly visible: boolean;
  readonly selected: boolean;
  readonly children: SceneEditorNode[];
}

interface Entry extends SceneEditorEntry { id: string; object: Object3D }

/**
 * One selection for the viewport, Outliner and G/S/R. Register authored roots,
 * not every generated mesh. Picking a descendant resolves its nearest root.
 * No renderer or React dependency; animated objects supply store transactions.
 */
export class SceneEditor {
  private entries = new Map<string, Entry>();
  private byObject = new Map<Object3D, Entry>();
  private selected: string | null = null;
  private active: Entry | null = null;
  private currentGesture: ModalGesture | null = null;
  private input: ModalTransformHandle | null = null;
  private listeners = new Set<() => void>();

  add(id: string, object: Object3D, options: SceneEditorEntry = {}): () => void {
    if (!id || this.entries.has(id) || this.byObject.has(object)) {
      throw new Error(`Duplicate or empty scene editor entry: ${id}`);
    }
    const entry = { id, object, ...options };
    this.entries.set(id, entry);
    this.byObject.set(object, entry);
    this.emit();
    return () => {
      // An old lifecycle cleanup must not remove a newer registration.
      if (this.entries.get(id) !== entry) return;
      if (this.selected === id) this.select(null);
      this.entries.delete(id);
      this.byObject.delete(object);
      this.emit();
    };
  }

  selectedId(): string | null { return this.selected; }
  gesture(): ModalGesture | null { return this.currentGesture ? { ...this.currentGesture } : null; }

  select(id: string | null): boolean {
    if (id !== null && !this.entries.has(id)) return false;
    if (id === this.selected) return true;
    this.input?.cancel();
    this.cancel();
    this.selected = id;
    this.emit();
    return true;
  }

  /** Pass the intersected mesh, not the R3F event's registered group. */
  pick(object: Object3D | null): boolean {
    for (let o = object; o; o = o.parent) {
      const entry = this.byObject.get(o);
      if (entry) return this.select(entry.id);
    }
    return this.select(null);
  }

  private visible(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  canTransform(): boolean {
    const entry = this.selected === null ? undefined : this.entries.get(this.selected);
    return !!entry?.transform && this.visible(entry.object) && (entry.transform.enabled?.() ?? true);
  }

  begin(mode: ModalMode): boolean {
    this.cancel();
    if (!this.canTransform()) return false;
    this.active = this.entries.get(this.selected!)!;
    this.active.transform?.onBegin?.(mode);
    return true;
  }

  update(gesture: ModalGesture): void {
    if (!this.active) return;
    if (!this.canTransform()) { this.input?.cancel(); this.cancel(); return; }
    this.currentGesture = { ...gesture };
    this.active.transform?.onUpdate?.(gesture);
    this.emit();
  }

  commit(gesture: ModalGesture): void {
    const entry = this.active;
    this.active = null;
    this.currentGesture = null;
    entry?.transform?.onCommit?.(gesture);
    if (entry) this.emit();
  }

  cancel(): void {
    const entry = this.active;
    this.active = null;
    this.currentGesture = null;
    entry?.transform?.onCancel?.();
    if (entry) this.emit();
  }

  /** Connect once per viewport. Selection changes cancel the old modal gesture. */
  connect(canvas: HTMLElement, options: Pick<ModalTransformOptions, 'axes' | 'keys' | 'profile' | 'pivot' | 'axisScreen'> = {}): () => void {
    this.input?.();
    const input = modalTransform(canvas, {
      ...options,
      enabled: () => this.canTransform(),
      onBegin: mode => { this.begin(mode); },
      onUpdate: gesture => this.update(gesture),
      onCommit: gesture => this.commit(gesture),
      onCancel: () => this.cancel(),
    });
    this.input = input;
    return () => { input(); if (this.input === input) this.input = null; };
  }

  /** On-demand authored hierarchy; follows reparenting without a per-frame walk. */
  tree(): SceneEditorNode[] {
    const nodes = new Map<string, SceneEditorNode>();
    for (const e of this.entries.values()) nodes.set(e.id, {
      id: e.id, name: e.name ?? (e.object.name || e.id), type: e.object.type,
      visible: this.visible(e.object), selected: this.selected === e.id, children: [],
    });
    const roots: SceneEditorNode[] = [];
    for (const e of this.entries.values()) {
      let parent: Entry | undefined;
      for (let o = e.object.parent; o; o = o.parent) {
        parent = this.byObject.get(o);
        if (parent) break;
      }
      const node = nodes.get(e.id)!;
      if (parent) nodes.get(parent.id)!.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Notify panels after external visibility or parenting changes. */
  refresh(): void { this.emit(); }
  private emit(): void { for (const listener of this.listeners) listener(); }

  dispose(): void {
    this.input?.();
    this.input = null;
    this.cancel();
    this.selected = null;
    this.entries.clear();
    this.byObject.clear();
    this.listeners.clear();
  }
}
