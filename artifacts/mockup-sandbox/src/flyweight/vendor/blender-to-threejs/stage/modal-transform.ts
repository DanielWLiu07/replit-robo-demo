/**
 * Blender's modal transforms, as a headless input controller.
 *
 * G to move, S to scale, R to rotate; then X / Y / Z to constrain to an axis, digits to type an exact
 * amount, Enter or a click to confirm, Escape or right-click to cancel and put it back. Shift is the fine
 * modifier. It is the interaction every Blender user already has in their hands, and it is strictly more
 * capable than dragging a handle: an axis constraint and a typed number are things a drag cannot express.
 *
 * IT MOVES NOTHING ITSELF. It reports the gesture and the caller decides what that means, which is the only
 * shape that works here: a scene whose layout is re-applied from a store every frame cannot be edited by
 * writing to an Object3D, because the next frame overwrites it. SetEditor in this same folder is the other
 * half of the pair - a gizmo that owns the transform - and the two are for different situations rather
 * than being alternatives.
 *
 *   const stop = modalTransform(canvas, {
 *     enabled: () => selected !== null,
 *     onBegin: () => snapshot(),
 *     onUpdate: (g) => applyTo(selected, g),
 *     onCancel: () => restore(),
 *   })
 *
 * The caller owns undo. This reports a cancel, which is a different thing: a cancel is "I never did that",
 * an undo is "I did it and I want it back".
 */

export type ModalMode = 'move' | 'scale' | 'rotate';
export type ModalAxis = 'x' | 'y' | 'z';

export interface ModalGesture {
  mode: ModalMode;
  /** pointer travel since the gesture began, in CSS pixels. Screen axes: +x right, +y DOWN. */
  dx: number;
  dy: number;
  /** the axis the gesture is constrained to, or null for free */
  axis: ModalAxis | null;
  /**
   * A number typed during the gesture, or null.
   *
   * When this is set it REPLACES the pointer entirely, exactly as it does in Blender: `G X 0.5` means half
   * a unit along x, not half a unit plus wherever the mouse happened to drift.
   */
  exact: number | null;
  /** shift held. The caller decides what finer means for the thing it is moving. */
  fine: boolean;
  /** Extended Blender profile: first axis press is global, second local. */
  orientation?: 'global' | 'local';
  /** Shift+axis excludes that axis (a plane constraint). */
  plane?: boolean;
  snap?: boolean;
  trackball?: boolean;
  /** Signed mouse angle around the supplied pivot, radians. */
  angle?: number;
  /** Mouse distance from pivot relative to its starting distance. */
  scale?: number;
}

export interface ModalTransformOptions {
  /** whether a gesture may start at all: usually "is something selected" */
  enabled?: () => boolean;
  onBegin?: (mode: ModalMode) => void;
  onUpdate?: (g: ModalGesture) => void;
  /** confirmed. The gesture is already applied; this is the place to push an undo entry. */
  onCommit?: (g: ModalGesture) => void;
  /** cancelled: put it back exactly as it was before onBegin */
  onCancel?: () => void;
  /** which axes this caller understands. Pressing one not listed is ignored rather than half-working. */
  axes?: ModalAxis[];
  /** remap the three starting keys, for a page that already spends g, s or r on something else */
  keys?: { move?: string; scale?: string; rotate?: string };
  /** Opt in when the binding consumes orientation, plane, snap and trackball. */
  profile?: 'basic' | 'blender';
  /** Viewport CSS coordinates of the selected object's projected pivot. */
  pivot?: () => { x: number; y: number };
  /** Projected global axis directions, for middle-mouse auto-constraint. */
  axisScreen?: () => Record<ModalAxis, { x: number; y: number }>;
}

/** an element the user is typing into, where g and s are letters rather than commands */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

