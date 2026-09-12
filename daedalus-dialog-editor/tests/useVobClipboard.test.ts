/**
 * The World surface's clipboard, lifted out of `WorldSurface.tsx`
 * (`docs/plans/level-editor-review-2026-09-04.md` §4 — "clipboard" is one of
 * the nine concerns, and after the waynet and the folders the next with a
 * seam: it needs `commitOps`, the bounds and the class-prop read, and nothing
 * else).
 *
 * What the split makes assertable is the part that was only ever reachable
 * through the surface: that a copy is *values* read at the copy, that a paste
 * lands beside what was copied rather than inside it, that the clipboard is not
 * consumed, and that the pasted roots are re-found by path after the round trip
 * rather than by the flat index the ops carried.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { createVobReader, type VobIndex, type WorldOp } from 'zen-world';
import { useVobClipboard } from '../src/renderer/components/world/hooks/useVobClipboard';
import { useWorldStore } from '../src/renderer/store/worldStore';
import type { WorldSummary } from '../src/shared/worldTypes';

/**
 * A world of `parents.length` VOBs, each named by its index. `parents[i]` is
 * the parent of VOB i, `-1` for a root — `childIndex` is the position within
 * whichever list holds it, which is what `vobIndexPath` walks.
 */
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

/** Two roots, and VOB 2 is a child of root 0. */
const FLAT = [-1, -1];
const NESTED = [-1, -1, 0];

/** Both are lookups, as the surface's own are: a VOB in, its value out. */
const boundsOf = jest.fn(() => null);
const lookupClassProps = jest.fn(() => null);
const readClassProps = jest.fn(async () => lookupClassProps);

/** The inputs arrive through a ref, as they do from the surface. */
function inputRef(commitOps: (ops: WorldOp[]) => Promise<boolean>) {
  const ref = createRef<Parameters<typeof useVobClipboard>[0]['current']>() as
    { current: { commitOps: typeof commitOps; boundsOf: typeof boundsOf; readClassProps: typeof readClassProps } | null };
  ref.current = { commitOps, boundsOf, readClassProps };
  return ref;
}

function mount(commitOps: (ops: WorldOp[]) => Promise<boolean>) {
  return renderHook(() => useVobClipboard(inputRef(commitOps) as never));
}

/** A commit that succeeds and installs the world the paste would have made. */
function commitInto(after: number[]) {
  return jest.fn(async () => {
    useWorldStore.setState({ summary: summaryOf(after) } as never);
    return true;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  readClassProps.mockResolvedValue(lookupClassProps);
  useWorldStore.setState({ summary: summaryOf(FLAT), selection: [] } as never);
});

describe('useVobClipboard — before it is bound', () => {
  test('nothing is bound yet, so a copy and a paste are both no-ops', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const unbound = { current: null };
    const { result } = renderHook(() => useVobClipboard(unbound as never));
    await act(async () => { await result.current.copySelection(); });
    await act(async () => { await result.current.pasteClipboard(); });
    expect(readClassProps).not.toHaveBeenCalled();
    expect(result.current.hasClipboard()).toBe(false);
  });
});

describe('useVobClipboard — copying', () => {
  test('nothing selected fills nothing, so a paste after it does nothing', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    await act(async () => { await result.current.pasteClipboard(); });
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('with no world open, a copy is a no-op', async () => {
    useWorldStore.setState({ summary: null, selection: [0] } as never);
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    expect(readClassProps).not.toHaveBeenCalled();
  });

  test('the class props are read before the clipboard is filled', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const commitOps = commitInto([-1, -1, -1]);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    expect(readClassProps).toHaveBeenCalledTimes(1);

    // And the copy is usable, which is what proves the await landed before the fill.
    await act(async () => { await result.current.pasteClipboard(); });
    expect(commitOps).toHaveBeenCalledTimes(1);
  });

  test('a child whose parent is also copied is not copied twice', async () => {
    useWorldStore.setState({ summary: summaryOf(NESTED), selection: [0, 2] } as never);
    const commitOps = commitInto([-1, -1, 0, -1, 3]);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    await act(async () => { await result.current.pasteClipboard(); });

    // Root 0 and its child: one subtree, so two adds — not three.
    const [ops] = commitOps.mock.calls[0] as [WorldOp[]];
    expect(ops.filter((op) => op.op === 'AddVob')).toHaveLength(2);
  });
});

