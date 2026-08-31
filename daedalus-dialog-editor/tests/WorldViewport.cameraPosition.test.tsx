/**
 * The camera's own position, through the viewport's imperative handle — a
 * query (`docs/refactoring-targets.md` §9's `raycastDown`/`frameVob` shape),
 * not a subscription. What the scene tree's "within reach of the camera"
 * filter reads on demand to build its distance query.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react';
import { threeToZen, zenBoxToThree } from 'zen-world';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());

import WorldViewport, { type WorldViewportHandle } from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 2000, 500, 4000] };

function emptyVisuals(): InstancedPayload {
  return {
    visuals: [],
    stats: {
      visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0, instancedDrawGroups: 0,
      levelCompos: 0, unresolvedByType: {},
    },
  };
}

function props() {
  return {
    mesh: MESH,
    visuals: emptyVisuals(),
    bbox: MESH.bbox,
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
  };
}

describe('WorldViewport — the camera\'s position through the handle', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('answers the camera\'s actual position, converted to ZenGin space', () => {
    const ref = React.createRef<WorldViewportHandle>();
    const testProps = props();
    const { unmount } = render(<WorldViewport ref={ref} {...testProps} />);

    // The documented initial framing (`WorldViewport`'s own "Framed from
    // the payload's own bbox" comment): 0.6/0.35 of the bbox's own span off
    // its centre. Reproduced here from the public `bbox` prop, not read out
    // of the component — the same shape `zenBoxToThree` gives any caller.
    const box = zenBoxToThree(testProps.bbox);
    const span = Math.max(box.size[0], box.size[2]) || 10;
    const expected = threeToZen([
      box.center[0] + span * 0.6, box.center[1] + span * 0.35, box.center[2] + span * 0.6,
    ]);

    expect(ref.current!.cameraPosition()).toEqual(expected);
    unmount();
  });

  it('is a no-op — null — while the scene is being rebuilt', () => {
    // The hazard `frameVob`/`framePoint` already guard against (§9): the
    // handle is alive whenever the component is, but the closure it reads
    // belongs to the scene effect — a parent's layout effect runs before it.
    const seen: { answer: unknown } = { answer: 'unset' };
    function Parent() {
      const ref = React.useRef<WorldViewportHandle>(null);
      React.useLayoutEffect(() => { seen.answer = ref.current!.cameraPosition(); }, []);
      return <WorldViewport ref={ref} {...props()} />;
    }

    const { unmount } = render(<Parent />);

    expect(seen.answer).toBeNull();
    unmount();
  });
});
