/**
 * The viewport's half of the camera slots (plan §16.26 row 3): Ctrl+Shift+N
 * stores the pose, Ctrl+N brings it back — camera *and* orbit pivot, so the
 * next orbit turns about the same point — a text field keeps its digits, and
 * a different world starts with every slot empty.
 *
 * Mocks and the hand-driven frame loop as in `.flyNav.test.tsx`; the camera is
 * moved between store and recall by a fly, which is the one way to move it
 * from a test without a pointer-capture drag.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => ({
  VobPicker: class {
    setInstancedMeshes() {}
    setWorldMeshes() {}
    warm() {}
    pickAsync() { return Promise.resolve(7); }
    dispose() {}
  },
}));

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const VISUALS: InstancedPayload = {
  visuals: [],
  stats: {
    visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0,
    instancedDrawGroups: 0, levelCompos: 0, unresolvedByType: {},
  },
};

function props(bbox: number[]) {
  const mesh: WorldMeshPayload = { groups: [], bbox };
  return {
    mesh,
    visuals: VISUALS,
    bbox,
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    loadTexture: async () => null,
    onPick: () => {},
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

const BBOX = [0, 0, 0, 10000, 10000, 10000];
const OTHER_BBOX = [0, 0, 0, 20000, 20000, 20000];

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

function key(code: string, modifiers: KeyboardEventInit = {}, target: EventTarget = window): boolean {
  let notCancelled = true;
  act(() => {
    notCancelled = target.dispatchEvent(new KeyboardEvent('keydown', {
      code, key: code.replace('Key', '').replace('Digit', ''), bubbles: true, cancelable: true, ...modifiers,
    }));
  });
  return notCancelled;
}

/** Fly forward for half a second, which moves both the camera and the pivot. */
function flySomewhere(host: HTMLElement) {
  act(() => { host.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: 200, clientY: 200 })); });
  key('KeyW');
  for (let i = 0; i < 31; i++) tick(16);
  act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })); });
  act(() => { window.dispatchEvent(pointer('pointerup', { button: 2, clientX: 200, clientY: 200 })); });
}

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('WorldViewport — camera slots', () => {
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
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    jest.restoreAllMocks();
  });

  it('Ctrl+Shift+1 stores the pose and Ctrl+1 brings camera and pivot back to it', () => {
    const { container, unmount } = render(<WorldViewport {...props(BBOX)} />);
    const host = container.querySelector('[data-testid="world-viewport"]') as HTMLElement;

    const stored = handle().cameraPosition();
    const storedPivot = handle().cameraTarget();
    expect(key('Digit1', { ctrlKey: true, shiftKey: true })).toBe(false);

    flySomewhere(host);
    expect(distance(stored, handle().cameraPosition())).toBeGreaterThan(1);

    expect(key('Digit1', { ctrlKey: true })).toBe(false);
    expect(handle().cameraPosition()).toEqual(stored);
    expect(handle().cameraTarget()).toEqual(storedPivot);
    unmount();
  });

  it('an empty slot moves nothing, and a digit typed into a text field is a digit', () => {
    const { container, unmount } = render(<WorldViewport {...props(BBOX)} />);
    const host = container.querySelector('[data-testid="world-viewport"]') as HTMLElement;
    const input = document.createElement('input');
    document.body.appendChild(input);

    // Stored from a text field: nothing is stored.
    expect(key('Digit2', { ctrlKey: true, shiftKey: true }, input)).toBe(true);
    const before = handle().cameraPosition();
    flySomewhere(host);
    const flown = handle().cameraPosition();
    expect(distance(before, flown)).toBeGreaterThan(1);

    // Recalled from the viewport: the slot is empty, so the camera stays.
    key('Digit2', { ctrlKey: true });
    expect(handle().cameraPosition()).toEqual(flown);
    // Stored from the viewport, recalled from a text field: still stays.
    key('Digit2', { ctrlKey: true, shiftKey: true });
    flySomewhere(host);
    const flownAgain = handle().cameraPosition();
    expect(key('Digit2', { ctrlKey: true }, input)).toBe(true);
    expect(handle().cameraPosition()).toEqual(flownAgain);
    // And from the viewport it comes back — the slot was stored, only the
    // text field's recall was ignored.
    key('Digit2', { ctrlKey: true });
    expect(handle().cameraPosition()).toEqual(flown);

    input.remove();
    unmount();
  });

  it('a different world starts with empty slots', () => {
    const { container, rerender, unmount } = render(<WorldViewport {...props(BBOX)} />);
    const host = container.querySelector('[data-testid="world-viewport"]') as HTMLElement;
    key('Digit3', { ctrlKey: true, shiftKey: true });

    rerender(<WorldViewport {...props(OTHER_BBOX)} />);
    const framed = handle().cameraPosition();
    flySomewhere(host);
    const flown = handle().cameraPosition();
    expect(distance(framed, flown)).toBeGreaterThan(1);
    // The old world's slot 3 is gone.
    key('Digit3', { ctrlKey: true });
    expect(handle().cameraPosition()).toEqual(flown);
    // The new world has its own.
    key('Digit3', { ctrlKey: true, shiftKey: true });
    flySomewhere(host);
    expect(handle().cameraPosition()).not.toEqual(flown);
    key('Digit3', { ctrlKey: true });
    expect(handle().cameraPosition()).toEqual(flown);
    unmount();
  });
});
