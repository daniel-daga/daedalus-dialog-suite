/**
 * The World surface's scatter brush, lifted out of `WorldSurface.tsx`
 * (`docs/plans/level-editor-review-2026-09-04.md` §4 — scatter is one of the
 * nine concerns, and the narrowest of the five that were still in the file:
 * it needs `commitOps`, the bounds, the class-prop read and one downward
 * raycast, and nothing else).
 *
 * What the split makes assertable is everything that used to sit behind a
 * mounted viewport: that the ray is cast from a candidate **lifted by the brush
 * radius** rather than from the ground point itself, that a candidate which
 * hits nothing is dropped rather than refusing the stroke, that the palette is
 * pruned the way a duplicate's selection is, that a stroke arriving after the
 * toggle went off commits nothing, and that the cap notice is said only for a
 * stroke the world actually took.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import type { VobIndex, WorldOp } from 'zen-world';
import {
  useScatterBrush,
  SCATTER_DEFAULT_RADIUS,
  SCATTER_LIMIT,
  SCATTER_MIN_RADIUS,
  type ScatterRaycaster,
} from '../src/renderer/components/world/hooks/useScatterBrush';
import { useWorldStore } from '../src/renderer/store/worldStore';
import type { WorldSummary } from '../src/shared/worldTypes';

/** A world of `parents.length` VOBs, each named by its index — the same fixture
 *  shape `useVobClipboard.test.ts` builds, and for the same reason: the reader
 *  the hook walks is built from exactly these columns. */
function vobIndexOf(parents: number[]): VobIndex {
  const count = parents.length;
  const childIndex = new Uint32Array(count);
  const seen = new Map<number, number>();
  parents.forEach((parent, at) => {
    const next = seen.get(parent) ?? 0;
    childIndex[at] = next;
    seen.set(parent, next + 1);
  });

  const positions = new Float32Array(count * 3);
  parents.forEach((_, at) => { positions.set([at * 1000, 0, 0], at * 3); });

  return {
    count,
    parent: Int32Array.from(parents).buffer,
    childIndex: childIndex.buffer,
    positions: positions.buffer,
    rotations: new Float32Array(count * 9).buffer,
    flags: new Uint32Array(count).buffer,
    classes: ['zCVob'], classIndex: new Uint32Array(count).buffer,
    names: parents.map((_, at) => `VOB_${at}`), nameIndex: Uint32Array.from(parents.map((_, at) => at)).buffer,
    visuals: ['TREE.3DS'], visualIndex: new Uint32Array(count).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(count).buffer,
  };
}

function summaryOf(parents: number[]): WorldSummary {
  return {
    worldPath: 'C:/g2/Data/Worlds/NEWWORLD.ZEN',
    bbox: [0, 0, 0, 1, 1, 1],
    vobIndex: vobIndexOf(parents),
    stats: { vobCount: parents.length, materials: 1, worldDrawGroups: 1, worldTriangles: 1 },
    timings: {},
  };
}

/** Two roots; in `NESTED`, VOB 2 is a child of root 0. */
const FLAT = [-1, -1];
const NESTED = [-1, -1, 0];

const boundsOf = jest.fn(() => null);
const lookupClassProps = jest.fn(() => null);
const readClassProps = jest.fn(async () => lookupClassProps);

/** A ground plane at y=0 that every ray finds. */
const hitsGround = jest.fn((origin: readonly number[]) => ({
  point: [origin[0], 0, origin[2]] as [number, number, number],
  normal: [0, 1, 0] as [number, number, number],
}));

function viewportRef(raycastDown: ScatterRaycaster['raycastDown']) {
  const ref = createRef<ScatterRaycaster | null>() as { current: ScatterRaycaster | null };
  ref.current = { raycastDown };
  return ref;
}

function mount(
  commitOps: (ops: WorldOp[]) => Promise<boolean>,
  raycastDown: ScatterRaycaster['raycastDown'] = hitsGround as never,
  viewport = viewportRef(raycastDown),
) {
  return renderHook(() => useScatterBrush({
    commitOps, boundsOf, readClassProps, viewport,
  } as never));
}

