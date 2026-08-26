// The op model — the first thing in this project that writes (level-editor.md
// §7, Phase 1b).
//
// Everything in Phase 1a is a read-only projection. An op is not, and three
// things about it are load-bearing and silent when wrong:
//
//   - **a VOB has two addresses.** The renderer knows a flat index into the
//     columnar `vobIndex`; `setVobPosition` addresses the native world by an
//     index *path* down the children lists, "0/2". They are different numbers
//     and nothing in either shape says so.
//   - **the path is the `childIndex` chain, not the vob-index chain.** Retail
//     worlds are enumerated depth-first, so on the world you tested the two
//     usually agree — the same trap the scene tree's sibling order already
//     walked into.
//   - **an op carries where it came from as well as where it goes.** That is
//     what makes its inverse pure: undo replays an op, it never reads state
//     back out of the native world or keeps a snapshot beside it.

import {
  applyOps,
  commitOps,
  createVobReader,
  invertOp,
  moveVob,
  translateVobs,
  vobIndexPath,
  type OpBinding,
  type VobIndex,
  type WorldOp,
} from '../src/model';

interface Spec {
  parent?: number;
  childIndex?: number;
  pos?: [number, number, number];
}

/** A VOB table in the columnar shape `vobIndex` emits. */
function vobIndex(vobs: Spec[]): VobIndex {
  const parent = new Int32Array(vobs.length);
  const childIndex = new Uint32Array(vobs.length);
  const positions = new Float32Array(vobs.length * 3);
  const rotations = new Float32Array(vobs.length * 9);

  vobs.forEach((vob, i) => {
    parent[i] = vob.parent ?? -1;
    childIndex[i] = vob.childIndex ?? 0;
    positions.set(vob.pos ?? [i, i * 2, i * 3], i * 3);
    rotations.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
  });

  return {
    count: vobs.length,
    parent: parent.buffer,
    childIndex: childIndex.buffer,
    positions: positions.buffer,
    rotations: rotations.buffer,
    flags: new Uint32Array(vobs.length).buffer,
    classes: ['zCVob'], classIndex: new Uint32Array(vobs.length).buffer,
    names: [''], nameIndex: new Uint32Array(vobs.length).buffer,
    visuals: [''], visualIndex: new Uint32Array(vobs.length).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(vobs.length).buffer,
  };
}

describe('the native address of a VOB', () => {
  it('is the chain of childIndex values from the root down', () => {
    //  vob 0 ── vob 1 (slot 3) ── vob 2 (slot 1)
    const reader = createVobReader(vobIndex([
      { childIndex: 2 },
      { parent: 0, childIndex: 3 },
      { parent: 1, childIndex: 1 },
    ]));

    expect(vobIndexPath(reader, 0)).toBe('2');
    expect(vobIndexPath(reader, 1)).toBe('2/3');
    expect(vobIndexPath(reader, 2)).toBe('2/3/1');
  });

  it('is not the chain of vob indices — they only look alike on a world enumerated in order', () => {
    // Slots and vob indices disagree here, which is what a world with a
    // deleted sibling or a non-depth-first enumeration looks like. Retail
    // worlds mostly hide this: `setVobPosition` would move the wrong VOB, or
    // refuse a slot that does not exist, on the first world that does not.
    const reader = createVobReader(vobIndex([
      { childIndex: 0 },
      { parent: 0, childIndex: 7 },
    ]));

    expect(vobIndexPath(reader, 1)).toBe('0/7');
    expect(vobIndexPath(reader, 1)).not.toBe('0/1');
  });

  it('is nothing for a VOB that is not in the index', () => {
    const reader = createVobReader(vobIndex([{}]));
    expect(vobIndexPath(reader, 1)).toBeNull();
    expect(vobIndexPath(reader, -1)).toBeNull();
  });
});

