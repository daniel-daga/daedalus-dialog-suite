/**
 * Shift+click adds to the selection in the viewport (BOARD "Add multi-select in
 * the world view").
 *
 * Ctrl/Cmd already did, and the scene tree already offered both — but the
 * viewport is where a batch is actually built, and Shift is the modifier every
 * level editor puts it on. It is free here for exactly one reason: this app's
 * Blender navigation puts panning on **Shift + middle** (`cameraNav.navFor`),
 * so no left-button gesture is spoken for.
 *
 * The mocks come from `worldViewportMocks.ts`, shared with `.snapping` and
 * `.waynetRebuild` — only what jsdom cannot run. The pick itself is the real
 * `handleClick`, including the order it reads the modifier in.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
// Named `mock*` — that prefix is what lets a `jest.mock()` factory below
// reference it despite jest.mock() being hoisted above other imports.
import * as mockWorldViewport from './worldViewportMocks';

// ── what jsdom cannot run ───────────────────────────────────────────────────
// See worldViewportMocks.ts for what each stand-in provides.

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
/** The one VOB the picker ever reports, so a click is a hit on VOB 7. */
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker(7));

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };

/** VOB 7, drawn, at [10, 20, 30] in ZenGin centimetres. */
function instancedPayload(): InstancedPayload {
  return {
    visuals: [{
      name: 'BARREL.3DS',
      source: 'BARREL.MRM',
      count: 1,
      matrices: new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]).buffer,
      vobIds: new Uint32Array([7]).buffer,
      groups: [{
        texture: 'NW_WOOD.TGA',
        color: [255, 255, 255, 255],
        alphaFunc: 0,
        texAniMapMode: 0,
        texAniFps: 0,
        texAniMapDir: [0, 0],
        envMapping: false,
        envMappingStrength: 0,
        waveMode: 0,
        waveSpeed: 0,
        waveMaxAmplitude: 0,
        waveGridSize: 0,
        ignoreSun: false,
        disableLightmap: false,
        materials: 1,
        vertexCount: 3,
        triangleCount: 1,
        positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]).buffer,
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
        indices: new Uint32Array([0, 1, 2]).buffer,
        lights: null,
      }],
      bounds: [0, 0, 0, 100, 100, 0],
    }],
    stats: {
      visualsSeen: 1,
      visualsResolved: 1,
      vobsPlaced: 1,
      instancedDrawGroups: 1,
      levelCompos: 0,
      unresolvedByType: {},
    },
  };
}

type Pick = [number | null, [number, number, number] | null, boolean];

function props(onPick: (...args: Pick) => void) {
  return {
    mesh: MESH,
    visuals: instancedPayload(),
    bbox: [0, 0, 0, 100, 100, 100],
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    loadTexture: async () => null,
    onPick,
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

/** The pick is awaited inside the handler, so the assertion has to be too. */
async function clickCanvas(
  container: HTMLElement, modifiers: MouseEventInit,
): Promise<void> {
  const canvas = container.querySelector('canvas')!;
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }));
    await Promise.resolve();
  });
}

describe('WorldViewport — building a selection with the mouse', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it.each([
    ['Shift', { shiftKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])('adds the picked VOB to the selection on a %s click', async (_name, modifiers) => {
    const picks: Pick[] = [];
    const { container, unmount } = render(
      <WorldViewport {...props((...pick: Pick) => picks.push(pick))} />,
    );

    await clickCanvas(container, modifiers);

    expect(picks).toEqual([[7, null, true]]);
    unmount();
  });

  it('replaces the selection on a plain click', async () => {
    const picks: Pick[] = [];
    const { container, unmount } = render(
      <WorldViewport {...props((...pick: Pick) => picks.push(pick))} />,
    );

    await clickCanvas(container, {});

    expect(picks).toEqual([[7, null, false]]);
    unmount();
  });
});
