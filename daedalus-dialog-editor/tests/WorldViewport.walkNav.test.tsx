/**
 * The viewport's half of walk navigation (plan §16.26 row 3): F3 toggles a
 * walk under pointer lock, WASD is the walker's and not the gizmo's, the
 * mouse looks only while walking, and every other gesture the lock leaves
 * firing at frozen coordinates — click, right button, fly — is declined.
 *
 * Wiring only. The mocked `BvhBuilder` never sets a tree, so there is no
 * floor here and a walker falls — the collision itself is `walkNav.test.ts`.
 * jsdom has no Pointer Lock API at all: the canvas's `requestPointerLock`
 * is the mock renderer's `jest.fn`, and `document.pointerLockElement` /
 * `exitPointerLock` are stubbed below, so a regression those stubs cannot
 * express needs a pass in the real app.
 *
 * Mocks and the hand-driven frame loop as in `.flyNav.test.tsx`.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';
import { LOOK_RADIANS_PER_PIXEL } from '../src/renderer/world/flyNav';
import { WALK_SPEED, WALK_EXIT_PIVOT_DISTANCE } from '../src/renderer/world/walkNav';

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker(7));

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 10000, 10000, 10000] };
const VISUALS: InstancedPayload = {
  visuals: [],
  stats: {
    visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0,
    instancedDrawGroups: 0, levelCompos: 0, unresolvedByType: {},
  },
};

function props(onPick: (vob: number | null) => void = () => {}) {
  return {
    mesh: MESH,
    visuals: VISUALS,
    bbox: [0, 0, 0, 10000, 10000, 10000],
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    routines: {},
    spawnTime: null,
    spawnState: null,
    showWaypointNames: false,
    loadTexture: async () => null,
    onPick,
    onVobContextMenu: () => {},
    selection: [] as readonly number[],
    onTranslateSelection: () => {},
    gizmoMode: 'translate' as const,
    onRotateSelection: () => {},
    appliedOps: null,
    selectedWaypoint: null,
    terrainPoint: null,
    exposure: 1,
    hiddenVobs: null,
    snapGrid: 0,
    snapAngle: 0,
    onSelectWaypoint: () => {},
    onMoveWaypoint: () => {},
  };
}

const pending = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let realRaf: typeof globalThis.requestAnimationFrame;
let realCancel: typeof globalThis.cancelAnimationFrame;
let now = 0;

function tick(ms: number) {
  now += ms;
  const due = [...pending.values()];
  pending.clear();
  act(() => { for (const callback of due) callback(now); });
}

const handle = () => (window as unknown as {
  __worldViewport: {
    cameraPosition: () => [number, number, number];
    cameraTarget: () => [number, number, number];
  };
}).__worldViewport;

const pointer = (type: string, init: MouseEventInit) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

function key(type: 'keydown' | 'keyup', code: string, modifiers: KeyboardEventInit = {}): boolean {
  let notCancelled = true;
  act(() => {
    notCancelled = window.dispatchEvent(new KeyboardEvent(type, {
      code, key: code.replace('Key', '').replace('Digit', ''), bubbles: true, cancelable: true, ...modifiers,
    }));
  });
  return notCancelled;
}
const f3 = () => key('keydown', 'F3');
// jsdom's `MouseEvent` has no `movementX`/`movementY` at all — not on the
// prototype, and the init dict's are dropped (`environment-hazards.md`,
// "Jest on Node 24") — so the pointer-lock deltas are put on the event by
// hand.
function look(movementX: number, movementY: number) {
  const event = pointer('mousemove', {});
  Object.defineProperties(event, {
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  act(() => { window.dispatchEvent(event); });
}
function rightDown(host: HTMLElement) {
  act(() => { host.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: 200, clientY: 200 })); });
}
function rightUp() {
  act(() => { window.dispatchEvent(pointer('pointerup', { button: 2, clientX: 200, clientY: 200 })); });
}
async function click(canvas: HTMLElement) {
  await act(async () => {
    canvas.dispatchEvent(pointer('click', { button: 0, clientX: 200, clientY: 200 }));
    await Promise.resolve();
  });
}

// The Pointer Lock API, which jsdom has none of. The browser grants a lock
// asynchronously and reports it through `pointerlockchange`; these do the
// reporting, and a test decides when the grant happens.
let locked: Element | null = null;
function lockPointer(element: Element) {
  locked = element;
  act(() => { document.dispatchEvent(new Event('pointerlockchange')); });
}
function unlockPointer() {
  locked = null;
  act(() => { document.dispatchEvent(new Event('pointerlockchange')); });
}
const exitPointerLock = jest.fn();
const requestPointerLock = (canvas: HTMLElement) => (
  (canvas as unknown as { requestPointerLock: jest.Mock }).requestPointerLock
);

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Ten 16 ms frames of a held W. */
function walkForward() {
  key('keydown', 'KeyW');
  for (let i = 0; i < 10; i++) tick(16);
  key('keyup', 'KeyW');
}