describe('a move op', () => {
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, pos: [100, 200, 300] },
    { parent: 0, childIndex: 4, pos: [10, 20, 30] },
  ]));

  it('carries both addresses and both positions', () => {
    const op = moveVob(reader(), 1, [11, 22, 33]);

    expect(op).toEqual({
      op: 'MoveVob',
      vob: 1,
      path: '0/4',
      // ZenGin space, centimetres — the coordinates the binding takes. The
      // conversion lives at the render boundary and an op never crosses it.
      from: [10, 20, 30],
      to: [11, 22, 33],
    });
  });

  it('inverts by swapping them, with no state to consult', () => {
    const op = moveVob(reader(), 1, [11, 22, 33]);
    const undo = invertOp(op);

    expect(undo.from).toEqual([11, 22, 33]);
    expect(undo.to).toEqual([10, 20, 30]);
    // Same VOB, same native address: an inverse is an op like any other and
    // goes through the same path.
    expect(undo.vob).toBe(op.vob);
    expect(undo.path).toBe(op.path);
    expect(invertOp(undo)).toEqual(op);
  });

  it('is refused for a VOB that is not in the index', () => {
    expect(() => moveVob(reader(), 9, [1, 2, 3])).toThrow(/9/);
  });
});

describe('a multi-select drag', () => {
  // One gizmo moves a whole selection, so what the drag produces is a *delta*,
  // not a destination: the VOBs keep their spacing, and each op still carries
  // the position of its own VOB. A batch is atomic and is one undo entry, so
  // this is one list, never one call per VOB.
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, pos: [100, 200, 300] },
    { parent: 0, childIndex: 4, pos: [10, 20, 30] },
    { parent: 0, childIndex: 5, pos: [-1, -2, -3] },
  ]));

  it('moves every selected VOB by the same delta, from wherever it is', () => {
    const ops = translateVobs(reader(), [0, 2], [5, 0, -10]);

    expect(ops).toEqual([
      { op: 'MoveVob', vob: 0, path: '0', from: [100, 200, 300], to: [105, 200, 290] },
      { op: 'MoveVob', vob: 2, path: '0/5', from: [-1, -2, -3], to: [4, -2, -13] },
    ]);
  });

  it('inverts as a batch — the whole selection goes back where it came from', () => {
    // Undo replays inverses back to front (`commitOps`), and each op knows its
    // own origin, so a selection that was never uniform to begin with is
    // restored exactly rather than collapsed onto one point.
    const index = vobIndex([
      { childIndex: 0, pos: [100, 200, 300] },
      { parent: 0, childIndex: 4, pos: [10, 20, 30] },
      { parent: 0, childIndex: 5, pos: [-1, -2, -3] },
    ]);
    const live = createVobReader(index);
    const ops = translateVobs(live, [0, 1, 2], [7, 7, 7]);

    applyOps(live, ops);
    applyOps(live, [...ops].reverse().map(invertOp));

    expect(live.position(0)).toEqual([100, 200, 300]);
    expect(live.position(1)).toEqual([10, 20, 30]);
    expect(live.position(2)).toEqual([-1, -2, -3]);
  });

  it('is nothing at all when nothing is selected', () => {
    expect(translateVobs(reader(), [], [1, 2, 3])).toEqual([]);
  });

  it('is refused whole when one of the selected VOBs is not in the index', () => {
    // Not "skip the bad one": a batch that quietly moves four of five VOBs is
    // the half-applied state `commitOps` exists to prevent, arrived at before
    // the binding was ever asked.
    expect(() => translateVobs(reader(), [0, 9], [1, 2, 3])).toThrow(/9/);
  });
});

