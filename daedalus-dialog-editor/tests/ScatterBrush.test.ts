/**
 * The scatter brush as a unit (level-editor.md §16.25, #220).
 *
 * It used to be ~140 lines of closure inside `WorldViewport`'s 1,310-line
 * effect, reachable only by rendering the whole viewport with three quarters of
 * it mocked — which is how it shipped with a raycaster that could not meet the
 * world mesh and no test to say so. `WorldViewport.scatterBrush.test.tsx` is
 * still the spec that proves the wiring against a real viewport; this one is
 * the brush's own rules, at one press each: what starts a stroke, what refuses
 * to, and what a stroke does to the gizmo on its way past.
 *
 * A real `three` raycast against a real quad, so "a press on the world starts a
 * stroke" is the assertion rather than a mock's say-so.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from '@jest/globals';
import type { ZenPosition } from 'zen-world';
import { ScatterBrush } from '../src/renderer/world/ScatterBrush';

const WIDTH = 800;
const HEIGHT = 600;
/** The canvas middle — a ray straight down the camera's axis. */
const CENTRE = { clientX: WIDTH / 2, clientY: HEIGHT / 2 };

/** A ground quad at y = 0, 20 units across. Wide enough that the camera's
 *  forward ray and a small sideways drag both land on it, and small enough
 *  that the top of the frame — 20.7 units out at this pitch — misses, which is
 *  what the two "off the world" cases need. */
function ground(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function harness({ radius = 200, walking = false }: { radius?: number | null; walking?: boolean } = {}) {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);
  // jsdom lays nothing out and implements no pointer capture.
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT,
    x: 0, y: 0, toJSON: () => ({}),
  });
  const captured = new Set<number>();
  canvas.setPointerCapture = (id: number) => { captured.add(id); };
  canvas.hasPointerCapture = (id: number) => captured.has(id);
  canvas.releasePointerCapture = (id: number) => { captured.delete(id); };

  const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const mesh = ground();
  const root = new THREE.Group();
  const gizmo = { enabled: true };
  const strokes: (readonly ZenPosition[])[] = [];

  const brush = new ScatterBrush({
    host,
    canvas,
    camera,
    root,
    worldMeshes: () => [mesh],
    radius: () => radius,
    walking: () => walking,
    gizmo,
    onStroke: (samples) => { strokes.push(samples); },
  });
  brush.attach();

  return { brush, host, canvas, gizmo, strokes, root, captured };
}

/** A press, a move and a release, all through the real listeners. */
const press = (canvas: HTMLElement, init: Partial<MouseEventInit> & { clientX?: number } = {}) =>
  canvas.dispatchEvent(new MouseEvent('pointerdown', {
    bubbles: true, button: 0, ...CENTRE, ...init,
  }));
const move = (init: Partial<MouseEventInit> = {}) =>
  window.dispatchEvent(new MouseEvent('pointermove', { ...CENTRE, ...init }));
const release = () =>
  window.dispatchEvent(new MouseEvent('pointerup', { ...CENTRE }));

describe('ScatterBrush', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('turns a press, a drag and a release into one stroke on the world', () => {
    const { canvas, strokes } = harness();

    press(canvas);
    move({ clientX: WIDTH / 2 + 40 });
    release();

    expect(strokes).toHaveLength(1);
    // The press point and the point the drag added, both on the quad: y is the
    // ground's own height in ZenGin space.
    expect(strokes[0]).toHaveLength(2);
    for (const [, y] of strokes[0]) expect(y).toBeCloseTo(0, 3);
    // ...and the drag moved along the ground rather than repeating the press.
    expect(strokes[0][1][0]).not.toBeCloseTo(strokes[0][0][0], 3);
  });

  it('switches the gizmo off for the length of the stroke and puts it back', () => {
    // The palette *is* the selection, so the gizmo stands exactly where the
    // user is about to paint. A stroke that fought it would drag an axis.
    const { canvas, gizmo } = harness();

    press(canvas);
    expect(gizmo.enabled).toBe(false);

    release();
    expect(gizmo.enabled).toBe(true);
  });

  it('answers the click that ends a stroke once, then stops', () => {
    // The click a release fires would otherwise select whatever the stroke
    // painted with, which makes a second stroke impossible.
    const { canvas, brush } = harness();

    expect(brush.consumePainted()).toBe(false);
    press(canvas);
    expect(brush.consumePainted()).toBe(true);
    expect(brush.consumePainted()).toBe(false);
  });

  it('starts nothing while the brush is off', () => {
    const { canvas, strokes, gizmo } = harness({ radius: null });

    press(canvas);
    release();

    expect(strokes).toEqual([]);
    expect(gizmo.enabled).toBe(true);
  });

  it('starts nothing during a walk — that press belongs to the walk', () => {
    const { canvas, strokes } = harness({ walking: true });

    press(canvas);
    release();

    expect(strokes).toEqual([]);
  });

  it('leaves a modified press to the camera', () => {
    // Alt+left is the emulated middle button, which is how a trackpad orbits.
    // A brush that took it would leave that machine unable to navigate.
    const { canvas, strokes } = harness();

    press(canvas, { altKey: true });
    release();

    expect(strokes).toEqual([]);
  });

  it('starts nothing on a press that misses the world', () => {
    // Above the horizon: the ray meets no mesh, so there is no point to paint
    // from and no stroke to end.
    const { canvas, strokes } = harness();

    press(canvas, { clientY: 0 });
    release();

    expect(strokes).toEqual([]);
  });

  it('keeps one stroke across a cursor that leaves the world and comes back', () => {
    // A drag over the sky between two hillsides is one stroke: the ring has
    // nothing to show, but the samples either side belong together.
    const { canvas, strokes } = harness();

    press(canvas);
    move({ clientY: 0 });
    move({ clientX: WIDTH / 2 + 40 });
    release();

    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toHaveLength(2);
  });

  it('takes its ring and its listeners with it when disposed', () => {
    const { canvas, brush, strokes, root } = harness();

    expect(root.children).toHaveLength(1);
    brush.dispose();

    expect(root.children).toHaveLength(0);
    press(canvas);
    release();
    expect(strokes).toEqual([]);
  });
});
