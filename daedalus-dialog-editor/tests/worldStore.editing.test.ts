/**
 * The renderer's side of an edit (level-editor.md §7, Phase 1b).
 *
 * The authoritative world lives in the main process and the store holds a
 * *projection* of it — the columnar `vobIndex` the worker sent. So an op that
 * has been applied over there has to be applied here too, or the scene tree and
 * the property grid go on showing where a VOB used to be until something
 * reloads 31 MB of payloads.
 *
 * The projection is mutated **in place**, in the `ArrayBuffer` columns the
 * worker sent, which is exactly why this store has no `immer` middleware and
 * why `vobModelOf` caches its reader against the summary object: the readers
 * are views over those buffers and must not be rebuilt on every edit.
 *
 * @jest-environment jsdom
 */

import { addVob, createVobReader, moveVob, type VobIndex, type WorldOp } from 'zen-world';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { vobModelOf } from '../src/renderer/world/vobModel';
import type { WorldSummary } from '../src/shared/worldTypes';

function vobIndex(positions: Array<[number, number, number]>): VobIndex {
  const count = positions.length;
  const columns = new Float32Array(count * 3);
  positions.forEach((position, i) => columns.set(position, i * 3));

  return {
    count,
    parent: new Int32Array(count).fill(-1).buffer,
    childIndex: new Uint32Array(count.valueOf()).map((_, i) => i).buffer,
    positions: columns.buffer,
    rotations: new Float32Array(count * 9).buffer,
    flags: new Uint32Array(count).buffer,
    classes: ['zCVob'], classIndex: new Uint32Array(count).buffer,
    names: [''], nameIndex: new Uint32Array(count).buffer,
    visuals: [''], visualIndex: new Uint32Array(count).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(count).buffer,
  };
}

function summaryWith(positions: Array<[number, number, number]>): WorldSummary {
  return {
    worldPath: 'C:/Gothic/NewWorld.zen',
    bbox: [0, 0, 0, 1, 1, 1],
    vobIndex: vobIndex(positions),
    stats: { vobCount: positions.length, materials: 1, worldDrawGroups: 1, worldTriangles: 1 },
    timings: {},
  };
}

/** A store with a world open, and the op that moves its second VOB. */
function opened() {
  const summary = summaryWith([[0, 0, 0], [10, 20, 30]]);
  useWorldStore.getState().reset();
  useWorldStore.getState().openSucceeded(summary);
  const op = moveVob(vobModelOf(summary).reader, 1, [11, 22, 33]);
  return { summary, op };
}

afterEach(() => { useWorldStore.getState().reset(); });