describe('applying ops to the index', () => {
  // The renderer's projection has to move with the world, or the scene tree,
  // the property grid and the viewport go on showing where a VOB used to be
  // until something reloads 31 MB of payloads.
  it('writes the new position into the positions column', () => {
    const index = vobIndex([{ pos: [1, 2, 3] }, { parent: 0, childIndex: 0, pos: [10, 20, 30] }]);
    const reader = createVobReader(index);

    const touched = applyOps(reader, [moveVob(reader, 1, [40, 50, 60])]);

    expect(touched).toEqual([1]);
    expect(reader.position(1)).toEqual([40, 50, 60]);
    // And nothing else moved.
    expect(reader.position(0)).toEqual([1, 2, 3]);
  });

  it('leaves the index exactly as it was when an op and its inverse are both applied', () => {
    const reader = createVobReader(vobIndex([{ pos: [1, 2, 3] }]));
    const op = moveVob(reader, 0, [7, 8, 9]);

    applyOps(reader, [op]);
    applyOps(reader, [invertOp(op)]);

    expect(reader.position(0)).toEqual([1, 2, 3]);
  });

  it('applies a batch in order, so a multi-select drag is one op list', () => {
    const reader = createVobReader(vobIndex([{ pos: [0, 0, 0] }, { parent: 0, pos: [0, 0, 0] }]));
    const ops: WorldOp[] = [
      moveVob(reader, 0, [1, 1, 1]),
      moveVob(reader, 1, [2, 2, 2]),
      { ...moveVob(reader, 0, [1, 1, 1]), from: [1, 1, 1], to: [3, 3, 3] },
    ];

    expect(applyOps(reader, ops)).toEqual([0, 1, 0]);
    expect(reader.position(0)).toEqual([3, 3, 3]);
    expect(reader.position(1)).toEqual([2, 2, 2]);
  });
});

describe('committing ops to the world', () => {
  /** The one binding call an op needs, recorded. */
  function fakeBinding(refuse?: string) {
    const calls: Array<[string, [number, number, number]]> = [];
    const binding: OpBinding = {
      setVobPosition: (path, to) => {
        if (path === refuse) throw new Error(`no vob at ${path}`);
        calls.push([path, to]);
      },
    };
    return { binding, calls };
  }

  const at = (path: string, to: [number, number, number]): WorldOp =>
    ({ op: 'MoveVob', vob: 0, path, from: [0, 0, 0], to });

  it('addresses each VOB by its index path, in order', () => {
    const { binding, calls } = fakeBinding();

    commitOps(binding, [at('0/1', [1, 1, 1]), at('0/2', [2, 2, 2])]);

    expect(calls).toEqual([['0/1', [1, 1, 1]], ['0/2', [2, 2, 2]]]);
  });

  it('puts back what it already moved when one op in the batch is refused', () => {
    // A drag of five VOBs that moves three of them and reports a failure has
    // left the world in a state no undo entry describes — the batch was never
    // recorded, so nothing will ever put those three back.
    const { binding, calls } = fakeBinding('0/2');

    expect(() => commitOps(binding, [
      at('0/1', [1, 1, 1]),
      at('0/2', [2, 2, 2]),
      at('0/3', [3, 3, 3]),
    ])).toThrow('no vob at 0/2');

    expect(calls).toEqual([
      ['0/1', [1, 1, 1]],
      // back where it came from, and the ops after the failure never ran
      ['0/1', [0, 0, 0]],
    ]);
  });

  it('rolls back in reverse order, so two ops on one VOB unwind correctly', () => {
    const { binding, calls } = fakeBinding('9/9');
    const first: WorldOp = { op: 'MoveVob', vob: 0, path: '0/1', from: [0, 0, 0], to: [1, 1, 1] };
    const second: WorldOp = { op: 'MoveVob', vob: 0, path: '0/1', from: [1, 1, 1], to: [2, 2, 2] };

    expect(() => commitOps(binding, [first, second, at('9/9', [9, 9, 9])])).toThrow();

    expect(calls.map(([, to]) => to)).toEqual([
      [1, 1, 1], [2, 2, 2],       // applied
      [1, 1, 1], [0, 0, 0],       // unwound back to front
    ]);
  });
});
