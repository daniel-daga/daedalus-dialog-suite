/**
 * The camera must stop when the drag stops.
 *
 * `OrbitControls` coasts after the pointer lifts when `enableDamping` is on,
 * and the viewport used to turn it on — reported from outside the repo as the
 * camera "immer bissl weiter" turning after the hand has stopped. Neither
 * Spacer nor Blender coasts, and nothing in the viewport asks for the coast:
 * the frame loop runs unconditionally, so `update()` still has work to do
 * without it.
 *
 * The flag is the assertion because the coast itself lives inside three's own
 * controls, which every viewport spec stands in for — so what this repo can
 * promise is that it never asks for damping in the first place.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

const mockBuilt: { controls: { enableDamping: boolean } | null } = { controls: null };

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => {
  const { OrbitControls } = mockWorldViewport.mockOrbitControls();
  return {
    OrbitControls: class extends OrbitControls {
      constructor(...args: ConstructorParameters<typeof OrbitControls>) {
        super(...args);
        mockBuilt.controls = this;
      }
    },
  };
});
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };
const BBOX = [0, 0, 0, 100, 100, 100];

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

const PROPS = {
  mesh: MESH,
  visuals: PAYLOAD,
  vobIndex: mockWorldViewport.noVobMarkers(),
  bbox: BBOX,
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
};

describe('WorldViewport — orbit damping', () => {
  beforeEach(() => {
    mockBuilt.controls = null;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('never enables damping on the camera controls', () => {
    const { unmount } = render(<WorldViewport {...PROPS} />);

    expect(mockBuilt.controls).not.toBeNull();
    expect(mockBuilt.controls?.enableDamping).toBe(false);

    unmount();
  });
});
