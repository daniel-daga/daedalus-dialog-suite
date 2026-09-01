/**
 * Double-click a point on the world mesh to pivot the orbit there — a
 * deliberate, sticky version of `pivotUnderCursor`'s ambient one (that
 * fires on every navigation *press* and only lasts the drag it started).
 * The camera itself does not move; only `OrbitControls.target` does.
 *
 * Unlike every other `WorldViewport.*.test.tsx`, this one needs a *real*
 * CPU raycast to land on *real* triangle geometry — VOB picking elsewhere
 * is GPU-mocked (`worldViewportMocks.mockVobPicker`) and never has to. It
 * also needs its own `OrbitControls` mock: the shared one's `update()` is
 * an inert stub, and a click at screen-centre only lands on the mesh if the
 * camera is actually oriented toward `target`, the way the real library
 * keeps it. The world mesh is one huge triangle enclosing the origin, so
 * the *exact* default camera pose does not have to be reasoned about —
 * only that the bbox centre (the default pivot, 2000 cm above the mesh on
 * purpose — see MESH's own comment) reads as something other than the
 * post-click hit.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

// Not the shared `mockThreeMeshBvh` — its `acceleratedRaycast` is a bare
// `() => {}`, so `Mesh.prototype.raycast` (patched to it everywhere in this
// app) is a guaranteed no-op for every mesh, always, regardless of geometry
// or camera. Every other suite gets away with that because their picks are
// GPU-mocked and never call it; this spec's whole point is a real one. The
// *real* `acceleratedRaycast` falls back to the ordinary triangle-by-
// triangle `Mesh.raycast` when `geometry.boundsTree` is absent (real
// three-mesh-bvh source), which is exactly the "no BVH built" state
// `mockBvhBuilder` leaves the geometry in — so the real implementation
// needs no BVH to work here.
jest.mock('three-mesh-bvh', () => jest.requireActual('three-mesh-bvh'));
jest.mock('three', () => mockWorldViewport.mockThree());
// Not the shared `mockOrbitControls` — its `update()` is an inert stub, and
// this spec's raycast needs the camera actually pointed at `target` the way
// the real OrbitControls keeps it, or a click at screen-centre lands
// nowhere near the mesh no matter how it is aimed.
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => {
  const three = jest.requireActual('three');
  return {
    OrbitControls: class {
      target = new three.Vector3();
      enabled = true;
      enableDamping = false;
      rotateSpeed = 1;
      mouseButtons: Record<string, unknown> = {};
      constructor(private camera: InstanceType<typeof three.PerspectiveCamera>) {}
      update() { this.camera.lookAt(this.target); return false; }
      dispose() {}
    },
  };
});
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
// No VOB is ever under the cursor — the point of this spec is the mesh
// raycast, not the GPU pick.
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker(-1));

import WorldViewport from '../src/renderer/components/world/WorldViewport';

/** One huge triangle at y = 0, enclosing the origin — (-5000,0,-5000),
 *  (5000,0,-5000), (0,0,5000) in ZenGin centimetres. Large enough that the
 *  default camera's forward ray, whatever its exact pose, lands on it. */
const MESH: WorldMeshPayload = {
  groups: [{
    texture: 'NW_GROUND.TGA',
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
    positions: new Float32Array([-5000, 0, -5000, 5000, 0, -5000, 0, 0, 5000]).buffer,
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]).buffer,
    uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]).buffer,
    indices: new Uint32Array([0, 1, 2]).buffer,
    lights: null,
  }],
  // The bbox's own centre — the *default* pivot, before any click — sits
  // 2000 cm above the mesh on purpose: if it sat at y=0 like the triangle
  // does, the un-clicked default and the post-click hit would both read
  // near y≈0 and the assertions below would pass whether or not the
  // handler ever ran.
  bbox: [-5000, 0, -5000, 5000, 4000, 5000],
};

function emptyVisuals(): InstancedPayload {
  return { visuals: [], stats: { visualsSeen: 0, visualsResolved: 0, vobsPlaced: 0, instancedDrawGroups: 0, levelCompos: 0, unresolvedByType: {} } };
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

/** A macrotask, not a microtask — `requestAnimationFrame` is scheduled like
 *  a timer under jsdom, so a bare `await Promise.resolve()` never lets the
 *  draw loop's first frame (and with it, `controls.update()` orienting the
 *  camera toward `target`) actually run. */
const nextFrame = () => new Promise<void>((resolve) => { setTimeout(resolve, 20); });

/** jsdom does no layout — every element's `getBoundingClientRect()` is all
 *  zeros unless stubbed. `handleDoubleClick`'s own NDC conversion divides by
 *  `rect.width`/`rect.height`, so a real (0,0)/(0,0) here is not "click
 *  outside the canvas", it is `0/0`: a `NaN` ray that cannot hit anything.
 *  Every other `WorldViewport.*.test.tsx` is silent about this because the
 *  mocked `VobPicker.pickAsync` ignores its coordinate arguments outright;
 *  this spec's raycast is the first that is actually real. */
function stubCanvasRect(canvas: HTMLCanvasElement): DOMRect {
  const rect = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };
  canvas.getBoundingClientRect = () => rect as DOMRect;
  return rect as DOMRect;
}

/** Double-click at a fraction of the canvas — (0.5, 0.5) is the centre. */
async function doubleClickAt(
  container: HTMLElement, fx: number, fy: number,
): Promise<void> {
  const canvas = container.querySelector('canvas')!;
  const rect = stubCanvasRect(canvas);
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true,
      clientX: rect.left + rect.width * fx,
      clientY: rect.top + rect.height * fy,
    }));
    await Promise.resolve();
  });
}

