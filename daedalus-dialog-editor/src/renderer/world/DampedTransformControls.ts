import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/**
 * The editor's gizmo: `TransformControls` with a rotate drag a quarter as fast
 * and translate plane handles that stay on the camera's side of the VOB.
 *
 * ── the rotate drag ─────────────────────────────────────────────────────────
 *
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
 *
 * ── the plane handles ───────────────────────────────────────────────────────
 *
 * Each translate plane square — XY, YZ, XZ — is drawn once, in the positive
 * quadrant of the two axes it names, and the library never moves it: the
 * offset is baked into the geometry by `setupGizmo`, so `handle.position` is
 * the gizmo's own origin and says nothing about where the square is. Orbit
 * round to the far octant and the square is behind the VOB, on top of the axis
 * lines, and dragging a VOB in a plane becomes a hunt for a few pixels. The
 * arrows do not have the problem — each is drawn at both +0.5 and -0.5 — so
 * the planes are the only handles a camera can end up on the wrong side of.
 *
 * `mirrorPlaneHandles` puts each square in the octant the camera is in. It
 * mirrors rather than moves because the offset is in the geometry: a negative
 * scale on the axes the camera is negative along is the whole of it, and it
 * needs no constant from the library's gizmo definition.
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

/** The two gizmo axes each translate plane handle lies in. Nothing else in the
 *  gizmo is mirrored: `X`/`Y`/`Z` are drawn at both ends already, and the
 *  rotate rings are placed from the eye by the library itself. */
const PLANE_HANDLE_AXES = {
  XY: ['x', 'y'],
  YZ: ['y', 'z'],
  XZ: ['x', 'z'],
} as const satisfies Record<string, readonly ['x' | 'y' | 'z', 'x' | 'y' | 'z']>;

/** The `TransformControlsGizmo` in the helper, plus the fields the controls
 *  define onto it (`defineProperty` in `TransformControls`' constructor passes
 *  every one of its own down to the gizmo and the plane). `@types/three`
 *  declares them on the plane only. */
type PlaneGizmo = THREE.Object3D & {
  mode: string;
  space: 'local' | 'world';
  eye: THREE.Vector3;
  worldQuaternion: THREE.Quaternion;
  gizmo: { translate: THREE.Object3D };
  picker: { translate: THREE.Object3D };
};

/** Scratch — this runs on every frame the gizmo is drawn. */
const eyeInGizmoSpace = new THREE.Vector3();
const gizmoTurn = new THREE.Quaternion();

/**
 * Mirror the translate plane squares into the octant the camera is in.
 *
 * Called after the gizmo has laid its handles out, so the scale it just set is
 * the one being negated — and the handles it left in the positive quadrant are
 * the ones seen here, every frame, which is what makes a plain `*= -1` safe.
 */
function mirrorPlaneHandles(gizmo: PlaneGizmo): void {
  if (gizmo.mode !== 'translate') return;

  // In world space the handles are axis-aligned, so the eye already is the
  // answer; in local space they carry the VOB's own turn and the eye has to be
  // brought into it.
  eyeInGizmoSpace.copy(gizmo.eye);
  if (gizmo.space === 'local') {
    eyeInGizmoSpace.applyQuaternion(gizmoTurn.copy(gizmo.worldQuaternion).invert());
  }

  for (const group of [gizmo.gizmo.translate, gizmo.picker.translate]) {
    for (const handle of group.children) {
      const axes = PLANE_HANDLE_AXES[handle.name as keyof typeof PLANE_HANDLE_AXES];
      if (axes === undefined) continue;

      let mirrored = false;
      for (const axis of axes) {
        if (eyeInGizmoSpace[axis] < 0) {
          handle.scale[axis] *= -1;
          mirrored = true;
        }
      }
      // The gizmo has already built its children's world matrices by now, so a
      // mirrored handle has to rebuild its own or the change lands a frame late.
      if (mirrored) handle.updateMatrixWorld(true);
    }
  }
}

export class DampedTransformControls extends TransformControls {
  /** Where the drag began, which is what the base measures its whole pose
   *  from — damping against the previous move instead would make the turn
   *  depend on how many pointer events the OS delivered. */
  private pressedAt: { x: number; y: number } | null = null;

  constructor(camera: THREE.Camera, domElement?: HTMLElement) {
    super(camera, domElement);

    // The gizmo lays its handles out in its own `updateMatrixWorld`, which the
    // render traversal calls — there is no event and no hook, so the mirroring
    // is chained onto it. Anywhere earlier would be undone by the layout it
    // runs every frame.
    const gizmo = this.getHelper().children
      .find((child) => (child as { isTransformControlsGizmo?: boolean })
        .isTransformControlsGizmo) as PlaneGizmo;
    const layOutHandles = gizmo.updateMatrixWorld.bind(gizmo);
    gizmo.updateMatrixWorld = (force?: boolean) => {
      layOutHandles(force);
      mirrorPlaneHandles(gizmo);
    };
  }

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
