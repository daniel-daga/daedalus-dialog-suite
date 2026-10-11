/**
 * Blender's navigation, which is what the viewport uses (level-editor.md §7).
 *
 * The mapping is worth a test rather than a comment because two of its three
 * cases are *not* implemented here: OrbitControls already turns a modifier held
 * with its ROTATE button into a pan, so the shim only has to name the button
 * and take over the one case OrbitControls gets wrong for Blender (Ctrl, which
 * it also reads as pan and Blender reads as zoom). A mapping table asserted in
 * one place is how that split stays legible.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { zenToThree } from 'zen-world';
import {
  navFor, frameOn, frameVobs, pivotAt, attachBlenderNav, ORBIT_ROTATE_SPEED,
} from '../src/renderer/world/cameraNav';

const press = (button: number, modifiers: Partial<MouseEvent> = {}) => ({
  button, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...modifiers,
});

/** Enough of an `OrbitControls` for the shim, which only writes two fields. */
const fakeControls = () => ({
  mouseButtons: { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN },
  rotateSpeed: 1.0,
}) as unknown as OrbitControls;

const leftDown = (host: HTMLElement, modifiers: Partial<PointerEventInit> = {}) => {
  const event = new MouseEvent('pointerdown', { button: 0, bubbles: true, ...modifiers });
  host.dispatchEvent(event);
  return event;
};

const up = (host: HTMLElement) => host.dispatchEvent(
  new MouseEvent('pointerup', { button: 0, bubbles: true }),
);

const middleDown = (host: HTMLElement, modifiers: Partial<PointerEventInit> = {}) => {
  // jsdom has no PointerEvent constructor; the shim reads only these fields.
  const event = new MouseEvent('pointerdown', { button: 1, bubbles: true, ...modifiers });
  host.dispatchEvent(event);
  return event;
};

