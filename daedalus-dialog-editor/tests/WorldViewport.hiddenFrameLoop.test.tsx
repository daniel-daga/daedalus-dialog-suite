/**
 * A hidden viewport must not draw.
 *
 * The World surface is kept mounted while another view is on screen
 * (`docs/refactoring-targets.md` §8) so its tens of MB of geometry survive a
 * navigate-away. The display toggle that does the keeping says nothing about
 * the frame loop, and a mounted-but-hidden canvas that goes on calling
 * `renderer.render` every frame is a worse defect than the one being fixed —
 * so `paused` has to stop the loop outright, and un-pausing has to start it
 * again.
 *
 * `requestAnimationFrame` is driven by hand here: what the assertion is about
 * is precisely whether a frame is *scheduled*, so a real rAF would only be
 * able to say "it did not draw this tick".
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

const mockDraws = { count: 0 };

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => {
  const mocked = mockWorldViewport.mockThree();
  const Renderer = mocked.WebGLRenderer;
  return {
    ...mocked,
    WebGLRenderer: class extends Renderer {
      render() { mockDraws.count += 1; }
    },
  };
});
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());

import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };
const BBOX = [0, 0, 0, 100, 100, 100];

function visuals(): InstancedPayload {
  return {
    visuals: [],
    stats: {
      visualsSeen: 0,
      visualsResolved: 0,
      vobsPlaced: 0,
      instancedDrawGroups: 0,
      levelCompos: 0,
      unresolvedByType: {},
    },
  };
}

const PAYLOAD = visuals();

function props(paused: boolean) {
  return {
    mesh: MESH,
    visuals: PAYLOAD,
    bbox: BBOX,
    waynet: null,
    showWaynet: false,
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
    paused,
  };
}

// A hand-driven rAF: `tick()` runs exactly the callbacks that are scheduled.
const pending = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let realRaf: typeof globalThis.requestAnimationFrame;
let realCancel: typeof globalThis.cancelAnimationFrame;

function tick() {
  const due = [...pending.values()];
  pending.clear();
  act(() => { for (const callback of due) callback(0); });
}

describe('WorldViewport — the frame loop while hidden', () => {
  beforeEach(() => {
    mockDraws.count = 0;
    pending.clear();
    nextFrameId = 1;
    realRaf = globalThis.requestAnimationFrame;
    realCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pending.set(id, callback);
      return id;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => { pending.delete(id); }) as typeof globalThis.cancelAnimationFrame;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
  });

  it('stops drawing while paused and draws again when it comes back', () => {
    const { rerender, unmount } = render(<WorldViewport {...props(false)} />);

    tick();
    tick();
    const whileVisible = mockDraws.count;
    expect(whileVisible).toBeGreaterThan(0);

    act(() => { rerender(<WorldViewport {...props(true)} />); });

    // Not merely "did not draw this frame": nothing is scheduled at all.
    expect(pending.size).toBe(0);
    tick();
    tick();
    expect(mockDraws.count).toBe(whileVisible);

    act(() => { rerender(<WorldViewport {...props(false)} />); });
    tick();
    expect(mockDraws.count).toBeGreaterThan(whileVisible);

    unmount();
  });

  it('does not start the loop when it mounts paused', () => {
    const { unmount } = render(<WorldViewport {...props(true)} />);

    expect(pending.size).toBe(0);
    tick();
    expect(mockDraws.count).toBe(0);

    unmount();
  });
});
