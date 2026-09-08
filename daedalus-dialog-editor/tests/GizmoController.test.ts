/**
 * The transform gizmo as a unit (level-editor.md §7, #220).
 *
 * It was ~230 lines of closure inside `WorldViewport`'s one big effect, so
 * every rule below could only be reached by rendering the whole viewport with
 * the renderer, the picker, the BVH and the controls all mocked. The viewport
 * specs still hold the wiring — `WorldViewport.snapping`, `.selection`,
 * `.multiSelect` — and this one holds the rules themselves at one drag each:
 * where the gizmo stands, what a drag commits, what it refuses to commit, and
 * what the snap step does to the pose everything downstream reads.
 *
 * `TransformControls` is stood in for, because jsdom has no GL context and the
 * library's own pointer handling is not what is being checked — the controller
 * reads it through `getMode`/`enabled` and hears it through two events, and
 * those are what the stand-in provides.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from '@jest/globals';
import type { ZenRotation } from 'zen-world';
import * as mockWorldViewport from './worldViewportMocks';

jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());

import { GizmoController, type GizmoMode } from '../src/renderer/world/GizmoController';
import type { WaynetOverlay } from '../src/renderer/world/WaynetOverlay';
import type { WorldScene } from '../src/renderer/world/WorldScene';

const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Just the handful of `WorldScene` the gizmo touches, plus a record of what it
 *  was asked to preview. */
function fakeWorld(positions: Record<number, [number, number, number]>) {
  const moved: Array<[number, [number, number, number]]> = [];
  const turned: Array<[number, ZenRotation]> = [];
  return {
    moved,
    turned,
    scene: {
      root: new THREE.Group(),
      positionOf: (vob: number) => positions[vob] ?? null,
      rotationOf: (vob: number) => (vob in positions ? IDENTITY : null),
      // The last VOB picked, which is what a rotate gizmo stands on.
      anchorOf: (vobs: readonly number[]) => (
        vobs.length === 0 ? null : positions[vobs[vobs.length - 1]] ?? null
      ),
      centroidOf: (vobs: readonly number[]) => {
        const known = vobs.map((vob) => positions[vob]).filter(Boolean);
        if (known.length === 0) return null;
        return [0, 1, 2].map((axis) =>
          known.reduce((sum, at) => sum + at[axis], 0) / known.length) as [number, number, number];
      },
      moveVob: (vob: number, to: [number, number, number]) => { moved.push([vob, to]); },
      rotateVob: (vob: number, to: ZenRotation) => { turned.push([vob, to]); },
    } as unknown as WorldScene,
  };
}

function harness({
  mode = 'translate' as GizmoMode,
  snapGrid = 0,
  snapAngle = 0,
  positions = { 1: [100, 0, 0] as [number, number, number], 2: [300, 0, 0] as [number, number, number] },
  waypoints = { 7: [50, 60, 70] as [number, number, number] },
} = {}) {
  const world = fakeWorld(positions);
  const controls = { enabled: true };
  const translated: [number, number, number][] = [];
  const rotated: ZenRotation[] = [];
  const waypointMoves: Array<[number, [number, number, number], [number, number, number]]> = [];

  const overlay = {
    positionOf: (waypoint: number) => waypoints[waypoint as keyof typeof waypoints],
    setPosition: (waypoint: number, at: [number, number, number]) => {
      (waypoints as Record<number, [number, number, number]>)[waypoint] = at;
    },
  } as unknown as WaynetOverlay;

  const gizmo = new GizmoController({
    camera: new THREE.PerspectiveCamera(),
    canvas: document.createElement('canvas'),
    scene: new THREE.Scene(),
    world: world.scene,
    controls,
    overlay: () => overlay,
    mode,
    snapGrid: () => snapGrid,
    snapAngle: () => snapAngle,
    onTranslate: (delta) => { translated.push(delta); },
    onRotate: (delta) => { rotated.push(delta); },
    onMoveWaypoint: (waypoint, from, to) => { waypointMoves.push([waypoint, from, to]); },
  });

  return { gizmo, world, controls, translated, rotated, waypointMoves, waypoints };
}