describe('an edit reaching the renderer', () => {
  it('moves the VOB in the index the panels read', () => {
    const { summary, op } = opened();

    useWorldStore.getState().applyEdit([op]);

    expect(vobModelOf(summary).reader.position(1)).toEqual([11, 22, 33]);
  });

  it('mutates the columns in place, so no reader has to be rebuilt', () => {
    // `vobModelOf` caches the tree and the column views against the summary
    // because a virtualized tree over 23,288 VOBs reads them on every scroll
    // frame. An edit that replaced the index would leave every cached reader
    // pointing at the old buffers.
    const { summary, op } = opened();
    const before = vobModelOf(summary);

    useWorldStore.getState().applyEdit([op]);

    expect(vobModelOf(summary)).toBe(before);
    expect(useWorldStore.getState().summary).toBe(summary);
  });

  it('applies a batch in order — a multi-select drag is one edit', () => {
    const { summary } = opened();
    const reader = vobModelOf(summary).reader;
    const ops: WorldOp[] = [moveVob(reader, 0, [1, 1, 1]), moveVob(reader, 1, [2, 2, 2])];

    useWorldStore.getState().applyEdit(ops);

    expect(reader.position(0)).toEqual([1, 1, 1]);
    expect(reader.position(1)).toEqual([2, 2, 2]);
  });

  it('leaves a structural batch to the refresh instead of applying it', () => {
    // A flat index is a VOB's position in a depth-first traversal, so an added
    // VOB changes how many there are — there is no column to write it into, and
    // `zen-world`'s `applyOps` refuses one by name rather than pretending. The
    // whole batch is left alone rather than partly applied: the caller follows
    // it with `indexRefreshed`, which supersedes anything this could write.
    const { summary } = opened();
    const reader = vobModelOf(summary).reader;
    const ops = [
      moveVob(reader, 0, [5, 5, 5]),
      addVob(reader, { position: [1, 2, 3] }),
    ];

    expect(() => useWorldStore.getState().applyEdit(ops)).not.toThrow();
    // Not half-applied: the move in the same batch is left alone too, because
    // the refresh replaces the whole index anyway.
    expect(reader.position(0)).toEqual([0, 0, 0]);
  });

  it('applies the VOB half of a batch that also moves a waypoint', () => {
    // A waynet op is **not** structural — it changes no enumeration — so the
    // guard above does not catch it, and it has no row in these columns either,
    // so `applyOps` refuses it by name. Partitioned rather than guarded,
    // because by the time the renderer sees a batch the authoritative world has
    // already been committed: throwing here would leave the world one edit
    // ahead of a history that cannot undo it, and drop the VOB move on the
    // floor as well.
    const { summary } = opened();
    const reader = vobModelOf(summary).reader;
    const ops: WorldOp[] = [
      moveVob(reader, 0, [5, 5, 5]),
      { op: 'MoveWaypoint', waypoint: 2, name: 'WP_CITY_01', from: [0, 0, 0], to: [9, 9, 9] },
    ];

    expect(() => useWorldStore.getState().applyEdit(ops)).not.toThrow();

    expect(reader.position(0)).toEqual([5, 5, 5]);
  });

  it('takes a re-read index whole, because its columns are new buffers', () => {
    // `vobModelOf` caches its reader against the summary object. A refreshed
    // index is a different set of `ArrayBuffer`s, so anything still reading the
    // old summary is reading a world that no longer exists — which is why this
    // replaces the summary rather than writing into it.
    const { summary } = opened();
    const grown = summaryWith([[0, 0, 0], [10, 20, 30], [7, 7, 7]]);

    useWorldStore.getState().indexRefreshed(grown);

    expect(useWorldStore.getState().summary).toBe(grown);
    expect(useWorldStore.getState().summary).not.toBe(summary);
    expect(vobModelOf(grown).reader.count).toBe(3);
  });

  it('keeps the selection across a refresh, because an added VOB renumbers nothing', () => {
    // It is appended and takes the index one past the end. An op that renumbered
    // would have to clear the selection — which is one more reason there is no
    // such op yet.
    opened();
    useWorldStore.getState().selectVob(1);

    useWorldStore.getState().indexRefreshed(summaryWith([[0, 0, 0], [10, 20, 30], [7, 7, 7]]));

    expect(useWorldStore.getState().selection).toEqual([1]);
  });

  it('does nothing at all when no world is open', () => {
    // Undo is a keystroke, and a keystroke can arrive between closing one world
    // and opening the next.
    useWorldStore.getState().reset();

    expect(() => useWorldStore.getState().applyEdit([
      { op: 'MoveVob', vob: 0, path: '0', from: [0, 0, 0], to: [1, 2, 3] },
    ])).not.toThrow();
    expect(useWorldStore.getState().summary).toBeNull();
  });

  it('starts a newly opened world with no stale edit error', () => {
    const { op } = opened();
    useWorldStore.getState().applyEdit([op]);
    useWorldStore.getState().editFailed('the worker refused it');

    useWorldStore.getState().openSucceeded(summaryWith([[0, 0, 0]]));

    expect(useWorldStore.getState().editError).toBeNull();
  });

  it('reports a refused edit without tearing the world down', () => {
    // `status: 'error'` is how a failed *open* is reported and it replaces the
    // whole surface with a message. A refused edit must not do that — the world
    // is still open and still correct.
    opened();

    useWorldStore.getState().editFailed('no vob at indexPath');

    expect(useWorldStore.getState().editError).toBe('no vob at indexPath');
    expect(useWorldStore.getState().status).toBe('ready');
    expect(useWorldStore.getState().summary).not.toBeNull();
  });

  it('clears the edit error once an edit succeeds', () => {
    const { op } = opened();
    useWorldStore.getState().editFailed('no vob at indexPath');

    useWorldStore.getState().applyEdit([op]);

    expect(useWorldStore.getState().editError).toBeNull();
  });
});

describe('the selection a batch edit is made from', () => {
  // A batch is one undo entry and `commitOps` is already atomic, so what
  // multi-select adds is the selection itself: an ordered list, not a single
  // index. The order matters — the last VOB added is the one the gizmo sits on.
  it('replaces the selection on a plain select, and empties it on null', () => {
    opened();

    useWorldStore.getState().selectVob(1);
    expect(useWorldStore.getState().selection).toEqual([1]);

    useWorldStore.getState().selectVob(0);
    expect(useWorldStore.getState().selection).toEqual([0]);

    useWorldStore.getState().selectVob(null);
    expect(useWorldStore.getState().selection).toEqual([]);
  });

  it('adds and removes one VOB on a toggle, leaving the rest alone', () => {
    opened();
    useWorldStore.getState().selectVob(0);

    useWorldStore.getState().toggleVob(1);
    expect(useWorldStore.getState().selection).toEqual([0, 1]);

    useWorldStore.getState().toggleVob(0);
    expect(useWorldStore.getState().selection).toEqual([1]);
  });

  it('never holds the same VOB twice', () => {
    // A duplicate would put two ops on one VOB in a batch. They compose, so the
    // world would end up right and the undo entry would be twice the size it
    // should be — a selection is a set, and this is where that is enforced.
    opened();

    useWorldStore.getState().toggleVob(1);
    useWorldStore.getState().toggleVob(1);
    useWorldStore.getState().toggleVob(1);

    expect(useWorldStore.getState().selection).toEqual([1]);
  });

  it('is emptied by opening another world', () => {
    // An index into one world's `vobIndex` addresses a different VOB in the
    // next, exactly as the history does — and the history is emptied for it.
    opened();
    useWorldStore.getState().selectVob(1);

    useWorldStore.getState().openSucceeded(summaryWith([[0, 0, 0]]));

    expect(useWorldStore.getState().selection).toEqual([]);
  });
});

describe('the reader the panels share', () => {
  it('sees the same buffers the store holds — not a copy of them', () => {
    // If `openSucceeded` ever copied the index, every edit would land in one of
    // the two copies and the panels would disagree with the viewport.
    const { summary } = opened();
    const stored = useWorldStore.getState().summary!;

    expect(stored.vobIndex.positions).toBe(summary.vobIndex.positions);
    expect(createVobReader(stored.vobIndex).position(1)).toEqual([10, 20, 30]);
  });
});