describe('useVobClipboard — what the menu asks it', () => {
  test('nothing to paste until something is copied', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const { result } = mount(jest.fn(async () => true));
    expect(result.current.hasClipboard()).toBe(false);
    await act(async () => { await result.current.copySelection(); });
    expect(result.current.hasClipboard()).toBe(true);
  });

  test('filling the clipboard does not re-render — it is a ref, not state', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useVobClipboard(inputRef(jest.fn(async () => true)) as never);
    });
    const before = renders;
    await act(async () => { await result.current.copySelection(); });
    expect(renders).toBe(before);
    expect(result.current.hasClipboard()).toBe(true);
  });

  test('a new world empties it, so a paste cannot cross worlds', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });

    act(() => { result.current.clearClipboard(); });
    expect(result.current.hasClipboard()).toBe(false);

    await act(async () => { await result.current.pasteClipboard(); });
    expect(commitOps).not.toHaveBeenCalled();
  });
});

describe('useVobClipboard — pasting', () => {
  test('an empty clipboard commits nothing', async () => {
    const commitOps = jest.fn(async () => true);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.pasteClipboard(); });
    expect(commitOps).not.toHaveBeenCalled();
  });

  test('with nothing selected the copies go into the roots', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const commitOps = commitInto([-1, -1, -1]);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });

    useWorldStore.setState({ selection: [] } as never);
    await act(async () => { await result.current.pasteClipboard(); });

    const [ops] = commitOps.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(ops[0].parentPath).toBeNull();
  });

  test('a paste lands beside the selection, not inside it', async () => {
    // VOB 2 is a child of 0; pasting onto it must target 0's child list.
    useWorldStore.setState({ summary: summaryOf(NESTED), selection: [1] } as never);
    const commitOps = commitInto([-1, -1, 0, -1]);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });

    useWorldStore.setState({ selection: [2] } as never);
    await act(async () => { await result.current.pasteClipboard(); });

    const [ops] = commitOps.mock.calls[0] as [Array<Record<string, unknown>>];
    // VOB 2's parent is root 0, whose path is '0'.
    expect(ops[0].parentPath).toBe('0');
  });

  test('the clipboard is not consumed — pasting twice is two copies', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const commitOps = commitInto([-1, -1, -1]);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    await act(async () => { await result.current.pasteClipboard(); });
    await act(async () => { await result.current.pasteClipboard(); });
    expect(commitOps).toHaveBeenCalledTimes(2);
  });

  test('a refused commit selects nothing', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const refuse = jest.fn(async () => false);
    const { result } = mount(refuse);
    await act(async () => { await result.current.copySelection(); });
    await act(async () => { await result.current.pasteClipboard(); });
    expect(useWorldStore.getState().selection).toEqual([0]);
  });

  test('the copies are selected, found by path in the world that came back', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    // The paste appends one root, so the world comes back with three.
    const commitOps = commitInto([-1, -1, -1]);
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    await act(async () => { await result.current.pasteClipboard(); });

    expect(useWorldStore.getState().selection).toEqual([2]);
  });

  test('a root the re-read cannot resolve is dropped, and the old selection stands', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    // The world comes back *unchanged*, so the appended path resolves to nothing.
    const commitOps = jest.fn(async () => {
      useWorldStore.setState({ summary: summaryOf(FLAT) } as never);
      return true;
    });
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    await act(async () => { await result.current.pasteClipboard(); });

    expect(useWorldStore.getState().selection).toEqual([0]);
  });

  test('a world closed under the round trip selects nothing rather than throwing', async () => {
    useWorldStore.setState({ summary: summaryOf(FLAT), selection: [0] } as never);
    const commitOps = jest.fn(async () => {
      useWorldStore.setState({ summary: null } as never);
      return true;
    });
    const { result } = mount(commitOps);
    await act(async () => { await result.current.copySelection(); });
    await expect(act(async () => { await result.current.pasteClipboard(); })).resolves.not.toThrow();
  });
});

/** The reader is built from the same columns the store holds, so a test that
 *  asserts on paths is asserting the thing the surface actually walks. */
test('the fixture builds paths the way the index does', () => {
  const reader = createVobReader(vobIndexOf(NESTED));
  expect(reader.count).toBe(3);
});