describe('cameraNav', () => {
  test('the left button never moves the camera — it belongs to selection', () => {
    // The default OrbitControls mapping orbits on the left button, which is the
    // same button that picks a VOB and the same one that places one. Blender
    // does not, and neither does this: a click that both selects and tumbles is
    // unusable for the thing this viewport exists to do.
    expect(navFor(press(0))).toBe('none');
    expect(navFor(press(0, { shiftKey: true }))).toBe('none');
    expect(navFor(press(2))).toBe('none');
  });

  test('middle orbits, Shift+middle pans, Ctrl+middle zooms', () => {
    expect(navFor(press(1))).toBe('orbit');
    expect(navFor(press(1, { shiftKey: true }))).toBe('pan');
    expect(navFor(press(1, { ctrlKey: true }))).toBe('dolly');
    // macOS holds Cmd where Windows holds Ctrl, and the app runs on both.
    expect(navFor(press(1, { metaKey: true }))).toBe('dolly');
  });

  test('framing keeps the view direction and backs off far enough to see the whole radius', () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
    camera.position.set(100, 0, 0);
    const target = new THREE.Vector3(0, 0, 0);
    const before = camera.position.clone().sub(target).normalize();

    frameOn(camera, target, new THREE.Vector3(10, 20, 30), 5);

    // The target moved to what was framed, and the camera is still looking from
    // the same side — a frame that also swings the camera round is disorienting
    // in a world where every second building looks like the last.
    expect(target.toArray()).toEqual([10, 20, 30]);
    const after = camera.position.clone().sub(target).normalize();
    expect(after.distanceTo(before)).toBeLessThan(1e-9);

    // Far enough that a sphere of that radius fits the vertical field of view.
    const distance = camera.position.distanceTo(target);
    expect(distance).toBeGreaterThan(5 / Math.tan((70 * Math.PI) / 360));
  });

  test('framing a point still leaves the camera somewhere it can see from', () => {
    // A sound VOB has no visual and therefore no radius. Backing off by zero
    // would put the camera inside the thing it just framed, and the next orbit
    // would spin around a point on the near plane.
    const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
    camera.position.set(0, 0, 50);
    const target = new THREE.Vector3();

    frameOn(camera, target, new THREE.Vector3(1, 2, 3), 0);

    expect(camera.position.distanceTo(target)).toBeGreaterThan(camera.near);
  });

  test('framing from a camera sitting exactly on its target still picks a direction', () => {
    // Degenerate, and reachable: dolly all the way in and the direction the
    // frame would preserve is a zero vector, which normalises to NaN and takes
    // the camera out of the scene for good.
    const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
    camera.position.set(7, 7, 7);
    const target = new THREE.Vector3(7, 7, 7);

    frameOn(camera, target, new THREE.Vector3(0, 0, 0), 10);

    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(camera.position.distanceTo(target)).toBeGreaterThan(0);
  });

  test('the orbit speed reaches the controls from the one place it is named', () => {
    // What this pins is the wiring, not the number: the rate has been changed
    // by hand before (0.4, then back to 1.0) and an assertion on the value is
    // one that goes stale the next time somebody drags the viewport and
    // disagrees. That it is applied at all is the part that must not rot.
    const controls = fakeControls();
    controls.rotateSpeed = Number.NaN;
    attachBlenderNav(controls, document.createElement('div'));

    expect(controls.rotateSpeed).toBe(ORBIT_ROTATE_SPEED);
    expect(ORBIT_ROTATE_SPEED).toBeGreaterThan(0);
  });

  test('Alt+left stands in for the middle button, which a trackpad does not have', () => {
    // Blender's own "Emulate 3 Button Mouse", and the reason it is Alt: every
    // other modifier on the left button is already spoken for by selection
    // (Shift, Ctrl and Cmd all add to it — level-editor.md §7).
    expect(navFor(press(0, { altKey: true }))).toBe('orbit');
    expect(navFor(press(0, { altKey: true, shiftKey: true }))).toBe('pan');
    expect(navFor(press(0, { altKey: true, ctrlKey: true }))).toBe('dolly');
    expect(navFor(press(0, { altKey: true, metaKey: true }))).toBe('dolly');
    // The emulation is the left button's alone: Alt on any other one changes
    // nothing, so a real three-button mouse behaves exactly as it did.
    expect(navFor(press(2, { altKey: true }))).toBe('none');
    expect(navFor(press(1, { altKey: true }))).toBe('orbit');
  });

  test('the left button is lent to the drag and taken back when it ends', () => {
    // The left button is `null` in the mapping precisely so that a click can
    // mean "select this VOB". An emulated middle drag has to borrow it, and a
    // borrow that is not given back would leave every later click tumbling the
    // world — the exact failure the Blender mapping exists to prevent.
    const controls = fakeControls();
    const host = document.createElement('div');
    attachBlenderNav(controls, host);

    leftDown(host, { altKey: true });
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    up(host);
    expect(controls.mouseButtons.LEFT).toBeNull();

    leftDown(host, { altKey: true, ctrlKey: true });
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.DOLLY);
    up(host);
    expect(controls.mouseButtons.LEFT).toBeNull();

    // Shift is deliberately not DOLLY or PAN: OrbitControls' ROTATE branch
    // already reads a held modifier as a request to pan, exactly as it does
    // for the real middle button.
    leftDown(host, { altKey: true, shiftKey: true });
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    up(host);

    // And a plain left press never borrows it at all.
    leftDown(host);
    expect(controls.mouseButtons.LEFT).toBeNull();
  });

  test('a press that navigates asks for a pivot; one that selects does not', () => {
    // The pivot has to be set *before* OrbitControls sees the press, which is
    // why it hangs off this shim's capture listener rather than off a second
    // one on the canvas.
    const host = document.createElement('div');
    const asked: string[] = [];
    attachBlenderNav(fakeControls(), host, (event) => asked.push(`${event.button}`));

    middleDown(host);
    middleDown(host, { shiftKey: true });
    middleDown(host, { ctrlKey: true });
    leftDown(host, { altKey: true });
    host.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));

    // Orbit, pan and dolly all scale by the camera-to-target distance, so all
    // three want the pivot moved; the left button never moves the camera.
    // The emulated middle button wants the pivot for the same reason the real
    // one does — it is the same three navigations.
    expect(asked).toEqual(['1', '1', '1', '0']);
  });

  test('the pivot hook is told which navigation the press is', () => {
    // The caller has to tell them apart: an orbit must keep the pivot a
    // double-click deliberately set, while a dolly or a pan still wants it
    // under the cursor, because scaling the step by the distance to *that*
    // is the whole of what they use it for.
    const host = document.createElement('div');
    const asked: string[] = [];
    attachBlenderNav(fakeControls(), host, (_event, nav) => asked.push(nav));

    middleDown(host);
    middleDown(host, { shiftKey: true });
    middleDown(host, { ctrlKey: true });
    leftDown(host, { altKey: true });

    expect(asked).toEqual(['orbit', 'pan', 'dolly', 'orbit']);
  });
});