/** A brush that is armed, over a selection — the state every stroke below
 *  needs, and the only way to reach it is the toggle the toolbar presses. */
function armed(result: { current: { toggleScatter: () => void } }) {
  act(() => { result.current.toggleScatter(); });
}

/** One sample per `radius/4` of travel counts as a new brush position, so
 *  `count` samples spaced a quarter-radius apart is `count` positions. */
function strokeOf(count: number, radius = SCATTER_DEFAULT_RADIUS): Array<[number, number, number]> {
  const step = radius / 4;
  return Array.from({ length: count }, (_, at) => [at * step, 500, 0] as [number, number, number]);
}

/** Every `AddVob` in a committed batch — the copies the stroke placed. */
function addsIn(calls: unknown[][]): Array<Record<string, unknown>> {
  const [ops] = calls[0] as [Array<Record<string, unknown>>];
  return ops.filter((op) => op.op === 'AddVob');
}

beforeEach(() => {
  jest.clearAllMocks();
  readClassProps.mockResolvedValue(lookupClassProps);
  hitsGround.mockImplementation((origin: readonly number[]) => ({
    point: [origin[0], 0, origin[2]] as [number, number, number],
    normal: [0, 1, 0] as [number, number, number],
  }));
  useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0], editError: null } as never);
});

describe('useScatterBrush — the ring the viewport draws', () => {
  test('off until the toggle is pressed, so there is no ring to draw', () => {
    const { result } = mount(jest.fn(async () => true));
    expect(result.current.scatterOn).toBe(false);
    expect(result.current.scatterBrushRadius).toBeNull();
  });

  test('armed over a selection, the ring is the radius', () => {
    const { result } = mount(jest.fn(async () => true));
    armed(result);
    expect(result.current.scatterBrushRadius).toBe(SCATTER_DEFAULT_RADIUS);
  });

  test('clearing the selection goes inert without turning the tool off', () => {
    const { result } = mount(jest.fn(async () => true));
    armed(result);
    act(() => { useWorldStore.setState({ selection: [] } as never); });
    expect(result.current.scatterBrushRadius).toBeNull();
    expect(result.current.scatterOn).toBe(true);
  });

  test('a radius typed down to zero still draws and paints at the floor', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    act(() => { result.current.setScatterRadius(0); });

    // The field keeps what was typed; only the tool is floored.
    expect(result.current.scatterRadius).toBe(0);
    expect(result.current.scatterBrushRadius).toBe(SCATTER_MIN_RADIUS);

    await act(async () => { await result.current.handleScatterStroke([[0, 500, 0]]); });
    const [origin] = hitsGround.mock.calls[0] as [number[]];
    expect(origin[1]).toBe(500 + SCATTER_MIN_RADIUS);
  });
});