/**
 * Wire the modal keys to `dom`. Returns a teardown.
 *
 * Keys are taken on the window rather than on the element, because a modal transform in Blender does not
 * require the pointer to be over anything: once G is pressed the whole screen is the gesture. Pointer moves
 * are taken on the window too, so a fast drag that leaves the canvas does not silently stop tracking.
 */
export type ModalTransformHandle = (() => void) & { cancel(): void };

export function modalTransform(dom: HTMLElement, opts: ModalTransformOptions = {}): ModalTransformHandle {
  const keyMove = (opts.keys?.move ?? 'g').toLowerCase();
  const keyScale = (opts.keys?.scale ?? 's').toLowerCase();
  const keyRotate = (opts.keys?.rotate ?? 'r').toLowerCase();
  const axes = opts.axes ?? (['x', 'y', 'z'] as ModalAxis[]);
  const extended = opts.profile === 'blender';

  let mode: ModalMode | null = null;
  let originX = 0;
  let originY = 0;
  let lastX = 0;
  let lastY = 0;
  let axis: ModalAxis | null = null;
  let typed = '';
  let fine = false;
  let orientation: 'global' | 'local' = 'global';
  let plane = false;
  let snap = false;
  let snapToggle = false;
  let trackball = false;
  let autoConstraint = false;
  let suppressContext = false;
  let deltaX = 0, deltaY = 0, angle = 0;
  let pivot: { x: number; y: number } | undefined;
  const resetConstraint = () => { axis = null; orientation = 'global'; plane = false; };

  const gesture = (): ModalGesture => {
    const n = typed === '' || typed === '-' || typed === '.' ? null : Number(typed);
    return {
      mode: mode as ModalMode,
      dx: extended ? deltaX : lastX - originX,
      dy: extended ? deltaY : lastY - originY,
      axis,
      exact: n === null || !Number.isFinite(n) ? null : n,
      fine,
      ...(extended ? {
        orientation, plane, snap, trackball, angle,
        scale: pivot && Math.hypot(originX - pivot.x, originY - pivot.y) > 10
          ? Math.hypot(originX + deltaX - pivot.x, originY + deltaY - pivot.y) / Math.hypot(originX - pivot.x, originY - pivot.y)
          : 1 - deltaY * 0.005,
      } : {}),
    };
  };
  const emit = () => {
    if (mode) opts.onUpdate?.(gesture());
  };
  const end = (commit: boolean) => {
    if (!mode) return;
    const g = gesture();
    mode = null;
    axis = null;
    typed = '';
    autoConstraint = false;
    if (commit) opts.onCommit?.(g);
    else opts.onCancel?.();
  };

  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const k = e.key.toLowerCase();

    if (!mode) {
      // a modifier chord is somebody else's shortcut, not a transform
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const start = k === keyMove ? 'move' : k === keyScale ? 'scale' : k === keyRotate ? 'rotate' : null;
      if (!start) return;
      if (opts.enabled && !opts.enabled()) return;
      e.preventDefault();
      mode = start;
      originX = lastX;
      originY = lastY;
      axis = null;
      typed = '';
      fine = e.shiftKey;
      resetConstraint();
      snap = false; snapToggle = false; trackball = false; suppressContext = false;
      deltaX = 0; deltaY = 0; angle = 0;
      pivot = opts.pivot?.();
      opts.onBegin?.(mode);
      emit();
      return;
    }

    e.preventDefault();
    if (k === 'escape') {
      end(false);
      return;
    }
    if (k === 'enter' || k === 'return' || (extended && k === ' ')) {
      end(true);
      return;
    }
    if ((k === 'x' || k === 'y' || k === 'z') && axes.includes(k as ModalAxis)) {
      if (e.repeat) return;
      if (extended) {
        if (trackball) return; // Blender trackball is unconstrained.
        if (axis === k && plane === !!e.shiftKey) {
          if (orientation === 'global') orientation = 'local';
          else resetConstraint();
        } else { axis = k; plane = !!e.shiftKey; orientation = 'global'; }
      } else axis = axis === k ? null : (k as ModalAxis);
      emit();
      return;
    }
    if (extended && k === 'c') { resetConstraint(); emit(); return; }
    if (extended && k === 'tab' && e.shiftKey) {
      snapToggle = !snapToggle; snap = snapToggle !== !!e.ctrlKey; emit(); return;
    }
    if (extended && !e.repeat && (k === keyMove || k === keyScale || k === keyRotate)) {
      const next = k === keyMove ? 'move' : k === keyScale ? 'scale' : 'rotate';
      if (next === mode && next !== 'rotate') return;
      // Blender restores the original transform when changing modal operation.
      opts.onCancel?.();
      trackball = next === 'rotate' && mode === 'rotate' ? !trackball : false;
      mode = next; typed = ''; resetConstraint();
      opts.onBegin?.(mode); emit(); return;
    }
    if (k === 'backspace') {
      typed = typed.slice(0, -1);
      emit();
      return;
    }
    if (/^[0-9]$/.test(k) || k === '.' || k === '-') {
      // a leading minus flips the sign rather than being appended twice
      if (k === '-') typed = typed.startsWith('-') ? typed.slice(1) : '-' + typed;
      else if (k !== '.' || !typed.includes('.')) typed += k;
      emit();
    }
  };

  const onKeyUpDown = (e: KeyboardEvent) => {
    if (!mode) return;
    const now = e.shiftKey;
    const nextSnap = snapToggle !== !!e.ctrlKey;
    if (now !== fine || (extended && nextSnap !== snap)) {
      fine = now;
      if (extended) snap = nextSnap;
      emit();
    }
  };

  const onMove = (e: PointerEvent) => {
    const previousX = lastX, previousY = lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!mode) return;
    fine = e.shiftKey;
    if (extended) {
      const oldX = originX + deltaX, oldY = originY + deltaY;
      const factor = fine ? 0.1 : 1;
      deltaX += (lastX - previousX) * factor;
      deltaY += (lastY - previousY) * factor;
      if (pivot && Math.hypot(oldX - pivot.x, oldY - pivot.y) > 10) {
        const ax = oldX - pivot.x, ay = oldY - pivot.y;
        const bx = originX + deltaX - pivot.x, by = originY + deltaY - pivot.y;
        angle -= Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      } else angle = deltaX * 0.006;
      snap = snapToggle !== !!e.ctrlKey;
      if (autoConstraint && opts.axisScreen) {
        const directions = opts.axisScreen();
        let score = -1;
        for (const a of axes) {
          const d = directions[a], length = Math.hypot(d.x, d.y);
          if (length < 1e-6) continue;
          const next = Math.abs(deltaX * d.x + deltaY * d.y) / length;
          if (next > score) { score = next; axis = a; }
        }
      }
    }
    emit();
  };
  const onDown = (e: PointerEvent) => {
    if (!mode) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 0) end(true);
    else if (e.button === 2) { suppressContext = true; end(false); }
    else if (extended && e.button === 1 && !trackball) {
      autoConstraint = true; plane = !!e.shiftKey; orientation = 'global';
    }
  };
  const onUp = (e: PointerEvent) => { if (e.button === 1) autoConstraint = false; };
  const onContext = (e: Event) => {
    if (mode || suppressContext) e.preventDefault();
    suppressContext = false;
  };
  const onBlur = () => end(false);

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUpDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKeyUpDown);
  // capture, so a confirming click never reaches whatever is under the pointer
  dom.addEventListener('pointerdown', onDown, true);
  dom.addEventListener('contextmenu', onContext);
  window.addEventListener('blur', onBlur);

  const dispose = () => {
    end(false);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUpDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKeyUpDown);
    dom.removeEventListener('pointerdown', onDown, true);
    dom.removeEventListener('contextmenu', onContext);
    window.removeEventListener('blur', onBlur);
  };
  return Object.assign(dispose, { cancel: () => end(false) });
}
