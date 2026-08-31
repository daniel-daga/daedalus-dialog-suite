/**
 * Right-click on a VOB opens the context menu (level-editor.md §17) — the viewport's own half: a `contextmenu` listener beside
 * `handleClick`, reusing the same async GPU pick. VOB hits only; a right-click
 * over terrain or empty sky is reserved and opens nothing.
 *
 * The mocks come from `worldViewportMocks.ts` (see `.multiSelect.test.tsx` for
 * the fuller explanation), except the picker: this file needs the hit VOB to
 * vary between tests, which the shared factory's fixed-at-mock-time value
 * cannot do, so `mockHitVobId` is a local mutable binding each test sets
 * before rendering.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());

/** -1 (`NO_PICK`) until a test says otherwise — read at call time, so it can
 *  change between tests in this file despite `jest.mock`'s factory running
 *  once. */
let mockHitVobId = -1;
jest.mock('../src/renderer/world/VobPicker', () => ({
  VobPicker: class {
    setInstancedMeshes() {}
    setWorldMeshes() {}
    warm() {}
    pickAsync() { return Promise.resolve(mockHitVobId); }
    dispose() {}
  },
}));

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };

function instancedPayload(): InstancedPayload {
  return {
    visuals: [{
      name: 'BARREL.3DS',
      source: 'BARREL.MRM',
      count: 1,
      matrices: new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]).buffer,
      vobIds: new Uint32Array([7]).buffer,
      groups: [],
      bounds: [0, 0, 0, 100, 100, 0],
    }],
    stats: {
      visualsSeen: 1, visualsResolved: 1, vobsPlaced: 1,
      instancedDrawGroups: 1, levelCompos: 0, unresolvedByType: {},
    },
  };
}

type ContextMenuHit = [number, { left: number; top: number }];

function props(onVobContextMenu?: (...args: ContextMenuHit) => void) {
  return {
    mesh: MESH,
    visuals: instancedPayload(),
    bbox: [0, 0, 0, 100, 100, 100],
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

/** The pick is awaited inside the handler, so the assertion has to be too —
 *  and `cancelable` has to be explicit, or jsdom's default answers every
 *  `preventDefault` check with "never mind, nothing was cancelable". */
async function rightClickCanvas(container: HTMLElement): Promise<boolean> {
  const canvas = container.querySelector('canvas')!;
  let notCancelled = true;
  await act(async () => {
    notCancelled = canvas.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 120, clientY: 340,
    }));
    await Promise.resolve();
  });
  return notCancelled;
}

describe('WorldViewport — the context menu\'s own pick', () => {
  beforeEach(() => {
    mockHitVobId = -1;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('reports the hit VOB and the pointer position', async () => {
    mockHitVobId = 7;
    const hits: ContextMenuHit[] = [];
    const { container, unmount } = render(
      <WorldViewport {...props((...hit: ContextMenuHit) => hits.push(hit))} />,
    );

    await rightClickCanvas(container);

    expect(hits).toEqual([[7, { left: 120, top: 340 }]]);
    unmount();
  });

  it('reports nothing on a miss', async () => {
    mockHitVobId = -1;
    const hits: ContextMenuHit[] = [];
    const { container, unmount } = render(
      <WorldViewport {...props((...hit: ContextMenuHit) => hits.push(hit))} />,
    );

    await rightClickCanvas(container);

    expect(hits).toEqual([]);
    unmount();
  });

  it('prevents the browser\'s own menu on a hit and on a miss alike', async () => {
    const hits: ContextMenuHit[] = [];
    const onVobContextMenu = (...hit: ContextMenuHit) => hits.push(hit);

    mockHitVobId = 7;
    const hit = render(<WorldViewport {...props(onVobContextMenu)} />);
    expect(await rightClickCanvas(hit.container)).toBe(false);
    hit.unmount();

    mockHitVobId = -1;
    const miss = render(<WorldViewport {...props(onVobContextMenu)} />);
    expect(await rightClickCanvas(miss.container)).toBe(false);
    miss.unmount();
  });

  it('leaves the browser\'s own menu alone when the surface offers no handler', async () => {
    mockHitVobId = 7;
    const { container, unmount } = render(<WorldViewport {...props(undefined)} />);

    expect(await rightClickCanvas(container)).toBe(true);
    unmount();
  });
});
