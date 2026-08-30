import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { zenToThree, ZEN_TO_THREE_SCALE } from 'zen-world';

// Blender's viewport navigation, because that is what the people who build
// Gothic levels already have in their hands. Two rules do most of the work:
// the middle button drives the camera and the left button never does, which is
// what lets a click mean "select this VOB" or "place one here" without also
// meaning "tumble the world".
//
// Most of the mapping is OrbitControls' own. Its ROTATE branch already pans
// when a modifier is held, so Shift+middle needs no code here; what it does not
// have is Blender's Ctrl+middle zoom, which it reads as a pan too. So the shim
// below sets the button mapping once and swaps in DOLLY for that one case.
//
// A trackpad has no middle button, which left the whole of the above out of
// reach of one — only the wheel zoom worked. So Alt+left stands in for it, the
// same way Blender's own "Emulate 3 Button Mouse" does, and for the same
// reason. Alt is what is free: Shift, Ctrl and Cmd on the left button all mean
// "add to the selection" already (level-editor.md §7).

export type Nav = 'orbit' | 'pan' | 'dolly' | 'none';

/**
 * How far the camera swings per pixel of drag: a full screen width of view for
 * a drag of a screen width, which is OrbitControls' own default.
 *
 * Named and set here anyway, rather than left to the library, so there is one
 * place the decision lives — it was 0.4 for a while, and 1.0 is what it was set
 * back to (2026-08-27). This is the *camera*; the gizmo's rotate ring is a
 * separate rate and a much slower one (`DampedTransformControls`).
 */
export const ORBIT_ROTATE_SPEED = 1;

/** Three units are metres here (`ZEN_TO_THREE_SCALE`), so this is one metre. A
 *  pivot any closer scales the dolly step and the pan speed to nothing, which
 *  is navigation that has locked up rather than navigation that is precise. */
const MIN_PIVOT_DISTANCE = 1;

/** Which navigation a press asks for, or `none` if the camera must not move. */
export function navFor(event: {
  button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean;
}): Nav {
  if (event.button !== 1 && !emulatesMiddle(event)) return 'none';
  if (event.ctrlKey || event.metaKey) return 'dolly';
  if (event.shiftKey) return 'pan';
  return 'orbit';
}

/** The left button standing in for the middle one: Alt held, and nothing else
 *  about the press changed — the modifiers on top of it mean what they mean on
 *  a real middle button. */
function emulatesMiddle(event: { button: number; altKey: boolean }): boolean {
  return event.button === 0 && event.altKey;
}

/**
 * Apply the mapping to a live `OrbitControls`, and return the undo.
 *
 * The listener goes on `host` in the capture phase rather than on the canvas:
 * OrbitControls listens on the canvas itself, and two listeners on one target
 * fire in the order they were added — an ordering that would depend on where
 * this call sits relative to `new OrbitControls`. A capture listener on the
 * parent is ahead of both, whatever that order is.
 *
 * `onNavStart` is called for a press that navigates, ahead of OrbitControls
 * seeing it — the hook the caller moves the pivot from. It hangs off this
 * listener rather than one of its own for exactly the ordering reason above:
 * the pivot has to be in place before OrbitControls records where a drag began.
 */
export function attachBlenderNav(
  controls: OrbitControls,
  host: HTMLElement,
  onNavStart?: (event: PointerEvent) => void,
): () => void {
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
  controls.rotateSpeed = ORBIT_ROTATE_SPEED;

  const onPointerDown = (event: PointerEvent) => {
    const nav = navFor(event);
    if (nav === 'none') return;
    // Every one of the three is scaled by the camera-to-target distance, so
    // every one of them wants the pivot on what is being looked at.
    onNavStart?.(event);
    // Chromium answers a middle press with autoscroll, which captures the
    // pointer and leaves the drag half-delivered.
    event.preventDefault();
    // 'pan' is deliberately absent: it is the modifier case OrbitControls
    // already handles under ROTATE, and naming PAN here would break it, since
    // the PAN branch reads a held modifier as a request to rotate.
    const mode = nav === 'dolly' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;

    // The left button is `null` above so that a click can mean "select this
    // VOB". An emulated middle drag borrows it for the length of the drag and
    // `releaseLeft` gives it back — a borrow left standing would leave every
    // later click tumbling the world, which is the failure the whole mapping
    // exists to prevent. OrbitControls reads `mouseButtons` in its own
    // pointerdown and never again, so the drag already under way keeps going.
    if (emulatesMiddle(event)) controls.mouseButtons.LEFT = mode;
    else controls.mouseButtons.MIDDLE = mode;
  };

  const releaseLeft = () => { controls.mouseButtons.LEFT = null; };

  host.addEventListener('pointerdown', onPointerDown, { capture: true });
  // Capture, and on `host`, for the ordering reason above — and unconditional
  // because `null` is what the left button is when no drag is borrowing it.
  host.addEventListener('pointerup', releaseLeft, { capture: true });
  host.addEventListener('pointercancel', releaseLeft, { capture: true });
  return () => {
    host.removeEventListener('pointerdown', onPointerDown, { capture: true });
    host.removeEventListener('pointerup', releaseLeft, { capture: true });
    host.removeEventListener('pointercancel', releaseLeft, { capture: true });
  };
}

