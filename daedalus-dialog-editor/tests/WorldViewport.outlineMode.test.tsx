/**
 * The outline mode reaches the pass (#229).
 *
 * `VobOutline` is built inside the viewport's one big effect, so the mode
 * cannot be a constructor argument the way the background is — it arrives as a
 * prop, and a prop change must reach the live pass without rebuilding the
 * scene, exactly as `exposure` does. The two things that can go wrong are the
 * mode never being applied at all and it being applied only on mount; both are
 * a `setMode` call this spec counts.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import type { OutlineMode } from '../src/renderer/world/VobOutline';
import * as mockWorldViewport from './worldViewportMocks';

const mockModes: { applied: string[]; tints: boolean[] } = { applied: [], tints: [] };

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());
jest.mock('../src/renderer/world/VobOutline', () => {
  const actual = jest.requireActual('../src/renderer/world/VobOutline');
  return {
    ...actual,
    VobOutline: class extends actual.VobOutline {
      setMode(mode: string) {
        mockModes.applied.push(mode);
        super.setMode(mode);
      }
    },
  };
});

jest.mock('../src/renderer/world/WorldScene', () => {
  const actual = jest.requireActual('../src/renderer/world/WorldScene');
  return {
    ...actual,
    WorldScene: class extends actual.WorldScene {
      setSelectionTint(on: boolean) {
        mockModes.tints.push(on);
        super.setSelectionTint(on);
      }
    },
  };
});

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };

const PAYLOAD: InstancedPayload = {
  visuals: [],
  // Nothing about a decal here; `DecalLayer.test.ts` is where one is drawn.
  decals: mockWorldViewport.noDecals(),
  stats: {
    visualsSeen: 0,
    visualsResolved: 0,
    vobsPlaced: 0,
    instancedDrawGroups: 0,
    levelCompos: 0,
    unresolvedByType: {},
  },
};

function props(outlineMode: OutlineMode) {
  return {
    mesh: MESH,
    visuals: PAYLOAD,
    vobIndex: mockWorldViewport.noVobMarkers(),
    bbox: [0, 0, 0, 100, 100, 100],
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
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
    paused: false,
    outlineMode,
  };
}

describe('WorldViewport — the outline mode', () => {
  beforeEach(() => {
    mockModes.applied = [];
    mockModes.tints = [];
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('applies the mode it mounts with, and every change after it', () => {
    const { rerender, unmount } = render(<WorldViewport {...props('all')} />);

    expect(mockModes.applied).toEqual(['all']);

    rerender(<WorldViewport {...props('selected')} />);
    rerender(<WorldViewport {...props('off')} />);

    expect(mockModes.applied).toEqual(['all', 'selected', 'off']);

    unmount();
  });

  it('mounts straight into a non-default mode without a frame of every line', () => {
    // The pass is built with `all` baked into its uniform, so a viewport that
    // opens with the outlines already off has to say so before it draws —
    // otherwise the world flashes a full set of lines on open.
    const { unmount } = render(<WorldViewport {...props('off')} />);

    expect(mockModes.applied).toEqual(['off']);

    unmount();
  });

  it('tints a selected VOB only while no outline carries the selection (#362)', () => {
    const { rerender, unmount } = render(<WorldViewport {...props('all')} />);
    expect(mockModes.tints.at(-1)).toBe(false);

    rerender(<WorldViewport {...props('selected')} />);
    expect(mockModes.tints.at(-1)).toBe(false);

    rerender(<WorldViewport {...props('off')} />);
    expect(mockModes.tints.at(-1)).toBe(true);

    // A new world is a new scene, which starts untinted: the mode is applied
    // to it again rather than left with the old scene.
    const count = mockModes.tints.length;
    rerender(<WorldViewport {...props('off')} mesh={{ ...MESH }} />);
    expect(mockModes.tints.length).toBeGreaterThan(count);
    expect(mockModes.tints.at(-1)).toBe(true);

    unmount();
  });
});
