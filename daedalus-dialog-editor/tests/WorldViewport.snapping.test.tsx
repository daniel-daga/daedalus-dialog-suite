/**
 * Snapping, end to end through the real gizmo (level-editor.md §14.1 item 1.6).
 *
 * `snapping.test.ts` covers the maths. What this covers is the thing the maths
 * cannot: that the quantisation is applied to the *proxy* — the object the
 * gizmo drives — and therefore reaches the live preview, the commit and
 * `verify-world-edit.js`'s drag harness through one code path, rather than being
 * applied a second time on the way out. So the assertion is on the delta the
 * viewport hands the shell, which is what becomes the op.
 *
 * Only what jsdom genuinely cannot run is faked, via the shared
 * `worldViewportMocks.ts`: the WebGL renderer, the two example controls, the
 * BVH worker and the GPU picker. `WorldScene` and the gizmo wiring are the
 * real ones.
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
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };
const BBOX = [0, 0, 0, 100, 100, 100];

/** VOB 7, drawn, at [10, 20, 30] in ZenGin centimetres. One instance is all the
 *  gizmo needs to have something to sit on. */
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

function props(overrides: Record<string, unknown> = {}) {
  return {
    mesh: MESH,
    visuals: instancedPayload(),
    bbox: BBOX,
    waynet: null,
    showWaynet: false,
    loadTexture: async () => null,
    onPick: () => {},
    selection: [7] as readonly number[],
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
    ...overrides,
  };
}

/** The turn a row-major 3x3 represents, in radians — from the trace, so it is
 *  independent of the axis and of the matrix's sign convention. */
function angleOf(rotation: readonly number[]): number {
  const trace = rotation[0] + rotation[4] + rotation[8];
  return Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
}

describe('WorldViewport — snapping the gizmo', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('hands the shell the raw delta when the grid step is off', () => {
    const deltas: Array<[number, number, number]> = [];
    const { unmount } = render(
      <WorldViewport {...props({ onTranslateSelection: (d: [number, number, number]) => deltas.push(d) })} />,
    );

    act(() => { window.__worldViewport!.dragGizmo([17, 20, 30]); });

    expect(deltas).toEqual([[7, 0, 0]]);
    unmount();
  });

  it('quantises the delta a drag commits to the grid step', () => {
    const deltas: Array<[number, number, number]> = [];
    const { unmount } = render(
      <WorldViewport
        {...props({
          snapGrid: 10,
          onTranslateSelection: (d: [number, number, number]) => deltas.push(d),
        })}
      />,
    );

    // Dragged 7 cm along X and 4 along Y: one step and none.
    act(() => { window.__worldViewport!.dragGizmo([17, 24, 30]); });

    expect(deltas).toEqual([[10, 0, 0]]);
    // And the gizmo itself sits where the snapped VOB does, not where the
    // pointer left it — the preview and the op are the same number.
    expect(window.__worldViewport!.gizmoPosition()).toEqual([20, 20, 30]);
    unmount();
  });

  it('declines to commit a drag the grid step quantises to nothing', () => {
    const deltas: Array<[number, number, number]> = [];
    const { unmount } = render(
      <WorldViewport
        {...props({
          snapGrid: 100,
          onTranslateSelection: (d: [number, number, number]) => deltas.push(d),
        })}
      />,
    );

    act(() => { window.__worldViewport!.dragGizmo([13, 20, 30]); });

    // No op at all: an undo entry that undoes nothing is worse than no snap.
    expect(deltas).toEqual([]);
    unmount();
  });

  it('quantises the turn a drag commits to the angle step', () => {
    const turns: number[][] = [];
    const { unmount } = render(
      <WorldViewport
        {...props({
          gizmoMode: 'rotate' as const,
          snapAngle: Math.PI / 12,
          onRotateSelection: (delta: number[]) => turns.push(delta),
        })}
      />,
    );

    // 0.3 rad about Y is 17.2 degrees — one 15-degree step.
    act(() => { window.__worldViewport!.turnGizmo([0, 1, 0], 0.3); });

    expect(turns).toHaveLength(1);
    expect(angleOf(turns[0])).toBeCloseTo(Math.PI / 12, 5);
    unmount();
  });

  it('leaves the turn alone when the angle step is off', () => {
    const turns: number[][] = [];
    const { unmount } = render(
      <WorldViewport
        {...props({
          gizmoMode: 'rotate' as const,
          onRotateSelection: (delta: number[]) => turns.push(delta),
        })}
      />,
    );

    act(() => { window.__worldViewport!.turnGizmo([0, 1, 0], 0.3); });

    expect(turns).toHaveLength(1);
    expect(angleOf(turns[0])).toBeCloseTo(0.3, 5);
    unmount();
  });
});
