/**
 * Double-click's world-mesh raycast (`WorldViewport.doubleClickPivot.test.tsx`)
 * misses whenever the point under the cursor isn't bare terrain — a building,
 * a tree, a prop, any VOB — which is most of a populated level up close. That
 * silent miss is what read as "double click does not seem to work" (Daniel,
 * 2026-08-31): the pivot stayed wherever it already was, so the orbit that
 * followed swung around "the middle" instead.
 *
 * The fix mirrors `handleClick`'s own two-tier pick: on a terrain-raycast
 * miss, fall back to the same async GPU pick for a VOB under the cursor, and
 * pivot on its position. One-off and deliberate, unlike `pivotUnderCursor`'s
 * every-navigation-press budget (level-editor.md §16.12) — the 14.2 ms a CPU
 * raycast over every InstancedMesh would cost never enters into it, because
 * this is the same GPU readback `handleClick` already pays for a single left
 * click.
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
// VOB 7 is always "under the cursor" — deterministic regardless of where the
// dblclick lands, since the mesh below has no triangles for a real raycast to
// ever land on anyway.
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker(7));

import WorldViewport from '../src/renderer/components/world/WorldViewport';

/** One draw group, so the instanced payload below builds a real
 *  `THREE.InstancedMesh` for `positionOf` to find VOB 7 in — the geometry
 *  itself is never raycast against (`VobPicker` is mocked), only its
 *  presence in `instanceVobIds` matters. */
const GROUP = {
  texture: 'NW_WOOD.TGA',
  color: [255, 255, 255, 255] as [number, number, number, number],
  alphaFunc: 0,
  texAniMapMode: 0,
  texAniFps: 0,
  texAniMapDir: [0, 0] as [number, number],
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
};

/** No groups at all: `world.worldMeshes` stays empty, so the terrain raycast
 *  misses unconditionally — the "double-click over a building, not the
 *  ground" case, without needing a real camera pose or real geometry to
 *  reason about. */
const EMPTY_MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };

/** VOB 7 at [10, 20, 30] — the one `mockVobPicker(7)` always reports. */
function instancedPayload(): InstancedPayload {
  return {
    visuals: [{
      name: 'BARREL.3DS',
      source: 'BARREL.MRM',
      count: 1,
      matrices: new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]).buffer,
      vobIds: new Uint32Array([7]).buffer,
      groups: [GROUP],
      bounds: [0, 0, 0, 0, 0, 0],
    }],
    stats: { visualsSeen: 1, visualsResolved: 1, vobsPlaced: 1, instancedDrawGroups: 1, levelCompos: 0, unresolvedByType: {} },
  };
}

function props() {
  return {
    mesh: EMPTY_MESH,
    visuals: instancedPayload(),
    bbox: EMPTY_MESH.bbox,
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    routines: { sites: [], routinesByNpc: {} },
    spawnTime: null,
    spawnState: null,
    showWaypointNames: false,
    loadTexture: async () => null,
    onPick: () => {},
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

function stubCanvasRect(canvas: HTMLCanvasElement): DOMRect {
  const rect = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };
  canvas.getBoundingClientRect = () => rect as DOMRect;
  return rect as DOMRect;
}

describe('WorldViewport — double-click falls back to a VOB when terrain is missed', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('pivots on the VOB under the cursor rather than leaving the pivot untouched', async () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);

    // The default pivot, before any click — the bbox centre, [50, 50, 50].
    const before = window.__worldViewport!.cameraTarget();
    for (let i = 0; i < 3; i++) expect(before[i]).toBeCloseTo(50, 3);

    const canvas = container.querySelector('canvas')!;
    const rect = stubCanvasRect(canvas);
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      }));
      // The VOB pick is async — let its promise resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Off the bbox centre now — the raycast missed (no triangles), so the
    // only way the pivot moved at all is the VOB fallback. (Not the VOB's
    // exact position: `pivotAt` projects the pick onto the view axis, same
    // as a terrain hit — `WorldViewport.doubleClickPivot.test.tsx` asserts
    // that projection, not a raw position match, for the same reason.)
    const after = window.__worldViewport!.cameraTarget();
    const moved = before.some((value, i) => Math.abs(after[i] - value) > 1);
    expect(moved).toBe(true);

    // The marker sits on the VOB itself — unlike `cameraTarget`, it is not
    // projected onto the view axis, so this is an exact match.
    expect(window.__worldViewport!.pivotMarkerPoint()).toEqual([10, 20, 30]);
    unmount();
  });
});