describe('WorldViewport — walk navigation on F3', () => {
  beforeEach(() => {
    pending.clear();
    nextFrameId = 1;
    now = 0;
    realRaf = globalThis.requestAnimationFrame;
    realCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pending.set(id, callback);
      return id;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => { pending.delete(id); }) as typeof globalThis.cancelAnimationFrame;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    locked = null;
    exitPointerLock.mockClear();
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    Object.defineProperty(document, 'exitPointerLock', { configurable: true, value: exitPointerLock });
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    jest.restoreAllMocks();
  });

  it('F3 asks for the lock and takes W; F3 again releases the lock, re-seats the pivot and gives W back', () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    const canvas = container.querySelector('canvas')!;

    // Before: W is the surface's gizmo-mode key.
    expect(key('keydown', 'KeyW')).toBe(true);
    key('keyup', 'KeyW');

    expect(f3()).toBe(false);
    expect(requestPointerLock(canvas)).toHaveBeenCalledTimes(1);
    lockPointer(canvas);
    expect(key('keydown', 'KeyW')).toBe(false);
    key('keyup', 'KeyW');

    f3();
    expect(exitPointerLock).toHaveBeenCalledTimes(1);
    // Nothing under the crosshair — no mesh — so the pivot sits at the walk's
    // fixed reach ahead of the eye, in ZenGin centimetres.
    expect(distance(handle().cameraPosition(), handle().cameraTarget()))
      .toBeCloseTo(WALK_EXIT_PIVOT_DISTANCE * 100, 3);
    expect(key('keydown', 'KeyW')).toBe(true);
    unmount();
  });

  it('W walks along the view at walking pace, and the mouse turns the view only while walking', () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    const canvas = container.querySelector('canvas')!;

    // A mouse moved before the walk turns nothing: the view still looks down
    // -Z, so the first walk goes that way.
    look(Math.PI / LOOK_RADIANS_PER_PIXEL, 0);
    f3();
    lockPointer(canvas);
    const start = handle().cameraPosition();
    walkForward();
    const forward = handle().cameraPosition();
    // Nine frames' worth: the first frame after F3 only starts the clock.
    expect(start[2] - forward[2]).toBeCloseTo(WALK_SPEED * 9 * 0.016 * 100, 6);
    expect(forward[0]).toBeCloseTo(start[0], 6);

    // Turned about-face mid-walk, the same W goes the other way.
    look(Math.PI / LOOK_RADIANS_PER_PIXEL, 0);
    walkForward();
    const back = handle().cameraPosition();
    expect(back[2] - forward[2]).toBeCloseTo(WALK_SPEED * 10 * 0.016 * 100, 6);
    unmount();
  });

  it('F3 during a fly is a no-op, and the right button during a walk starts no fly', () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    const host = container.querySelector('[data-testid="world-viewport"]') as HTMLElement;
    const canvas = container.querySelector('canvas')!;

    rightDown(host);
    f3();
    expect(requestPointerLock(canvas)).not.toHaveBeenCalled();
    rightUp();

    f3();
    lockPointer(canvas);
    const start = handle().cameraPosition();
    rightDown(host);
    // A fly begun here would cover the pivot distance — a hundred metres —
    // in a second; a walk covers under sixty centimetres in these frames
    // (nine of them: the first after F3 only starts the clock).
    walkForward();
    rightUp();
    expect(start[2] - handle().cameraPosition()[2]).toBeCloseTo(WALK_SPEED * 9 * 0.016 * 100, 6);
    unmount();
  });

  it('losing the lock ends the walk cleanly, and F3 begins another', () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    const canvas = container.querySelector('canvas')!;

    f3();
    lockPointer(canvas);
    unlockPointer();
    // Ended by the browser, not by us: nothing to release.
    expect(exitPointerLock).not.toHaveBeenCalled();
    expect(key('keydown', 'KeyW')).toBe(true);
    key('keyup', 'KeyW');

    f3();
    expect(requestPointerLock(canvas)).toHaveBeenCalledTimes(2);
    expect(key('keydown', 'KeyW')).toBe(false);
    key('keyup', 'KeyW');
    unmount();
  });

  it('a click while walking selects nothing; after the walk it picks again', async () => {
    const picks: Array<number | null> = [];
    const { container, unmount } = render(<WorldViewport {...props((vob) => picks.push(vob))} />);
    const canvas = container.querySelector('canvas')!;

    f3();
    lockPointer(canvas);
    await click(canvas);
    expect(picks).toEqual([]);

    f3();
    await click(canvas);
    expect(picks).toEqual([7]);
    unmount();
  });

  it('Home and a camera-slot recall still move the camera mid-walk', () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    const canvas = container.querySelector('canvas')!;

    const stored = handle().cameraPosition();
    key('keydown', 'Digit1', { ctrlKey: true, shiftKey: true });
    f3();
    lockPointer(canvas);
    walkForward();
    expect(distance(stored, handle().cameraPosition())).toBeGreaterThan(1);

    key('keydown', 'Digit1', { ctrlKey: true });
    expect(handle().cameraPosition()).toEqual(stored);
    // Still a walk: the next W walks on from the recalled pose.
    walkForward();
    expect(stored[2] - handle().cameraPosition()[2]).toBeCloseTo(WALK_SPEED * 0.16 * 100, 6);

    const beforeHome = handle().cameraPosition();
    key('keydown', 'Home');
    expect(distance(beforeHome, handle().cameraPosition())).toBeGreaterThan(1);
    unmount();
  });

  it('unmounting mid-walk releases the lock', () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    const canvas = container.querySelector('canvas')!;

    f3();
    lockPointer(canvas);
    unmount();
    expect(exitPointerLock).toHaveBeenCalledTimes(1);
  });
});