describe('GizmoController', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('stands at the centroid to translate and on the last VOB to rotate', () => {
    // Not one answer for both: `rotateVobs` turns each VOB about its own
    // origin, so a rotate gizmo at the centroid would draw a pivot the op does
    // not use and the first multi-VOB rotate would look broken.
    const translate = harness({ mode: 'translate' });
    translate.gizmo.attach([1, 2]);
    expect(translate.gizmo.position()).toEqual([200, 0, 0]);

    const rotate = harness({ mode: 'rotate' });
    rotate.gizmo.attach([1, 2]);
    expect(rotate.gizmo.position()).toEqual([300, 0, 0]);
  });

  it('moves the gizmo when the mode changes, not only its handles', () => {
    const { gizmo } = harness({ mode: 'translate' });

    gizmo.attach([1, 2]);
    expect(gizmo.position()).toEqual([200, 0, 0]);

    gizmo.setMode('rotate');
    expect(gizmo.position()).toEqual([300, 0, 0]);
  });

  it('detaches, and stands nowhere, for a selection with nothing placed in it', () => {
    const { gizmo } = harness();

    gizmo.attach([99]);

    expect(gizmo.position()).toBeNull();
    expect(gizmo.enabled).toBe(false);
    expect(gizmo.helperVisible).toBe(false);
  });

  it('commits the delta a drag made, and previews it on the way', () => {
    const { gizmo, translated, world } = harness();

    gizmo.attach([1, 2]);
    gizmo.dragTo([250, 10, 0]);

    expect(translated).toEqual([[50, 10, 0]]);
    // Each VOB moved by that delta from where *it* was, not to where the gizmo
    // is: the drag is a delta, and a shared destination would collapse the
    // selection onto one point.
    expect(world.moved).toEqual([[1, [150, 10, 0]], [2, [350, 10, 0]]]);
  });

  it('commits nothing for a drag that moved nothing', () => {
    // A click that dragged nowhere. Committing it would put an op on the undo
    // stack that undoes nothing.
    const { gizmo, translated } = harness();

    gizmo.attach([1, 2]);
    gizmo.dragTo([200, 0, 0]);

    expect(translated).toEqual([]);
  });

  it('quantises the drag on the proxy, so every reader sees the same number', () => {
    // On the proxy rather than on the delta, because the preview, the commit
    // and the harness all take their number from it — snapping any one of them
    // separately would be a second place the step has to be applied.
    const { gizmo, translated } = harness({ snapGrid: 100 });

    gizmo.attach([1]);
    gizmo.dragTo([238, 0, 0]);

    expect(translated).toEqual([[100, 0, 0]]);
    expect(gizmo.position()).toEqual([200, 0, 0]);
  });

  it('turns each VOB about its own origin, and reports one delta', () => {
    const { gizmo, rotated, world } = harness({ mode: 'rotate' });

    gizmo.attach([1, 2]);
    gizmo.turnBy([0, 1, 0], Math.PI / 2);

    expect(rotated).toHaveLength(1);
    // A quarter turn about Y, in ZenGin's row-major basis — the axis goes in
    // in that basis and comes back in it, which is what says the mirror was
    // applied and unapplied rather than skipped.
    const [xx, , xz, , yy, , zx, , zz] = rotated[0];
    expect(xx).toBeCloseTo(0, 6);
    expect(yy).toBeCloseTo(1, 6);
    expect(xz).toBeCloseTo(1, 6);
    expect(zx).toBeCloseTo(-1, 6);
    expect(zz).toBeCloseTo(0, 6);
    expect(world.turned.map(([vob]) => vob)).toEqual([1, 2]);
  });

  it('commits nothing for a turn that turned nothing', () => {
    const { gizmo, rotated } = harness({ mode: 'rotate' });

    gizmo.attach([1]);
    gizmo.turnBy([0, 1, 0], 0);

    expect(rotated).toEqual([]);
  });

  it('drags a waypoint from where it was to where it was left', () => {
    const { gizmo, waypointMoves, translated } = harness();

    gizmo.attachWaypoint(7);
    expect(gizmo.position()).toEqual([50, 60, 70]);
    gizmo.dragTo([50, 90, 70]);

    expect(waypointMoves).toEqual([[7, [50, 60, 70], [50, 90, 70]]]);
    // A waypoint is not a VOB: nothing on the VOB path fires for it.
    expect(translated).toEqual([]);
  });

  it('keeps the waypoint on translate however the mode is switched', () => {
    // `MoveWaypoint` is the only waynet op there is, so a rotate ring here
    // would turn something the world would never be told about. The VOBs' own
    // mode survives the detour.
    const { gizmo, waypointMoves } = harness({ mode: 'translate' });

    gizmo.attachWaypoint(7);
    gizmo.setMode('rotate');
    gizmo.dragTo([50, 90, 70]);

    expect(waypointMoves).toHaveLength(1);

    gizmo.attach([1, 2]);
    expect(gizmo.position()).toEqual([300, 0, 0]);
  });

  it('frees the camera for the length of the drag and gives it back', () => {
    // A drag must not also orbit. The preview runs *inside* the drag, so what
    // it sees is the state while the drag is live.
    const { gizmo, world, controls } = harness();
    const seen: boolean[] = [];
    const move = world.scene.moveVob.bind(world.scene);
    world.scene.moveVob = (vob, to) => { seen.push(controls.enabled); move(vob, to); };

    gizmo.attach([1]);
    gizmo.dragTo([150, 0, 0]);

    expect(seen).toEqual([false]);
    // Back on once the drag ends — a gizmo that left it off would freeze the
    // camera for the rest of the session.
    expect(controls.enabled).toBe(true);
  });

  it('answers the click that ends a drag once, then stops', () => {
    // The click a release fires would pick whatever sits behind the gizmo —
    // usually nothing — so a finished drag would deselect the VOB it moved.
    const { gizmo } = harness();

    expect(gizmo.consumeEndedDrag()).toBe(false);
    gizmo.attach([1]);
    gizmo.dragTo([150, 0, 0]);
    expect(gizmo.consumeEndedDrag()).toBe(true);
    expect(gizmo.consumeEndedDrag()).toBe(false);
  });

  it('refuses to be driven with nothing attached', () => {
    const { gizmo } = harness();

    expect(() => gizmo.dragTo([0, 0, 0])).toThrow('nothing is selected');
    expect(() => gizmo.turnBy([0, 1, 0], 1)).toThrow('no VOB is selected');
  });
});
