/**
 * The viewport's half of fly navigation (plan §16.26 row 3): a right-mouse
 * hold flies — the drag looks, W while held moves — and the three things a
 * fly must leave coherent: the orbit pivot lands ahead of the camera, the
 * context menu the right button also owns does not open after a fly but still
 * opens after a plain right click, and a held W is not the gizmo-mode W.
 *
 * Mocks as in `.contextMenu.test.tsx`; the frame loop is driven by hand as in
 * `.hiddenFrameLoop.test.tsx`, and `performance.now` is pinned so a frame is
 * a known slice of time.
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

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 10000, 10000, 10000] };
const VISUALS: InstancedPayload = {
  visuals: [],
  stats: {
    visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0,
    instancedDrawGroups: 0, levelCompos: 0, unresolvedByType: {},
  },
};

type ContextMenuHit = [number, { left: number; top: number }];

function props(onVobContextMenu: (...args: ContextMenuHit) => void) {
  return {
    mesh: MESH,
    visuals: VISUALS,
    bbox: [0, 0, 0, 10000, 10000, 10000],
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    loadTexture: async () => null,
    onPick: () => {},
    onVobContextMenu,
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

function rightDown(host: HTMLElement, x: number, y: number) {
  act(() => { host.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: x, clientY: y })); });
}
function move(x: number, y: number) {
  act(() => { window.dispatchEvent(pointer('pointermove', { buttons: 2, clientX: x, clientY: y })); });
}
function rightUp(x: number, y: number) {
  act(() => { window.dispatchEvent(pointer('pointerup', { button: 2, clientX: x, clientY: y })); });
}
function key(type: 'keydown' | 'keyup', code: string): boolean {
  let notCancelled = true;
  act(() => {
    notCancelled = window.dispatchEvent(new KeyboardEvent(type, { code, key: code.replace('Key', '').toLowerCase(), bubbles: true, cancelable: true }));
  });
  return notCancelled;
}
async function contextMenu(canvas: HTMLElement, x: number, y: number) {
  await act(async () => {
    canvas.dispatchEvent(pointer('contextmenu', { button: 2, clientX: x, clientY: y }));
    await Promise.resolve();
  });
}

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('WorldViewport — fly navigation on a right-mouse hold', () => {
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

  it('a right hold with W flies forward, and leaves the pivot ahead of where the camera ended', async () => {
    const hits: ContextMenuHit[] = [];
    const { container, unmount } = render(<WorldViewport {...props((...hit) => hits.push(hit))} />);
    const host = container.querySelector('[data-testid="world-viewport"]') as HTMLElement;
    const canvas = container.querySelector('canvas')!;

    const before = handle().cameraPosition();
    const pivotBefore = handle().cameraTarget();
    const reach = distance(before, pivotBefore);

    rightDown(host, 200, 200);
    // The W the surface reads as "translate mode" is the fly's while flying.
    expect(key('keydown', 'KeyW')).toBe(false);
    for (let i = 0; i < 31; i++) tick(16);
    key('keyup', 'KeyW');
    rightUp(200, 200);

    const after = handle().cameraPosition();
    const pivotAfter = handle().cameraTarget();
    // Flew: half a second at a pivot-distance-per-second pace is a sizeable
    // fraction of that distance.
    expect(distance(before, after)).toBeGreaterThan(reach * 0.3);
    // And the pivot came along — ahead of the camera, at the reach the fly
    // began with, not left behind at the middle of the island.
    expect(distance(after, pivotAfter)).toBeCloseTo(reach, 3);
    expect(distance(pivotBefore, pivotAfter)).toBeGreaterThan(reach * 0.3);

    // A fly is not a right click: the context menu the button also owns
    // stays shut.
    await contextMenu(canvas, 200, 200);
    expect(hits).toEqual([]);

    // And after the hold, W is the surface's again.
    expect(key('keydown', 'KeyW')).toBe(true);
    unmount();
  });

  it('a right drag looks without moving, and a plain right click still opens the menu', async () => {
    const hits: ContextMenuHit[] = [];
    const { container, unmount } = render(<WorldViewport {...props((...hit) => hits.push(hit))} />);
    const host = container.querySelector('[data-testid="world-viewport"]') as HTMLElement;
    const canvas = container.querySelector('canvas')!;

    const before = handle().cameraPosition();
    const pivotBefore = handle().cameraTarget();

    rightDown(host, 200, 200);
    move(260, 200);
    tick(16);
    rightUp(260, 200);
    expect(handle().cameraPosition()).toEqual(before);
    // Turned: the pivot, re-seated on the new view axis, is somewhere else.
    expect(distance(pivotBefore, handle().cameraTarget())).toBeGreaterThan(1);
    await contextMenu(canvas, 260, 200);
    expect(hits).toEqual([]);

    rightDown(host, 100, 100);
    tick(16);
    rightUp(100, 100);
    await contextMenu(canvas, 100, 100);
    expect(hits).toEqual([[7, { left: 100, top: 100 }]]);
    unmount();
  });
});