const doubleClickCentre = (container: HTMLElement) => doubleClickAt(container, 0.5, 0.5);

describe('WorldViewport — double-click pivots the orbit onto the mesh', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('moves the orbit pivot onto the clicked point, off the default bbox-centre one', async () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    await act(async () => { await nextFrame(); });
    // The default pivot the un-clicked mount starts with — 2000 cm above
    // the mesh, by the fixture's own design (see MESH's bbox comment). If
    // the double-click handler never ran, every assertion below would see
    // this same value.
    expect(window.__worldViewport!.cameraTarget()[1]).toBeCloseTo(2000, 0);

    await doubleClickCentre(container);

    const [x, y, z] = window.__worldViewport!.cameraTarget();
    // On the mesh now, not 2000 cm above it — and within the huge
    // triangle's [-5000, 5000] footprint, so this is the raycast's actual
    // hit, not some unrelated fallback value.
    expect(y).toBeCloseTo(0, 0);
    expect(Math.abs(x)).toBeLessThan(5000);
    expect(Math.abs(z)).toBeLessThan(5000);
    unmount();
  });

  it('does not move the camera itself, only the pivot — unlike the framing keys', async () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    await act(async () => { await nextFrame(); });
    const before = window.__worldViewport!.cameraPosition();

    await doubleClickCentre(container);

    expect(window.__worldViewport!.cameraPosition()).toEqual(before);
    unmount();
  });

  it('pivots on the clicked point itself, not on its view-axis projection', async () => {
    // The complaint this answers (Daniel, 2026-09-01): "it also does not
    // pivot around that point". `pivotAt` puts the pivot at
    // `camera.position + forward * depth` — dead centre on screen at the
    // clicked depth — so a click anywhere but the centre pivots somewhere
    // the user did not click. That projection is right for
    // `pivotUnderCursor`, which must not snap the view mid-drag (§16.12);
    // a deliberate double-click is the case where the snap is the point.
    //
    // Clicked well off centre, so the projection and the hit are far apart:
    // at the centre the two coincide and this could not tell them apart.
    const { container, unmount } = render(<WorldViewport {...props()} />);
    await act(async () => { await nextFrame(); });

    await doubleClickAt(container, 0.3, 0.68);

    const target = window.__worldViewport!.cameraTarget();
    const hit = window.__worldViewport!.pivotMarkerPoint();
    expect(hit).not.toBeNull();
    // The pivot *is* the hit, to the last centimetre — not a point some
    // distance along the view axis from it.
    for (let i = 0; i < 3; i++) expect(target[i]).toBeCloseTo(hit![i], 2);
    unmount();
  });

  it('keeps that pivot through an orbit press, but a dolly press re-centres it', async () => {
    // The second half of the same complaint: setting the pivot is useless if
    // the very next middle-press throws it away, and that press is always
    // the next thing to happen — a double-click is *how you aim* an orbit.
    // `pivotUnderCursor` used to fire for all three navigations, so the
    // pivot never survived the drag it was set for. Dolly and pan keep it,
    // since scaling their step by the distance to what is under the cursor
    // is the only thing they use the pivot for.
    const { container, unmount } = render(<WorldViewport {...props()} />);
    await act(async () => { await nextFrame(); });

    await doubleClickAt(container, 0.3, 0.68);
    const set = window.__worldViewport!.cameraTarget();

    const canvas = container.querySelector('canvas')!;
    const rect = stubCanvasRect(canvas);
    const host = canvas.parentElement!;
    // Low on screen, so the ray meets the ground well short of the pivot the
    // double-click set — a press whose *depth* differs is the only kind a
    // dolly's re-centring can be seen in, since `pivotAt` only ever moves the
    // pivot along the view axis.
    const press = async (init: MouseEventInit) => {
      await act(async () => {
        host.dispatchEvent(new MouseEvent('pointerdown', {
          bubbles: true,
          button: 1,
          clientX: rect.left + rect.width * 0.5,
          clientY: rect.top + rect.height * 0.88,
          ...init,
        }));
        host.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 1 }));
      });
    };

    await press({});
    const afterOrbit = window.__worldViewport!.cameraTarget();
    for (let i = 0; i < 3; i++) expect(afterOrbit[i]).toBeCloseTo(set[i], 2);

    await press({ ctrlKey: true });
    const afterDolly = window.__worldViewport!.cameraTarget();
    expect(set.some((value, i) => Math.abs(afterDolly[i] - value) > 1)).toBe(true);
    unmount();
  });

  it('drops a marker on the hit point, so the click is not invisible', async () => {
    const { container, unmount } = render(<WorldViewport {...props()} />);
    await act(async () => { await nextFrame(); });
    // No marker before the first click.
    expect(window.__worldViewport!.pivotMarkerPoint()).toBeNull();

    await doubleClickCentre(container);

    const point = window.__worldViewport!.pivotMarkerPoint();
    expect(point).not.toBeNull();
    // The literal hit, on the mesh — not the pivot's own view-axis
    // projection (`cameraTarget`, asserted above), so this is a second,
    // independent check that the same click was read.
    expect(point![1]).toBeCloseTo(0, 0);
    expect(Math.abs(point![0])).toBeLessThan(5000);
    expect(Math.abs(point![2])).toBeLessThan(5000);
    unmount();
  });
});
