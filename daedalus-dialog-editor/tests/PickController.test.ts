/**
 * What a click means (level-editor.md §3, §16.12, §17, #220).
 *
 * The three handlers were closures inside `WorldViewport`'s one big effect, so
 * the rules below could only be reached by rendering the whole viewport with
 * the renderer, the picker and the BVH all stood in for. What they are actually
 * about is an *order* — which is a rule, and the kind of thing that should cost
 * one assertion:
 *
 *   - a click asks the waynet, then the props, then the world mesh;
 *   - a double-click asks the mesh, then the props;
 *   - a right-click asks the props and stops.
 *
 * `pickWaypoint` and the GPU picker are stood in for, because each has its own
 * spec and neither is what is being checked here — what is, is which of them is
 * asked, in which order, and when none of them is asked at all.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from '@jest/globals';
import type { ZenPosition } from 'zen-world';

const waypointPick = { answer: -1 };

jest.mock('../src/renderer/world/pickWaypoint', () => ({
  NO_WAYPOINT: -1,
  pickWaypoint: () => waypointPick.answer,
}));

import { PickController } from '../src/renderer/world/PickController';
import { NO_PICK } from '../src/renderer/world/pickIds';
import type { VobPicker } from '../src/renderer/world/VobPicker';
import type { WaynetOverlay } from '../src/renderer/world/WaynetOverlay';
import type { WorldScene } from '../src/renderer/world/WorldScene';

const WIDTH = 800;
const HEIGHT = 600;
const CENTRE = { clientX: WIDTH / 2, clientY: HEIGHT / 2, bubbles: true };

/** A ground quad at y = 0 under the camera, 20 units across — so the middle of
 *  the canvas hits it and the top of the frame misses. */
function ground(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function harness({
  vobUnderCursor = NO_PICK,
  waypointUnderCursor = -1,
  showWaynet = true,
  walking = false,
  gesture = false,
  fly = false,
  menu = true,
  hasMesh = true,
  vobPositions = { 5: [500, 60, 700] as ZenPosition },
} = {}) {
  waypointPick.answer = waypointUnderCursor;

  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT,
    x: 0, y: 0, toJSON: () => ({}),
  });

  const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const mesh = ground();
  const world = {
    root: new THREE.Group(),
    worldMeshes: hasMesh ? [mesh] : [],
    positionOf: (vob: number) => vobPositions[vob as keyof typeof vobPositions] ?? null,
  } as unknown as WorldScene;

  let picks = 0;
  const picker = {
    pickAsync: async () => { picks += 1; return vobUnderCursor; },
  } as unknown as VobPicker;

  const controls = { target: new THREE.Vector3() };
  const picked: Array<[number | null, ZenPosition | null, boolean]> = [];
  const waypoints: number[] = [];
  const menus: Array<[number, { left: number; top: number }]> = [];
  const remembered: THREE.Vector3[] = [];
  const pivots: Array<[THREE.Vector3, ZenPosition]> = [];
  let disposed = false;

  const controller = new PickController({
    renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer,
    camera,
    world,
    picker,
    controls,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    waynet: () => ({ positions: new Float32Array(3) } as unknown as WaynetOverlay),
    showWaynet: () => showWaynet,
    disposed: () => disposed,
    walking: () => walking,
    consumeGesture: () => gesture,
    consumeFly: () => fly,
    contextMenu: () => (menu ? (vob, at) => { menus.push([vob, at]); } : undefined),
    onPick: (vob, terrain, additive) => { picked.push([vob, terrain, additive]); },
    onSelectWaypoint: (waypoint) => { waypoints.push(waypoint); },
    rememberPick: (at) => { remembered.push(at.clone()); },
    onPivot: (at, zen) => { pivots.push([at.clone(), zen]); },
  });
  controller.attach();

  return {
    controller, canvas, controls, picked, waypoints, menus, remembered, pivots,
    picks: () => picks,
    dispose: () => { disposed = true; },
  };
}

const click = (canvas: HTMLElement, init: MouseEventInit = {}) =>
  canvas.dispatchEvent(new MouseEvent('click', { ...CENTRE, ...init }));
const doubleClick = (canvas: HTMLElement, init: MouseEventInit = {}) =>
  canvas.dispatchEvent(new MouseEvent('dblclick', { ...CENTRE, ...init }));
const rightClick = (canvas: HTMLElement, init: MouseEventInit = {}) => {
  const event = new MouseEvent('contextmenu', { ...CENTRE, cancelable: true, ...init });
  canvas.dispatchEvent(event);
  return event;
};

