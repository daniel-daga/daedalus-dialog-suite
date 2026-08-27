import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/**
 * The rotate gizmo, at a quarter of `TransformControls`' pointer sensitivity.
 *
 * Its own rate is `20 / <distance from the camera to the pivot>` radians per
 * unit of travel across the drag plane — fine for a model on a turntable, and
 * far too fast for a barrel in a 600 m world, where the camera is usually
 * metres from what it is turning and a short flick spins the VOB through
 * several turns.
 *
 * There is nowhere in the library to say so: the rate is a local `const` in
 * `pointerMove`, and the `rotationAngle` it produces is defined with
 * `configurable: false`, so it cannot be wrapped on the instance either. The
 * pointer can be, and the angle is linear in the travel since the press for
 * every axis the ring offers — so damping the pointer damps the turn, and it
 * does it *before* the gizmo, which means the ring, the live preview and the
 * committed op are all still the same number.
 *
 * Translation is deliberately untouched: it is in world units and already
 * one-to-one with the cursor.
 *
 * `WorldViewport`'s own snapping is applied to the proxy afterwards
 * (`snapping.ts`), so a snapped drag reaches the step it names either way —
 * only more slowly.
 */
export const ROTATE_DRAG_DAMPING = 0.25;

/** What `TransformControls` actually hands its pointer methods: normalized
 *  device coordinates and the button. `@types/three` says `PointerEvent`, which
 *  is what `_getPointer` was built from, not what it returns. */
interface GizmoPointer { x: number; y: number; button: number }

/** `pointer`, moved back toward `start` so that it has travelled `factor` of
 *  the way. */
export function dampPointer(
  start: { x: number; y: number }, pointer: GizmoPointer, factor: number,
): GizmoPointer {
  return {
    ...pointer,
    x: start.x + (pointer.x - start.x) * factor,
    y: start.y + (pointer.y - start.y) * factor,
  };
}

export class DampedTransformControls extends TransformControls {
  /** Where the drag began, which is what the base measures its whole pose
   *  from — damping against the previous move instead would make the turn
   *  depend on how many pointer events the OS delivered. */
  private pressedAt: { x: number; y: number } | null = null;

  pointerDown(pointer: PointerEvent | null): void {
    const at = pointer as unknown as GizmoPointer | null;
    if (at !== null) this.pressedAt = { x: at.x, y: at.y };
    super.pointerDown(pointer);
  }

  pointerMove(pointer: PointerEvent | null): void {
    const at = pointer as unknown as GizmoPointer | null;
    if (at !== null && this.pressedAt !== null && this.getMode() === 'rotate') {
      super.pointerMove(
        dampPointer(this.pressedAt, at, ROTATE_DRAG_DAMPING) as unknown as PointerEvent,
      );
      return;
    }
    super.pointerMove(pointer);
  }
}
