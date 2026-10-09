/**
 * The point in front of the camera, through the viewport's handle — where a
 * paste lands (#373). It used to land beside the original along world +X,
 * which from the camera reads as random: off to one side, or behind the view.
 *
 * A real CPU raycast against real triangle geometry, as in
 * `WorldViewport.doubleClickPivot.test.tsx`, whose reasons for the real
 * `three-mesh-bvh` hold here too. The shared orbit stand-in with `aims` keeps
 * the camera pointed at its target, which is all the screen-centre ray needs.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

jest.mock('three-mesh-bvh', () => jest.requireActual('three-mesh-bvh'));
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls({ aims: true }));
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker(-1));

import WorldViewport, { type WorldViewportHandle } from '../src/renderer/components/world/WorldViewport';

type Point = [number, number, number];

/** One huge triangle at y = 0 enclosing the origin, under a bbox whose centre
 *  — the camera's default target — is 2000 cm above it. */
const GROUND: WorldMeshPayload['groups'][number] = {
  texture: 'NW_GROUND.TGA',
  color: [255, 255, 255, 255],
  alphaFunc: 0, texAniMapMode: 0, texAniFps: 0, texAniMapDir: [0, 0],
  envMapping: false, envMappingStrength: 0,
  waveMode: 0, waveSpeed: 0, waveMaxAmplitude: 0, waveGridSize: 0,
  ignoreSun: false, disableLightmap: false,
  materials: 1, vertexCount: 3, triangleCount: 1,
  positions: new Float32Array([-50000, 0, -50000, 50000, 0, -50000, 0, 0, 50000]).buffer,
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]).buffer,
  uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]).buffer,
  indices: new Uint32Array([0, 1, 2]).buffer,
  lights: null,
};
const BBOX: [number, number, number, number, number, number] = [-5000, 0, -5000, 5000, 4000, 5000];

function props(groups: WorldMeshPayload['groups']) {
  const visuals: InstancedPayload = {
    visuals: [],
    decals: mockWorldViewport.noDecals(),
    stats: { visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0, instancedDrawGroups: 0, levelCompos: 0, unresolvedByType: {} },
  };
  return {
    mesh: { groups, bbox: BBOX },
    visuals,
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
  };
}

/** `requestAnimationFrame` is a timer under jsdom. */
const nextFrame = () => new Promise<void>((resolve) => { setTimeout(resolve, 20); });

/** The camera's view ray, from the handle and the test hook: where it is, and
 *  the unit direction it looks along. */
function viewRay(ref: React.RefObject<WorldViewportHandle>) {
  const from = ref.current!.cameraPosition()!;
  const target = window.__worldViewport!.cameraTarget();
  const along = target.map((value, axis) => value - from[axis]);
  const length = Math.hypot(...along);
  return { from, direction: along.map((value) => value / length) as Point };
}

const at = (ray: ReturnType<typeof viewRay>, distance: number): Point =>
  ray.from.map((value, axis) => value + ray.direction[axis] * distance) as Point;

function expectNear(actual: Point | null, expected: Point) {
  expect(actual).not.toBeNull();
  actual!.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 0));
}

describe('WorldViewport — the point in front of the camera', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('is where the view ray meets the world, when that is within reach', async () => {
    const ref = React.createRef<WorldViewportHandle>();
    const { unmount } = render(<WorldViewport ref={ref} {...props([GROUND])} />);
    await act(async () => { await nextFrame(); });

    const ray = viewRay(ref);
    // Looking down at the ground: the ray reaches y = 0 at this distance.
    const toGround = ray.from[1] / -ray.direction[1];
    expectNear(ref.current!.pointAhead(toGround + 1000), at(ray, toGround));
    unmount();
  });

  it('is the ground under the reach when the view ray meets nothing before it', async () => {
    const ref = React.createRef<WorldViewportHandle>();
    const { unmount } = render(<WorldViewport ref={ref} {...props([GROUND])} />);
    await act(async () => { await nextFrame(); });

    // Looking at the horizon would put a paste hundreds of metres off; it
    // stops at the reach and drops to the ground there.
    const ray = viewRay(ref);
    const [x, , z] = at(ray, 2000);
    expectNear(ref.current!.pointAhead(2000), [x, 0, z]);
    unmount();
  });

  it('is the point at the reach itself over nothing at all', async () => {
    const ref = React.createRef<WorldViewportHandle>();
    const { unmount } = render(<WorldViewport ref={ref} {...props([])} />);
    await act(async () => { await nextFrame(); });

    // Still in front of the camera: in the air beats off somewhere unseen.
    expectNear(ref.current!.pointAhead(2000), at(viewRay(ref), 2000));
    unmount();
  });

  it('is null while the scene is being rebuilt', () => {
    const seen: { answer: unknown } = { answer: 'unset' };
    function Parent() {
      const ref = React.useRef<WorldViewportHandle>(null);
      React.useLayoutEffect(() => { seen.answer = ref.current!.pointAhead(2000); }, []);
      return <WorldViewport ref={ref} {...props([GROUND])} />;
    }

    const { unmount } = render(<Parent />);
    expect(seen.answer).toBeNull();
    unmount();
  });
});
