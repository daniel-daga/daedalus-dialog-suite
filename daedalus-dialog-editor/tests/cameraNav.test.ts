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
import { navFor, frameOn } from '../src/renderer/world/cameraNav';

const press = (button: number, modifiers: Partial<MouseEvent> = {}) => ({
  button, shiftKey: false, ctrlKey: false, metaKey: false, ...modifiers,
});

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
});