/** The handlers are async; let their awaits settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('PickController — a click', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('asks the waynet first, and stops there when it hits', async () => {
    // The overlay draws with `depthTest: false`, plainly on top of everything.
    // Picking it second would mean clicking a dot you can see and selecting the
    // wall behind it. A VOB is under the cursor too, and must not win.
    const h = harness({ waypointUnderCursor: 3, vobUnderCursor: 5 });

    click(h.canvas);
    await settle();

    expect(h.waypoints).toEqual([3]);
    expect(h.picked).toEqual([]);
    expect(h.picks()).toBe(0);
  });

  it('does not ask the waynet at all while it is switched off', async () => {
    const h = harness({ waypointUnderCursor: 3, vobUnderCursor: 5, showWaynet: false });

    click(h.canvas);
    await settle();

    expect(h.waypoints).toEqual([]);
    expect(h.picked).toEqual([[5, null, false]]);
  });

  it('takes the prop next, and never raycasts the mesh for it', async () => {
    const h = harness({ vobUnderCursor: 5 });

    click(h.canvas);
    await settle();

    expect(h.picked).toEqual([[5, null, false]]);
    // Where the VOB stands, remembered as the fallback pivot for a later drag
    // that begins over the sky.
    expect(h.remembered).toHaveLength(1);
  });

  it('falls through to the world mesh, and reports the point in ZenGin space', async () => {
    const h = harness({ vobUnderCursor: NO_PICK });

    click(h.canvas);
    await settle();

    expect(h.picked).toHaveLength(1);
    const [vob, terrain] = h.picked[0];
    expect(vob).toBeNull();
    expect(terrain).not.toBeNull();
    // The quad is at y = 0, and ZenGin's Y is the same up as three's.
    expect(terrain![1]).toBeCloseTo(0, 3);
    expect(h.remembered).toHaveLength(1);
  });

  it('reports a click on nothing as a click on nothing, and still clears the selection', async () => {
    // Not a no-op: clicking empty sky is how a selection is dropped.
    const h = harness({ vobUnderCursor: NO_PICK, hasMesh: false });

    click(h.canvas);
    await settle();

    expect(h.picked).toEqual([[null, null, false]]);
    expect(h.remembered).toEqual([]);
  });

  it('reads the modifier as "add to the selection"', async () => {
    const h = harness({ vobUnderCursor: 5 });

    click(h.canvas, { shiftKey: true });
    await settle();

    expect(h.picked).toEqual([[5, null, true]]);
  });

  it('picks nothing during a walk', async () => {
    // A walk's click lands at the frozen pointer-lock coordinates, so it would
    // select whatever sat under wherever the cursor was when the walk began.
    const h = harness({ vobUnderCursor: 5, walking: true });

    click(h.canvas);
    await settle();

    expect(h.picked).toEqual([]);
    expect(h.picks()).toBe(0);
  });

  it('picks nothing on the click that ends another gesture', async () => {
    // A gizmo drag, a camera drag and a brush stroke all end with a `click` on
    // the canvas. Picking on it throws away the thing the gesture just acted on.
    const h = harness({ vobUnderCursor: 5, gesture: true });

    click(h.canvas);
    await settle();

    expect(h.picked).toEqual([]);
    expect(h.picks()).toBe(0);
  });

  it('answers nothing into a scene that was closed mid-flight', async () => {
    const h = harness({ vobUnderCursor: 5 });

    click(h.canvas);
    h.dispose();
    await settle();

    expect(h.picked).toEqual([]);
  });

  it('stops listening once disposed', async () => {
    const h = harness({ vobUnderCursor: 5 });

    h.controller.dispose();
    click(h.canvas);
    await settle();

    expect(h.picked).toEqual([]);
    expect(h.picks()).toBe(0);
  });
});

describe('PickController — a double-click', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('makes the surface under the cursor the pivot, before asking about props', async () => {
    const h = harness({ vobUnderCursor: 5 });

    doubleClick(h.canvas);
    await settle();

    expect(h.pivots).toHaveLength(1);
    expect(h.controls.target.y).toBeCloseTo(0, 3);
    // The mesh answered, so the GPU pick was never paid for.
    expect(h.picks()).toBe(0);
  });

  it('falls back to the prop when the click was over the sky', async () => {
    // Without the fallback a double-click over sky did nothing at all.
    const h = harness({ vobUnderCursor: 5, hasMesh: false });

    doubleClick(h.canvas);
    await settle();

    expect(h.pivots).toHaveLength(1);
    expect(h.pivots[0][1]).toEqual([500, 60, 700]);
    expect(h.picks()).toBe(1);
  });

  it('pivots on nothing when neither answers', async () => {
    const h = harness({ vobUnderCursor: NO_PICK, hasMesh: false });

    doubleClick(h.canvas);
    await settle();

    expect(h.pivots).toEqual([]);
  });
});

describe('PickController — a right-click', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('opens the menu on the prop under the cursor', async () => {
    const h = harness({ vobUnderCursor: 5 });

    const event = rightClick(h.canvas);
    await settle();

    expect(h.menus).toEqual([[5, { left: WIDTH / 2, top: HEIGHT / 2 }]]);
    // The browser's own menu is swallowed first, unconditionally: that is not
    // something the awaited pick's outcome should decide.
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens nothing over terrain or sky, and reserves that pick', async () => {
    const h = harness({ vobUnderCursor: NO_PICK });

    rightClick(h.canvas);
    await settle();

    expect(h.menus).toEqual([]);
  });

  it('opens nothing at the end of a fly, and swallows the browser menu too', async () => {
    const h = harness({ vobUnderCursor: 5, fly: true });

    const event = rightClick(h.canvas);
    await settle();

    expect(h.menus).toEqual([]);
    expect(h.picks()).toBe(0);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the browser its own menu where the surface offers none', async () => {
    const h = harness({ vobUnderCursor: 5, menu: false });

    const event = rightClick(h.canvas);
    await settle();

    expect(h.menus).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});
