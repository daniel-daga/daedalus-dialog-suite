/**
 * The light preview reaches the scene (#256).
 *
 * The toggle is a view setting like `exposure` and the light it previews is
 * the selected VOB, so two things have to be true of the wiring: the preview
 * is off until the toggle says otherwise, and it follows the *committed*
 * position — a light that was dragged somewhere else lights the room it is in
 * now, not the room it was picked in.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react';
import type { VobExtent } from 'zen-world';
import type { InstancedPayload, WorldMeshPayload, WorldOp } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

const previews: Array<{ vob: number; extent: VobExtent } | null> = [];

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());
jest.mock('../src/renderer/world/WorldScene', () => {
  const actual = jest.requireActual('../src/renderer/world/WorldScene');
  return {
    ...actual,
    WorldScene: class extends actual.WorldScene {
      setLightPreview(selected: { vob: number; extent: VobExtent } | null) {
        previews.push(selected);
        super.setLightPreview(selected);
      }
    },
  };
});

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };

const PAYLOAD: InstancedPayload = {
  visuals: [],
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

const LIGHT: VobExtent = { shape: 'sphere', radius: 500, kind: 'light', color: [255, 0, 0] };

function props(overrides: {
  lightPreview?: boolean;
  selectedExtent?: { vob: number; extent: VobExtent } | null;
  appliedOps?: WorldOp[] | null;
} = {}) {
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
    outlineMode: 'all' as const,
    selectedExtent: null,
    ...overrides,
  };
}

describe('WorldViewport — the selected light previewed', () => {
  beforeEach(() => {
    previews.length = 0;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('previews nothing while the toggle is off, whatever is selected', () => {
    const { unmount } = render(<WorldViewport {...props({ selectedExtent: { vob: 3, extent: LIGHT } })} />);

    expect(previews).toEqual([null]);

    unmount();
  });

  it('previews the selected light once the toggle is on, and stops when it goes off', () => {
    const { rerender, unmount } = render(
      <WorldViewport {...props({ selectedExtent: { vob: 3, extent: LIGHT } })} />,
    );
    previews.length = 0;

    rerender(<WorldViewport {...props({ lightPreview: true, selectedExtent: { vob: 3, extent: LIGHT } })} />);
    expect(previews).toEqual([{ vob: 3, extent: LIGHT }]);

    rerender(<WorldViewport {...props({ lightPreview: true, selectedExtent: null })} />);
    expect(previews[previews.length - 1]).toBeNull();

    unmount();
  });

  it('re-applies on a committed edit, so a light that moved lights where it is now', () => {
    const selectedExtent = { vob: 3, extent: LIGHT };
    const { rerender, unmount } = render(
      <WorldViewport {...props({ lightPreview: true, selectedExtent })} />,
    );
    previews.length = 0;

    // The same selection and the same extent — only the world under it moved,
    // which is exactly the case a dependency list without `appliedOps` misses.
    rerender(<WorldViewport {...props({
      lightPreview: true,
      selectedExtent,
      appliedOps: [{ op: 'MoveVob', vob: 3, to: [10, 20, 30] }] as unknown as WorldOp[],
    })}
    />);

    expect(previews).toEqual([selectedExtent]);

    unmount();
  });
});