describe('useScatterBrush — when a stroke does nothing', () => {
  test('a stroke that arrives with the tool off commits nothing', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('a stroke arriving after the toggle went off commits nothing', async () => {
    // The guard reads the *current* toggle rather than the one the handler was
    // created under: a stroke is delivered from outside React's render path and
    // can outlive the toggle that allowed it, and what it would commit is 200
    // VOBs the user did not ask for.
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    act(() => { result.current.toggleScatter(); });

    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('with no world open there is nothing to raycast against', async () => {
    useWorldStore.setState({ summary: null, selection: [0] } as never);
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });
    expect(hitsGround).not.toHaveBeenCalled();
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('a viewport torn down under the stroke is not an error', async () => {
    const commitOps = jest.fn(async () => true);
    const gone = { current: null } as { current: ScatterRaycaster | null };
    const { result } = mount(commitOps, hitsGround as never, gone);
    armed(result);
    await expect(
      act(async () => { await result.current.handleScatterStroke(strokeOf(4)); }),
    ).resolves.not.toThrow();
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('an empty selection is a brush with nothing to place', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    act(() => { useWorldStore.setState({ selection: [] } as never); });
    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('an empty stroke places nothing', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke([]); });
    expect(commitOps).not.toHaveBeenCalled();
  });
});

describe('useScatterBrush — where the rays are cast', () => {
  test('each ray starts a brush radius above the candidate, not at it', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(3)); });

    expect(hitsGround.mock.calls.length).toBeGreaterThan(0);
    // The candidate keeps its sample's height (the cursor point is already on a
    // surface, the offset is horizontal), so a candidate that fell uphill of the
    // cursor still finds the ground above it rather than the inside of a slope.
    for (const [origin] of hitsGround.mock.calls as Array<[number[]]>) {
      expect(origin[1]).toBe(500 + SCATTER_DEFAULT_RADIUS);
    }
  });

  test('a candidate that hits nothing is dropped, not refused', async () => {
    const commitOps = jest.fn(async () => true);
    // Every other ray misses — a stroke along a ridge legitimately throws half
    // its tries away.
    let ray = 0;
    const half = jest.fn((origin: readonly number[]) => {
      ray += 1;
      return ray % 2 === 0 ? null : {
        point: [origin[0], 0, origin[2]] as [number, number, number],
        normal: [0, 1, 0] as [number, number, number],
      };
    });
    const { result } = mount(commitOps, half as never);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });

    expect(commitOps).toHaveBeenCalledTimes(1);
    expect(addsIn(commitOps.mock.calls)).toHaveLength(Math.ceil(ray / 2));
  });

  test('a stroke where everything misses commits nothing', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps, jest.fn(() => null) as never);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });
    expect(commitOps).not.toHaveBeenCalled();
    // No class-prop read either: the palette is only read once there is
    // something to place with it.
    expect(readClassProps).not.toHaveBeenCalled();
  });
});

describe('useScatterBrush — the palette', () => {
  test('a child whose parent is also selected is not painted twice', async () => {
    useWorldStore.setState({ summary: summaryOf(NESTED), selection: [0, 2] } as never);
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });

    // VOB 0 carries VOB 2 in its own subtree, so the palette is one member.
    expect(readClassProps).toHaveBeenCalledWith(expect.anything(), [0]);

    // VOB 2 is still copied — as its root's child, which is what a subtree copy
    // is. What the pruning prevents is a *second* copy of it standing on the
    // ground in its own right, so every copy the stroke placed at the top level
    // is a VOB 0.
    const roots = addsIn(commitOps.mock.calls).filter((op) => op.parentPath === null);
    expect(roots.length).toBeGreaterThan(0);
    expect(new Set(roots.map((op) => (op.to as { name: string }).name))).toEqual(new Set(['VOB_0']));
  });

  test('the class props are read for the palette, once per stroke', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(4)); });
    expect(readClassProps).toHaveBeenCalledTimes(1);
  });
});

describe('useScatterBrush — the cap', () => {
  /** More brush positions than the cap can absorb: eight attempts each against
   *  a limit of 200, with spacing set to zero so nothing is thinned. */
  const OVERSHOOT = strokeOf(Math.ceil(SCATTER_LIMIT / 8) + 4);

  test('a stroke over the cap is thinned to it, and says so', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    act(() => { result.current.setScatterSpacing(0); });
    await act(async () => { await result.current.handleScatterStroke(OVERSHOOT); });

    expect(addsIn(commitOps.mock.calls)).toHaveLength(SCATTER_LIMIT);
    expect(useWorldStore.getState().editError).toContain(`capped at ${SCATTER_LIMIT}`);
  });

  test('a stroke inside the cap says nothing', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    armed(result);
    await act(async () => { await result.current.handleScatterStroke(strokeOf(3)); });
    expect(useWorldStore.getState().editError).toBeNull();
  });

  test('a refused stroke keeps its refusal, and is not overwritten by the cap', async () => {
    // A refusal already has the banner; replacing it with the cap notice would
    // swap the reason for a footnote.
    const refuse = jest.fn(async () => false);
    const { result } = mount(refuse);
    armed(result);
    act(() => { result.current.setScatterSpacing(0); });
    await act(async () => { await result.current.handleScatterStroke(OVERSHOOT); });

    expect(refuse).toHaveBeenCalledTimes(1);
    expect(useWorldStore.getState().editError).toBeNull();
  });
});
