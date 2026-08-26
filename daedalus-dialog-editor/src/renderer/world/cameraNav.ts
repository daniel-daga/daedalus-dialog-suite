import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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

export type Nav = 'orbit' | 'pan' | 'dolly' | 'none';

/** Which navigation a press asks for, or `none` if the camera must not move. */
export function navFor(event: {
  button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean;
}): Nav {
  if (event.button !== 1) return 'none';
  if (event.ctrlKey || event.metaKey) return 'dolly';
  if (event.shiftKey) return 'pan';
  return 'orbit';
}

/**
 * Apply the mapping to a live `OrbitControls`, and return the undo.
 *
 * The listener goes on `host` in the capture phase rather than on the canvas:
 * OrbitControls listens on the canvas itself, and two listeners on one target
 * fire in the order they were added — an ordering that would depend on where
 * this call sits relative to `new OrbitControls`. A capture listener on the
 * parent is ahead of both, whatever that order is.
 */
export function attachBlenderNav(controls: OrbitControls, host: HTMLElement): () => void {
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };

  const onPointerDown = (event: PointerEvent) => {
    const nav = navFor(event);
    if (nav === 'none') return;
    // Chromium answers a middle press with autoscroll, which captures the
    // pointer and leaves the drag half-delivered.
    event.preventDefault();
    // 'pan' is deliberately absent: it is the modifier case OrbitControls
    // already handles under ROTATE, and naming PAN here would break it, since
    // the PAN branch reads a held modifier as a request to rotate.
    controls.mouseButtons.MIDDLE = nav === 'dolly' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
  };

  host.addEventListener('pointerdown', onPointerDown, { capture: true });
  return () => host.removeEventListener('pointerdown', onPointerDown, { capture: true });
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