// Scratch, so starting a drag allocates nothing.
const viewDirection = new THREE.Vector3();
const toPick = new THREE.Vector3();

/**
 * Put the orbit pivot on what the user just picked, without moving the view a
 * single pixel — Blender's auto-depth, and the fix for four complaints at once.
 *
 * `controls.target` starts at the centre of a 600 m island and only `frameOn`
 * ever moves it, and OrbitControls scales the dolly step, the pan speed *and*
 * the orbit radius by the camera-to-target distance. So up against a wall the
 * zoom overshoots, the pan crawls, and an orbit swings the camera through half
 * the world instead of around what is being looked at.
 *
 * The pivot is the **projection of `pick` onto the view axis**, not `pick`
 * itself. A pivot off the axis cannot be reached without also turning the
 * camera — OrbitControls re-aims at the target on every `update()` — and a view
 * that jumps when a drag begins is worse than the pivot being a hand's width to
 * the side of the cursor. What matters to all three complaints is the
 * *distance*, and the projection keeps that exactly.
 *
 * `target` is mutated in place, because it is `OrbitControls.target`.
 */
export function pivotAt(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  pick: THREE.Vector3,
): void {
  camera.getWorldDirection(viewDirection);
  const depth = viewDirection.dot(toPick.copy(pick).sub(camera.position));
  // Behind the lens: reachable through the last-pick fallback, by turning away
  // from the selection before starting a drag. Projecting it would put the
  // pivot behind the camera and invert every orbit.
  if (depth <= 0) return;

  target.copy(camera.position)
    .addScaledVector(viewDirection, Math.max(depth, MIN_PIVOT_DISTANCE));
}

/**
 * Look at `center` from where the camera already is, far enough back that a
 * sphere of `radius` fits — Blender's "frame selected", and the thing that
 * makes orbiting usable at all. `target` is `OrbitControls.target`, mutated in
 * place, because moving the camera without moving the pivot leaves the next
 * orbit swinging around the middle of a 600 m island.
 */
export function frameOn(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): void {
  const direction = camera.position.clone().sub(target);
  // Dollied all the way in, there is no direction left to preserve.
  if (direction.lengthSq() < 1e-12) direction.set(0.6, 0.35, 0.6);
  direction.normalize();

  // A VOB with no visual has no radius, and a camera backed off by zero sits
  // inside its own pivot.
  const fits = Math.max(radius, 1) / Math.tan((camera.fov * Math.PI) / 360);

  target.copy(center);
  camera.position.copy(center).addScaledVector(direction, fits * 1.4);
}

/** A VOB as framing sees it: where it is drawn in **ZenGin centimetres**, and
 *  its visual's own box in the same units — null for a VOB with no visual,
 *  which is a point to frame rather than a thing with a size. */
export interface FramableVob {
  at: [number, number, number];
  bounds: readonly number[] | null;
}

/**
 * Frame the camera on some VOBs and **leave the orbit pivot on them** — what
 * the framing keys do, and what a jump from the scene tree does.
 *
 * Answers the centre it framed, in three space, so the caller can remember it
 * as the last pick: a drag begun over the sky pivots on that, and without it
 * the very next orbit after a jump would swing back to wherever the last click
 * happened to land. Null when there is nothing to frame — a selection can be
 * nothing but VOBs the viewport cannot draw, and then neither the camera nor
 * the pivot moves at all.
 *
 * The conversion out of ZenGin space happens here rather than in the caller
 * because the radius is in it too: a bbox is centimetres and the sphere the
 * camera backs off for is metres.
 */
export function frameVobs(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  vobs: readonly FramableVob[],
): THREE.Vector3 | null {
  if (vobs.length === 0) return null;

  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (const { at } of vobs) center.add(point.set(...zenToThree(at)));
  center.divideScalar(vobs.length);

  // Far enough for the furthest VOB *and* for its own extent: a 20 m house
  // framed as a point is framed from inside itself.
  let radius = 0;
  for (const { at, bounds } of vobs) {
    const own = bounds
      ? Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) / 2
      : 0;
    radius = Math.max(
      radius,
      center.distanceTo(point.set(...zenToThree(at)))
        + own * ZEN_TO_THREE_SCALE,
    );
  }

  frameOn(camera, target, center, radius);
  return center;
}