describe('frameVobs', () => {
  /** A camera looking down -Z from the origin, as far from the fixtures below
   *  as the framing has to move it. */
  const looking = () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
    camera.position.set(0, 0, 0);
    return { camera, target: new THREE.Vector3(0, 0, -100) };
  };

  test('leaves the orbit pivot exactly on the VOB, in the viewport’s own space', () => {
    // The payoff of the pivot work, and what a jump from the scene tree is for:
    // the pivot starts at the centre of a 600 m island, so arriving at a VOB
    // without taking the pivot along leaves the first orbit swinging the camera
    // through half the world.
    const { camera, target } = looking();
    // Deliberately not round, and with a non-zero X: the conversion out of
    // ZenGin space mirrors that axis, so a VOB at x = 0 could not tell a real
    // conversion from a copy.
    const at: [number, number, number] = [1500.5, -220, 3300.25];

    const center = frameVobs(camera, target, [{ at, bounds: null }]);

    expect(center?.toArray()).toEqual(zenToThree(at));
    expect(target.toArray()).toEqual(zenToThree(at));
    // And the camera actually went there — near enough to see it, and not
    // inside it.
    expect(camera.position.distanceTo(target)).toBeGreaterThan(camera.near);
    expect(camera.position.distanceTo(target)).toBeLessThan(20);
  });

  test('backs off for the visual’s own size, not just for its origin', () => {
    // A 20 m long house and a sound VOB are the same point without this, and
    // the house is framed from inside itself.
    const bare = looking();
    frameVobs(bare.camera, bare.target, [{ at: [0, 0, 0], bounds: null }]);

    const big = looking();
    // ZenGin centimetres, 20 m across the long axis.
    frameVobs(big.camera, big.target, [{ at: [0, 0, 0], bounds: [-100, 0, -1000, 100, 200, 1000] }]);

    expect(big.camera.position.distanceTo(big.target))
      .toBeGreaterThan(bare.camera.position.distanceTo(bare.target) + 5);
  });

  test('frames a multi-select on the middle of it, far enough back for all of it', () => {
    const { camera, target } = looking();
    const left: [number, number, number] = [-1000, 0, 0];
    const right: [number, number, number] = [1000, 0, 0];

    frameVobs(camera, target, [{ at: left, bounds: null }, { at: right, bounds: null }]);

    expect(target.toArray()).toEqual([0, 0, 0]);
    // Both of them are inside the framed sphere: 10 m apart, so the radius the
    // camera backs off for is at least the 5 m to either one.
    expect(camera.position.distanceTo(new THREE.Vector3(...zenToThree(left))))
      .toBeGreaterThan(5);
  });

  test('a selection with nothing drawn in it moves neither the camera nor the pivot', () => {
    // A decal, a sound VOB, an unresolved visual: the tree can reach VOBs the
    // viewport cannot draw, and there is nowhere to jump to.
    const { camera, target } = looking();
    const was = camera.position.clone();

    expect(frameVobs(camera, target, [])).toBeNull();

    expect(camera.position.toArray()).toEqual(was.toArray());
    expect(target.toArray()).toEqual([0, 0, -100]);
  });
});

describe('pivotAt', () => {
  /** A camera at `from` looking at `at`, as OrbitControls leaves it. */
  const looking = (from: [number, number, number], at: [number, number, number]) => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
    camera.position.set(...from);
    const target = new THREE.Vector3(...at);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    return { camera, target };
  };

  test('the pivot lands at the depth of the picked point and the view does not move', () => {
    // The defect: the pivot sits at the centre of a 600 m island, so a dolly
    // step, a pan and an orbit are all scaled by 600 m no matter how close to a
    // wall the camera is.
    const { camera, target } = looking([0, 0, 600], [0, 0, 0]);
    const before = camera.matrixWorld.clone();

    // 5 m in front of the camera, off to the side — what the cursor was over.
    pivotAt(camera, target, new THREE.Vector3(2, 1, 595));

    expect(camera.position.distanceTo(target)).toBeCloseTo(5, 6);

    // OrbitControls re-aims the camera at the target every frame, so the move
    // is only invisible if the new pivot is on the view axis: same forward,
    // same up, therefore the very same pixels.
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.matrixWorld.elements.forEach((element, i) => {
      expect(element).toBeCloseTo(before.elements[i], 6);
    });
  });

  test('the pivot follows the camera rather than the axes', () => {
    // Not axis-aligned, because the projection is a dot product and a test that
    // only ever looks down -Z cannot tell a correct one from `pick.z`.
    const { camera, target } = looking([10, 20, 30], [0, 0, 0]);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    // Sideways from the axis by 3, at a depth of exactly 7.
    const sideways = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
    const pick = camera.position.clone()
      .addScaledVector(direction, 7)
      .addScaledVector(sideways, 3);

    pivotAt(camera, target, pick);

    // The pivot is the *projection* onto the view axis: the depth survives, the
    // sideways offset does not.
    expect(camera.position.distanceTo(target)).toBeCloseTo(7, 5);
    expect(target.distanceTo(camera.position.clone().addScaledVector(direction, 7))).toBeCloseTo(0, 5);
  });

  test('a pick right against the lens still leaves a pivot to navigate about', () => {
    // Zoom into a wall and the point under the cursor is centimetres away. A
    // pivot at zero distance scales every dolly step and pan to zero, which is
    // navigation that has locked up.
    const { camera, target } = looking([0, 0, 600], [0, 0, 0]);

    pivotAt(camera, target, new THREE.Vector3(0, 0, 599.99));

    const distance = camera.position.distanceTo(target);
    expect(distance).toBeGreaterThan(camera.near);
    expect(distance).toBeLessThan(5);
  });

  test('a point behind the camera is not a pivot', () => {
    // Reachable through the last-pick fallback: select something, then turn
    // away from it before starting a drag. Projecting it would put the pivot
    // behind the lens and invert every orbit.
    const { camera, target } = looking([0, 0, 600], [0, 0, 0]);
    const unchanged = target.clone();

    pivotAt(camera, target, new THREE.Vector3(0, 0, 900));

    expect(target.toArray()).toEqual(unchanged.toArray());
  });
});
