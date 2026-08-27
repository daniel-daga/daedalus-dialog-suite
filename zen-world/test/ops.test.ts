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
  addVob,
  applyOps,
  applyWaypointPositions,
  reparentVob,
  commitOps,
  createVobReader,
  deleteVob,
  invertOp,
  isBarrierOp,
  isStructuralOp,
  isWaynetOp,
  moveVob,
  moveWaypoint,
  multiplyRotation,
  placeBounds,
  renumbersPaths,
  rotateVob,
  rotateVobs,
  setVobClassProp,
  setVobProp,
  setVobProps,
  translateVobs,
  vobIndexPath,
  type ClassProps,
  type MoveWaypoint,
  type NewVob,
  type OpBinding,
  type RotateVob,
  type VobFlags,
  type VobIndex,
  type VobProps,
  type VobReader,
  type WorldOp,
  type ZenBounds,
  type ZenRotation,
} from '../src/model';

interface Spec {
  parent?: number;
  childIndex?: number;
  pos?: [number, number, number];
  name?: string;
  visual?: string;
  /** The VOB's class. Defaulted rather than required, because every op before
   *  the class-property one is about the base `zCVob` and reads the class for
   *  nothing — the fixture said so by hardcoding a one-entry dictionary. */
  cls?: string;
  flags?: Partial<VobFlags>;
}

/** The bit layout `vobIndex` packs its flags column in. */
const FLAG_BITS: Array<[keyof VobFlags, number]> = [
  ['showVisual', 0b000001], ['vobStatic', 0b000010], ['ambient', 0b000100],
  ['cdStatic', 0b001000], ['cdDynamic', 0b010000], ['physicsEnabled', 0b100000],
];

/** Interned exactly as the binding interns: one dictionary, indices into it. */
function intern(values: Array<string | undefined>): { dictionary: string[]; index: ArrayBuffer } {
  const dictionary: string[] = [];
  const index = new Uint32Array(values.length);
  values.forEach((value, at) => {
    const key = value ?? '';
    let found = dictionary.indexOf(key);
    if (found === -1) found = dictionary.push(key) - 1;
    index[at] = found;
  });
  if (dictionary.length === 0) dictionary.push('');
  return { dictionary, index: index.buffer };
}

/** A VOB table in the columnar shape `vobIndex` emits. */
function vobIndex(vobs: Spec[]): VobIndex {
  const parent = new Int32Array(vobs.length);
  const childIndex = new Uint32Array(vobs.length);
  const positions = new Float32Array(vobs.length * 3);
  const rotations = new Float32Array(vobs.length * 9);
  const flags = new Uint32Array(vobs.length);

  vobs.forEach((vob, i) => {
    parent[i] = vob.parent ?? -1;
    childIndex[i] = vob.childIndex ?? 0;
    positions.set(vob.pos ?? [i, i * 2, i * 3], i * 3);
    rotations.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
    for (const [flag, bit] of FLAG_BITS) if (vob.flags?.[flag]) flags[i] |= bit;
  });

  const names = intern(vobs.map((vob) => vob.name));
  const visuals = intern(vobs.map((vob) => vob.visual));
  const classes = intern(vobs.map((vob) => vob.cls ?? 'zCVob'));

  return {
    count: vobs.length,
    parent: parent.buffer,
    childIndex: childIndex.buffer,
    positions: positions.buffer,
    rotations: rotations.buffer,
    flags: flags.buffer,
    classes: classes.dictionary, classIndex: classes.index,
    names: names.dictionary, nameIndex: names.index,
    visuals: visuals.dictionary, visualIndex: visuals.index,
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
    // Narrowed for the same reason the line below is: `vob` stopped being a
    // field every op has when the first waynet op arrived.
    expect(undo.op === 'MoveVob' && undo.vob).toBe(op.vob);
    // Narrowed because `invertOp` answers a `WorldOp`, and a reparent addresses
    // a VOB by two slots rather than by one path.
    expect(undo.op === 'MoveVob' && undo.path).toBe(op.path);
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

describe('a rotate op', () => {
  // The second mutation the binding has. Two things separate it from a move:
  //
  //   - the matrix is row-major, which is the order `vobIndex` emits and
  //     `setVobRotation` takes. A transpose is invisible on identity and on
  //     every symmetric matrix, so the fixtures below are deliberately neither.
  //   - it has to re-fit the bounding box, and the box is **recomputed from the
  //     visual**, never re-fitted from the box that is already there. Measured
  //     across the three retail worlds, a VOB's stored box is the tight world
  //     AABB of its own visual placed by its own transform (20,472 of 20,502),
  //     so it is a pure function of (visual, rotation, position) — which is what
  //     lets the op carry both boxes and stay invertible. Re-fitting the stored
  //     box would grow it on every rotation and never shrink back.

  /** A quarter turn about Y, row-major. Asymmetric, so a transpose shows. */
  const QUARTER_Y: ZenRotation = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  /** A visual one unit wide in x, ten in z — so a quarter turn is visible. */
  const BOUNDS: ZenBounds = [-1, 0, -10, 1, 2, 10];

  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, pos: [100, 200, 300] },
    { parent: 0, childIndex: 4, pos: [10, 20, 30] },
  ]));

  it('carries both matrices and both boxes', () => {
    const op = rotateVob(reader(), 1, QUARTER_Y, BOUNDS);

    expect(op.op).toBe('RotateVob');
    expect(op.vob).toBe(1);
    expect(op.path).toBe('0/4');
    expect(op.from).toEqual(IDENTITY);
    expect(op.to).toEqual(QUARTER_Y);
    // Unrotated: the visual's own box, moved to the VOB.
    expect(op.fromBbox).toEqual([9, 20, 20, 11, 22, 40]);
    // A quarter turn about Y swaps the x and z extents — which is exactly what
    // an axis-aligned box cannot do by being translated.
    expect(op.toBbox).toEqual([0, 20, 29, 20, 22, 31]);
  });

  it('fits the box to all eight corners, and reads the matrix row-major', () => {
    // Both of these were sabotages the tests above could not see, and for the
    // same reason: a quarter turn about an axis is a special case. It maps the
    // box's min corner to the min corner, so two corners give the right answer;
    // and with bounds symmetric about the axis it is its own transpose, so a
    // column-major read gives the right answer too. A **45 degree** turn with
    // **asymmetric** bounds is neither.
    const c = Math.SQRT1_2;
    const HALF_QUARTER_Y: ZenRotation = [c, 0, c, 0, 1, 0, -c, 0, c];
    const lopsided: ZenBounds = [-1, 0, 0, 3, 2, 10];

    const box = placeBounds(lopsided, HALF_QUARTER_Y, [0, 0, 0]);

    // x spans corner-to-corner across the diagonal, not min-to-min: the two
    // extremes are (-1, ·, 0) and (3, ·, 10).
    expect(box[0]).toBeCloseTo(-c, 5);
    expect(box[3]).toBeCloseTo(3 * c + 10 * c, 5);
    // z is what the transposed matrix gets wrong — its extremes swap sign.
    expect(box[2]).toBeCloseTo(-3 * c, 5);
    expect(box[5]).toBeCloseTo(10 * c + c, 5);
    expect([box[1], box[4]]).toEqual([0, 2]);
  });

  it('carries no box at all for a VOB whose visual does not resolve', () => {
    // A decal, a .pfx, an unresolved model. A guessed box bounds nothing; the
    // stale one at least bounded the visual in some pose, so it is left alone.
    const op = rotateVob(reader(), 1, QUARTER_Y, null);

    expect(op.fromBbox).toBeNull();
    expect(op.toBbox).toBeNull();
  });

  it('inverts by swapping both pairs, with no state to consult', () => {
    const op = rotateVob(reader(), 1, QUARTER_Y, BOUNDS);
    const undo = invertOp(op) as RotateVob;

    expect(undo.from).toEqual(op.to);
    expect(undo.to).toEqual(op.from);
    // The box is half the op. Swapping only the matrix would undo the rotation
    // and leave the VOB culled by a box fitted to a pose it is no longer in.
    expect(undo.fromBbox).toEqual(op.toBbox);
    expect(undo.toBbox).toEqual(op.fromBbox);
    expect(invertOp(undo)).toEqual(op);
  });

  it('is refused for a VOB that is not in the index', () => {
    expect(() => rotateVob(reader(), 9, QUARTER_Y, BOUNDS)).toThrow(/9/);
  });

  it('reaches the binding as setVobRotation, with the box it carries', () => {
    const calls: unknown[][] = [];
    const binding: OpBinding = {
      setVobPosition: (path, to) => calls.push(['position', path, to]),
      setVobRotation: (path, to, bbox) => calls.push(['rotation', path, to, bbox]),
      setVobProp: (path, props) => calls.push(['props', path, props]),
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };

    commitOps(binding, [rotateVob(reader(), 1, QUARTER_Y, BOUNDS)]);

    expect(calls).toEqual([['rotation', '0/4', QUARTER_Y, [0, 20, 29, 20, 22, 31]]]);
  });

  it('is unwound by its own inverse when a later op in the batch is refused', () => {
    // A mixed batch is still all-or-nothing, and a rotation is unwound by
    // rotating back — not by a move.
    const calls: string[] = [];
    const binding: OpBinding = {
      setVobPosition: (path) => { if (path === '9/9') throw new Error('no vob'); calls.push(`move ${path}`); },
      setVobRotation: (path) => calls.push(`rotate ${path}`),
      setVobProp: (path) => calls.push(`props ${path}`),
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const rotate = rotateVob(reader(), 1, QUARTER_Y, BOUNDS);

    expect(() => commitOps(binding, [
      rotate,
      { op: 'MoveVob', vob: 0, path: '9/9', from: [0, 0, 0], to: [1, 1, 1] },
    ])).toThrow('no vob');

    expect(calls).toEqual(['rotate 0/4', 'rotate 0/4']);
  });

  it('writes the matrix into the index the panels read', () => {
    const index = vobIndex([{ pos: [1, 2, 3] }, { parent: 0, childIndex: 0, pos: [10, 20, 30] }]);
    const live = createVobReader(index);

    applyOps(live, [rotateVob(live, 1, QUARTER_Y, BOUNDS)]);

    expect(live.rotation(1)).toEqual(QUARTER_Y);
    expect(live.rotation(0)).toEqual(IDENTITY);
    // A rotation is not a move: the position column must not be touched.
    expect(live.position(1)).toEqual([10, 20, 30]);
  });
});

describe('a multi-select turn', () => {
  const QUARTER_Y: ZenRotation = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  const QUARTER_X: ZenRotation = [1, 0, 0, 0, 0, -1, 0, 1, 0];
  const BOUNDS: ZenBounds = [-1, 0, -10, 1, 2, 10];

  it('composes the delta onto each VOB\'s own matrix, on the left', () => {
    // A selection of differently-oriented VOBs must all turn the same way on
    // screen. Applying the delta on the right turns each about *its own* axes,
    // which sends them in different directions and looks like a bug in the
    // gizmo rather than in the multiplication order.
    //
    // The delta and the VOB's own matrix are deliberately about **different
    // axes**: two turns about the same axis commute, so a fixture that used one
    // matrix twice would agree with either order — which is exactly how this
    // test passed a sabotage of the multiplication order the first time.
    const index = vobIndex([{ pos: [0, 0, 0] }, { parent: 0, childIndex: 1, pos: [5, 5, 5] }]);
    const rotations = new Float32Array(index.rotations);
    rotations.set(QUARTER_X, 9);       // vob 1 starts a quarter turn about X
    const reader = createVobReader(index);

    const ops = rotateVobs(reader, [0, 1], QUARTER_Y, () => BOUNDS);

    expect(ops[0].to).toEqual(QUARTER_Y);
    expect(ops[1].to).toEqual([0, 1, 0, 0, 0, -1, -1, 0, 0]);        // QUARTER_Y * QUARTER_X
    expect(ops[1].to).not.toEqual([0, 0, 1, 1, 0, 0, 0, 1, 0]);      // QUARTER_X * QUARTER_Y
  });

  it('turns each VOB about its own origin, leaving every position alone', () => {
    const index = vobIndex([{ pos: [0, 0, 0] }, { parent: 0, childIndex: 1, pos: [5, 5, 5] }]);
    const live = createVobReader(index);

    applyOps(live, rotateVobs(live, [0, 1], QUARTER_Y, () => BOUNDS));

    expect(live.position(0)).toEqual([0, 0, 0]);
    expect(live.position(1)).toEqual([5, 5, 5]);
  });

  it('asks for each VOB\'s own bounds, and takes null for an answer', () => {
    const asked: number[] = [];
    const reader = createVobReader(vobIndex([{ pos: [0, 0, 0] }, { parent: 0, pos: [1, 1, 1] }]));

    const ops = rotateVobs(reader, [0, 1], QUARTER_Y, (vob) => {
      asked.push(vob);
      return vob === 0 ? BOUNDS : null;
    });

    expect(asked).toEqual([0, 1]);
    expect(ops[0].toBbox).not.toBeNull();
    expect(ops[1].toBbox).toBeNull();
  });

  it('is nothing at all when nothing is selected', () => {
    const reader = createVobReader(vobIndex([{}]));
    expect(rotateVobs(reader, [], QUARTER_Y, () => null)).toEqual([]);
  });

  it('is refused whole when one of the selected VOBs is not in the index', () => {
    const reader = createVobReader(vobIndex([{}]));
    expect(() => rotateVobs(reader, [0, 9], QUARTER_Y, () => null)).toThrow(/9/);
  });

  it('multiplies row-major matrices in the order it claims', () => {
    // Written out rather than derived: an implementation that transposed both
    // operands would agree with a test that built its expectation the same way.
    const a: ZenRotation = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const b: ZenRotation = [1, 0, 0, 0, 0, 1, 0, 1, 0];   // swaps rows 2 and 3

    expect(multiplyRotation(a, b)).toEqual([1, 3, 2, 4, 6, 5, 7, 9, 8]);
    expect(multiplyRotation(b, a)).toEqual([1, 2, 3, 7, 8, 9, 4, 5, 6]);
  });
});

describe('a property op', () => {
  // The third op, and the first whose fields are all invisible in the viewport.
  // A move that goes wrong is on screen; a flag that goes wrong is not, which is
  // why `from` has to carry exactly the keys `to` does — an inverse that
  // restored a key the op never set, or dropped one it did, looks identical
  // until someone undoes.
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, name: 'ROOT' },
    {
      parent: 0, childIndex: 4, pos: [10, 20, 30],
      name: 'BARREL_01', visual: 'BARREL.3DS',
      flags: { showVisual: true, cdStatic: true },
    },
  ]));

  it('carries both addresses, and a `from` with exactly the keys `to` has', () => {
    const op = setVobProp(reader(), 1, { name: 'BARREL_02', cdStatic: false });

    expect(op).toEqual({
      op: 'SetVobProp',
      vob: 1,
      path: '0/4',
      from: { name: 'BARREL_01', cdStatic: true },
      to: { name: 'BARREL_02', cdStatic: false },
      fromBbox: null,
      toBbox: null,
    });
    // Not "every property the VOB has": an inverse that also restored
    // showVisual would undo edits this op never made.
    expect(Object.keys(op.from)).toEqual(Object.keys(op.to));
  });

  it('reads `from` out of the index, so the inverse needs no snapshot', () => {
    const op = setVobProp(reader(), 1, { showVisual: false, visual: 'CRATE.3DS' });

    expect(op.from).toEqual({ showVisual: true, visual: 'BARREL.3DS' });
    expect(invertOp(op)).toEqual({ ...op, from: op.to, to: op.from });
  });

  it('is refused when it would set nothing', () => {
    // Fifty VOBs selected and a dialog dismissed unchanged is fifty ops on the
    // undo stack for a batch that undoes nothing — the same rule the gizmo has.
    expect(() => setVobProp(reader(), 1, {})).toThrow(/at least one/);
  });

  it('is refused for a VOB that is not in the index', () => {
    expect(() => setVobProp(reader(), 9, { name: 'X' })).toThrow(/9/);
  });

  describe('and the box, which only a visual swap can change', () => {
    const OLD: ZenBounds = [-1, -1, -1, 1, 1, 1];
    const NEW: ZenBounds = [-10, 0, -2, 10, 4, 2];

    it('places each visual\'s own bounds by the VOB\'s own transform', () => {
      const live = reader();
      const op = setVobProp(live, 1, { visual: 'CRATE.3DS' }, { from: OLD, to: NEW });

      expect(op.fromBbox).toEqual(placeBounds(OLD, [1, 0, 0, 0, 1, 0, 0, 0, 1], [10, 20, 30]));
      expect(op.toBbox).toEqual(placeBounds(NEW, [1, 0, 0, 0, 1, 0, 0, 0, 1], [10, 20, 30]));
      // Two different visuals cannot share a box, which is the whole reason the
      // caller passes both rather than one.
      expect(op.fromBbox).not.toEqual(op.toBbox);
    });

    it('leaves both boxes null when a visual does not resolve', () => {
      const op = setVobProp(reader(), 1, { visual: 'MISSING.3DS' }, { from: OLD, to: null });

      expect(op.toBbox).toBeNull();
      // The stale box at least bounded the visual in some pose; a box fitted to
      // the visual that is being replaced bounds the wrong thing entirely.
      expect(op.fromBbox).toBeNull();
    });

    it('refuses bounds for a change that is not a visual swap', () => {
      expect(() => setVobProp(reader(), 1, { name: 'X' }, { from: OLD, to: NEW }))
        .toThrow(/visual/);
    });

    it('swaps both boxes in the inverse, not just the props', () => {
      // Exactly the half-inverse a rotation would have had: the visual goes
      // back and the VOB stays culled by a box fitted to the other one.
      const op = setVobProp(reader(), 1, { visual: 'CRATE.3DS' }, { from: OLD, to: NEW });
      const back = invertOp(op);

      expect(back.op === 'SetVobProp' && back.fromBbox).toEqual(op.toBbox);
      expect(back.op === 'SetVobProp' && back.toBbox).toEqual(op.fromBbox);
    });
  });
});

describe('a multi-select property edit', () => {
  const reader = () => createVobReader(vobIndex([
    { name: 'A', visual: 'A.3DS', flags: { showVisual: true } },
    { parent: 0, childIndex: 1, name: 'B', visual: 'B.3DS', flags: { showVisual: false } },
  ]));

  it('gives every VOB its own `from`, so one undo restores what each one had', () => {
    // The same lesson the drag learned as a delta-not-destination: a batch that
    // shared one `from` would put a selection that was never uniform back as if
    // it had been, and reads correct on a selection of one.
    const ops = setVobProps(reader(), [0, 1], { showVisual: true });

    expect(ops.map((op) => op.from)).toEqual([{ showVisual: true }, { showVisual: false }]);
    expect(ops.map((op) => op.to)).toEqual([{ showVisual: true }, { showVisual: true }]);
  });

  it('asks each VOB for its own current bounds and shares the new visual\'s', () => {
    const asked: number[] = [];
    const NEW: ZenBounds = [-2, -2, -2, 2, 2, 2];

    const ops = setVobProps(reader(), [0, 1], { visual: 'C.3DS' }, {
      from: (vob) => { asked.push(vob); return vob === 0 ? [-1, -1, -1, 1, 1, 1] : null; },
      to: NEW,
    });

    expect(asked).toEqual([0, 1]);
    expect(ops[0].fromBbox).not.toBeNull();
    expect(ops[1].fromBbox).toBeNull();
  });

  it('is nothing at all when nothing is selected', () => {
    expect(setVobProps(reader(), [], { showVisual: true })).toEqual([]);
  });

  it('is refused whole when one of the selected VOBs is not in the index', () => {
    expect(() => setVobProps(reader(), [0, 9], { showVisual: true })).toThrow(/9/);
  });
});

describe('a class-property op', () => {
  // The first op whose fields are not on `zCVob` at all, and the first whose
  // `from` cannot be read out of the index: the columnar payload interns the
  // class *name* and carries nothing else per class, so an `oCItem`'s instance
  // and a `zCVobLight`'s range are simply not in it. That one fact is why this
  // is a separate op with a caller-supplied `from` rather than eight more
  // optional keys on `SetVobProp`.
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, name: 'ROOT' },
    { parent: 0, childIndex: 4, cls: 'oCItem', name: 'ITEM_01', visual: 'ITMW.3DS' },
    { parent: 0, childIndex: 5, cls: 'zCVobLight', name: 'LIGHT_01' },
  ]));

  it('carries the class, both addresses, and a `from` with exactly the keys `to` has', () => {
    const op = setVobClassProp(reader(), 1, { instance: 'ITMW_1H_SWORD_01' }, { instance: 'ITMI_GOLD' });

    expect(op).toEqual({
      op: 'SetVobClassProp',
      vob: 1,
      path: '0/4',
      className: 'oCItem',
      from: { instance: 'ITMW_1H_SWORD_01' },
      to: { instance: 'ITMI_GOLD' },
    });
    expect(Object.keys(op.from)).toEqual(Object.keys(op.to));
  });

  it('takes `from` from the caller and never asks the index for it', () => {
    // The index cannot answer, so an implementation that reached for it would
    // write `undefined` into `from` and read identically on the `to` side — the
    // reader counts the calls instead, the way `createVobReader`'s own test
    // counts column views. `MoveWaypoint` is the precedent for a caller-supplied
    // origin: what is forbidden is reading `from` back out of the *native world*
    // at apply time, not being handed it when the op is made.
    const live = createVobReader(vobIndex([
      { childIndex: 0, cls: 'zCVobLight', name: 'LIGHT_01' },
    ]));
    let reads = 0;
    const counted: VobReader = {
      ...live,
      name: (vob) => { reads += 1; return live.name(vob); },
      visual: (vob) => { reads += 1; return live.visual(vob); },
      flags: (vob) => { reads += 1; return live.flags(vob); },
    };

    const op = setVobClassProp(counted, 0, { range: 1500, color: [255, 200, 100, 255] }, { range: 3000 });

    expect(op.from).toEqual({ range: 1500 });
    expect(op.to).toEqual({ range: 3000 });
    expect(reads).toBe(0);
  });

  it('orders the keys by the catalogue, whatever order the grid emitted them in', () => {
    const op = setVobClassProp(
      reader(), 2,
      { range: 1500, color: [255, 255, 255, 255] },
      { color: [10, 20, 30, 255], range: 3000 },
    );

    expect(Object.keys(op.to)).toEqual(['range', 'color']);
    expect(Object.keys(op.from)).toEqual(['range', 'color']);
  });

  it('refuses a key the VOB\'s class does not have', () => {
    // Refused *here*, in the builder, rather than by the binding halfway down a
    // batch: nothing between `setVobProp`'s first line and its last checks a
    // class, which is exactly what a per-class op cannot afford.
    expect(() => setVobClassProp(reader(), 1, { range: 1500 }, { range: 3000 }))
      .toThrow(/oCItem/);
  });

  it('refuses a key no class has, and a VOB of a class the catalogue does not know', () => {
    expect(() => setVobClassProp(reader(), 1, { hitpoints: 40 }, { hitpoints: 50 }))
      .toThrow(/hitpoints/);
    // ROOT is a plain `zCVob`: it has no class section at all, so every key is
    // a key its class does not have.
    expect(() => setVobClassProp(reader(), 0, { instance: 'A' }, { instance: 'B' }))
      .toThrow(/zCVob/);
  });

  it('refuses a `to` key that `current` has no value for', () => {
    // A one-sided op is an inverse that writes `undefined` into the world. The
    // same-keys-on-both-sides invariant is checked again at the IPC boundary,
    // and this is where it is first knowable.
    expect(() => setVobClassProp(reader(), 2, { color: [255, 255, 255, 255] }, { range: 3000 }))
      .toThrow(/range/);
  });

  it('is refused when it would set nothing, and for a VOB that is not in the index', () => {
    expect(() => setVobClassProp(reader(), 1, { instance: 'A' }, {})).toThrow(/at least one/);
    expect(() => setVobClassProp(reader(), 9, { instance: 'A' }, { instance: 'B' })).toThrow(/9/);
  });

  it('inverts by swapping the two sides, carrying the class through unchanged', () => {
    // The class is directionally symmetric — undoing an edit to an `oCItem`
    // still addresses an `oCItem` — so it needs no swap of its own, and the
    // round trip is what says the branch did not invent one.
    const op = setVobClassProp(reader(), 2, { range: 1500 }, { range: 3000 });
    const back = invertOp(op);

    expect(back).toEqual({ ...op, from: op.to, to: op.from });
    expect(back.op === 'SetVobClassProp' && back.className).toBe('zCVobLight');
    expect(invertOp(back)).toEqual(op);
  });

  it('reaches the binding as setVobClassProp, in whichever direction it is written', () => {
    const calls: Array<[string, ClassProps]> = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a base property change'); },
      setVobClassProp: (path, props) => { calls.push([path, props]); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const op = setVobClassProp(reader(), 1, { instance: 'ITMW_1H_SWORD_01' }, { instance: 'ITMI_GOLD' });

    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual([
      ['0/4', { instance: 'ITMI_GOLD' }],
      ['0/4', { instance: 'ITMW_1H_SWORD_01' }],
    ]);
  });

  it('is unwound in the `from` direction when a later op in the batch is refused', () => {
    // The half `invertOp` does not give: `commitOps` replays the applied ops
    // backwards through `writeOp`'s *other* direction, so a branch that only
    // ever read `op.to` would leave the edited field standing after a refusal.
    const calls: Array<[string, ClassProps]> = [];
    const binding: OpBinding = {
      setVobPosition: (path) => { if (path === '9/9') throw new Error('no vob'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a base property change'); },
      setVobClassProp: (path, props) => { calls.push([path, props]); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };

    expect(() => commitOps(binding, [
      setVobClassProp(reader(), 2, { range: 1500 }, { range: 3000 }),
      { op: 'MoveVob', vob: 0, path: '9/9', from: [0, 0, 0], to: [1, 1, 1] },
    ])).toThrow('no vob');

    expect(calls).toEqual([['0/5', { range: 3000 }], ['0/5', { range: 1500 }]]);
  });

  it('is none of the four things a batch partitions on', () => {
    // It writes one VOB in place, so it shares a batch with a move exactly as a
    // base property edit does — and it has an inverse, so the history keeps it.
    const op = setVobClassProp(reader(), 1, { instance: 'A' }, { instance: 'B' });

    expect(isStructuralOp(op)).toBe(false);
    expect(isWaynetOp(op)).toBe(false);
    expect(renumbersPaths(op)).toBe(false);
    expect(isBarrierOp(op)).toBe(false);
  });

  it('touches the VOB in the projection and writes nothing into it', () => {
    // There is no column to write: the index has the class name and not one
    // field of the class. `touched` is still owed, because it is what re-attaches
    // the gizmo and re-renders the panels — and a refusal here would arrive
    // *after* `commitOps` had already changed the authoritative world.
    const live = reader();
    const before = Array.from(live.columns.flags);

    const touched = applyOps(live, [setVobClassProp(live, 1, { instance: 'A' }, { instance: 'B' })]);

    expect(touched).toEqual([1]);
    expect(Array.from(live.columns.flags)).toEqual(before);
    expect(live.name(1)).toBe('ITEM_01');
    expect(live.visual(1)).toBe('ITMW.3DS');
    expect(live.className(1)).toBe('oCItem');
  });
});

describe('an add op', () => {
  // The first op that changes the *shape* of the world rather than a VOB in it,
  // and the enumeration is what constrains it: a VOB's flat index is its
  // position in a depth-first traversal, so a VOB added anywhere but the very
  // end renumbers every VOB after it — and every op already in the history
  // carries one of those numbers. Appending a root is the one position that
  // shifts nothing.
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, name: 'ROOT_A' },
    { parent: 0, childIndex: 0, name: 'CHILD' },
    { childIndex: 1, name: 'ROOT_B' },
  ]));

  const SPEC: NewVob = { name: 'PLACED', visual: 'CRATE.3DS', position: [10, 20, 30] };

  it('takes the index one past the end and the slot after the last root', () => {
    const op = addVob(reader(), SPEC);

    // Three VOBs, two of them roots: the new one is enumerated last, so it gets
    // index 3 — and it is the third root, so its path is '2'.
    expect(op).toEqual({
      op: 'AddVob', vob: 3, path: '2', parentPath: null, from: null, to: SPEC,
    });
  });

  it('carries a null `from`, because the VOB is not there yet', () => {
    // Which is what makes the inverse a delete rather than a special case:
    // `invertOp` swaps the two sides like it does for every other op.
    const op = addVob(reader(), SPEC);
    const back = invertOp(op);

    expect(back).toEqual({
      op: 'AddVob', vob: 3, path: '2', parentPath: null, from: SPEC, to: null,
    });
    expect(invertOp(back)).toEqual(op);
  });

  it('lands after a parent’s last child, and is enumerated after its subtree', () => {
    // ROOT_A holds one child, so the new VOB is its second — path '0/1'. It is
    // enumerated depth-first, so it comes after ROOT_A's whole subtree and
    // before ROOT_B: index 2, which is the index ROOT_B had.
    const op = addVob(reader(), SPEC, 0);

    expect(op).toEqual({
      op: 'AddVob', vob: 2, path: '0/1', parentPath: '0', from: null, to: SPEC,
    });
  });

  it('is refused for a parent that is not in the index', () => {
    expect(() => addVob(reader(), SPEC, 9)).toThrow(/9/);
  });

  it('is enumerated after a *whole* subtree, not merely after the parent', () => {
    // The branch the fixture above never reaches: with only children, the walk
    // past the subtree never has to climb more than one link, and an index that
    // stopped at the first non-child would be indistinguishable. A grandchild is
    // the shape that tells them apart.
    //
    //  vob 0 ── vob 1 ── vob 2 (grandchild)
    //  vob 3 (root 1)
    const deep = createVobReader(vobIndex([
      { childIndex: 0 },
      { parent: 0, childIndex: 0 },
      { parent: 1, childIndex: 0 },
      { childIndex: 1 },
    ]));

    // Appended under vob 0 it is enumerated after vob 2, not after vob 1.
    expect(addVob(deep, SPEC, 0).vob).toBe(3);
    // And under vob 1 it comes after its only child.
    expect(addVob(deep, SPEC, 1)).toMatchObject({ vob: 3, path: '0/0/1', parentPath: '0/0' });
    // A leaf's new child is enumerated immediately after it.
    expect(addVob(deep, SPEC, 2)).toMatchObject({ vob: 3, path: '0/0/0/0' });
    // And the last root's, at the very end.
    expect(addVob(deep, SPEC, 3)).toMatchObject({ vob: 4, path: '1/0' });
  });

  it('renumbers when it has a parent, and not when it does not', () => {
    // The distinction the batch guard is built on, and the reason the predicate
    // is narrower than `isStructuralOp`: both of these change how many VOBs
    // there are, and only one of them changes what the others are *called*.
    expect(renumbersPaths(addVob(reader(), SPEC, 0))).toBe(true);
    expect(renumbersPaths(addVob(reader(), SPEC))).toBe(false);
    expect(isStructuralOp(addVob(reader(), SPEC, 0))).toBe(true);
  });

  it('has to be alone in its batch when it has a parent, and need not be otherwise', () => {
    const binding: OpBinding = {
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (_spec, parentPath) => (parentPath === null ? '2' : `${parentPath}/1`),
      deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const move: WorldOp = { op: 'MoveVob', vob: 0, path: '0', from: [0, 0, 0], to: [1, 1, 1] };

    expect(() => commitOps(binding, [addVob(reader(), SPEC, 0), move]))
      .toThrow(/only op in its batch/);
    // The other half of the same sentence: an appended root renumbers nothing,
    // so the batches an add already appears in are untouched.
    expect(() => commitOps(binding, [addVob(reader(), SPEC), move])).not.toThrow();
  });

  it('reaches the binding with the parent it was made for', () => {
    const calls: string[] = [];
    const binding: OpBinding = {
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (spec, parentPath) => {
        calls.push(`insert ${spec.name} under ${String(parentPath)}`);
        return '0/1';
      },
      deleteVob: (path) => { calls.push(`delete ${path}`); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const op = addVob(reader(), SPEC, 0);

    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual(['insert PLACED under 0', 'delete 0/1']);
  });

  it('reaches the binding as an insert one way and a delete the other', () => {
    const calls: string[] = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a property change'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (spec) => { calls.push(`insert ${spec.name}`); return '2'; },
      deleteVob: (path) => { calls.push(`delete ${path}`); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const op = addVob(reader(), SPEC);

    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual(['insert PLACED', 'delete 2']);
  });

  it('refuses an insert that did not land where the op says it would', () => {
    // The guard the enumeration needs. If the world has gained or lost a root
    // since the op was made, the VOB lands at a different path — and the op's
    // own inverse would then delete somebody else.
    const binding: OpBinding = {
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '7',
      deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };

    expect(() => commitOps(binding, [addVob(reader(), SPEC)])).toThrow(/7|2/);
  });

  it('is unwound by a delete when a later op in the batch is refused', () => {
    const calls: string[] = [];
    const binding: OpBinding = {
      setVobPosition: (path) => { if (path === '9/9') throw new Error('no vob'); },
      setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { calls.push('insert'); return '2'; },
      deleteVob: (path) => { calls.push(`delete ${path}`); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };

    expect(() => commitOps(binding, [
      addVob(reader(), SPEC),
      { op: 'MoveVob', vob: 0, path: '9/9', from: [0, 0, 0], to: [1, 1, 1] },
    ])).toThrow('no vob');

    expect(calls).toEqual(['insert', 'delete 2']);
  });

  it('cannot be applied to the projection, and says so', () => {
    // Every other op writes into columns that already exist. This one changes
    // how many there are — the typed arrays cannot grow, and every index after
    // it would shift if it could. The caller re-reads the index instead, and
    // being told that is much better than a projection that quietly disagrees
    // with the world.
    const live = reader();
    expect(() => applyOps(live, [addVob(live, SPEC)])).toThrow(/structural|re-read/i);
    expect(isStructuralOp(addVob(live, SPEC))).toBe(true);
    expect(isStructuralOp(moveVob(live, 0, [1, 2, 3]))).toBe(false);
  });
});

describe('a delete op', () => {
  // The op §15 unblocked. The objection was never renumbering, it was
  // invertibility — an `oCMobInter` carries per-class properties, children, an
  // AI and an event manager that no op describes. §15 withdrew it: the original
  // Spacer has no undo at all, so an unundoable delete is already parity. What
  // replaces `invertOp` as the gate is narrower and is the whole of what this op
  // owes — the history has to record it as a **barrier**, and the user has to be
  // told before it lands.
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, name: 'ROOT_A' },
    { parent: 0, childIndex: 0, name: 'CHILD' },
    { childIndex: 1, name: 'ROOT_B' },
  ]));

  const SPEC: NewVob = { name: 'PLACED', visual: 'CRATE.3DS', position: [10, 20, 30] };

  it('carries the flat index and the native path, and nothing else', () => {
    // Deliberately *not* an `AddVob` with a null `to`. That shape means "the op
    // describes this VOB completely", which is exactly what is not true of a
    // retail one — and it is what lets `invertOp` refuse this and not that.
    expect(deleteVob(reader(), 1)).toEqual({ op: 'DeleteVob', vob: 1, path: '0/0' });
  });

  it('is refused for a VOB that is not in the index', () => {
    expect(() => deleteVob(reader(), 9)).toThrow(/9/);
  });

  it('renumbers whatever it removes — a root included', () => {
    // The one place it is not the mirror of an add. An appended root is
    // enumerated last and shifts nothing, which is why `renumbersPaths` is false
    // for one; a *removed* root takes every VOB after it down by one, and there
    // is no position in the tree where that is not true.
    expect(renumbersPaths(deleteVob(reader(), 2))).toBe(true);
    expect(renumbersPaths(deleteVob(reader(), 0))).toBe(true);
    expect(isStructuralOp(deleteVob(reader(), 1))).toBe(true);
  });

  it('has no inverse, and says so rather than inventing one', () => {
    // An inverse built from the columns would insert a bare `zCVob` with the
    // name and visual of an `oCMobInter` — the undo would look like it worked
    // and would have thrown the VOB's class, its children and its AI away.
    expect(() => invertOp(deleteVob(reader(), 1))).toThrow(/barrier|inverse/i);
    expect(isBarrierOp(deleteVob(reader(), 1))).toBe(true);
    expect(isBarrierOp(addVob(reader(), SPEC))).toBe(false);
    expect(isBarrierOp(moveVob(reader(), 0, [1, 2, 3]))).toBe(false);
  });

  it('reaches the binding as a delete of the path it carries', () => {
    const calls: string[] = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a property change'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('not an insert'); },
      deleteVob: (path) => { calls.push(`delete ${path}`); return undefined; },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };

    commitOps(binding, [deleteVob(reader(), 1)]);

    expect(calls).toEqual(['delete 0/0']);
  });

  it('has to be alone in its batch', () => {
    // Because it renumbers: every other op in the batch carries a path resolved
    // before the batch ran, and a delete moves the VOB each of them names.
    const binding: OpBinding = {
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '2',
      deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const move: WorldOp = { op: 'MoveVob', vob: 0, path: '0', from: [0, 0, 0], to: [1, 1, 1] };

    expect(() => commitOps(binding, [deleteVob(reader(), 1), move]))
      .toThrow(/only op in its batch/);
  });

  it('cannot be applied to the projection, and says so', () => {
    const live = reader();
    expect(() => applyOps(live, [deleteVob(live, 1)])).toThrow(/structural|re-read/i);
  });
});

describe('a reparent op', () => {
  //  vob 0 (root 0) ── vob 1 (slot 0)
  //                 └─ vob 2 (slot 1)
  //  vob 3 (root 1)
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0 },
    { parent: 0, childIndex: 0 },
    { parent: 0, childIndex: 1 },
    { childIndex: 1 },
  ]));

  it('carries where the VOB was and where it goes, both as slots', () => {
    // A path alone cannot describe the move: putting a VOB back at the *end* of
    // the list it came from is a different world from the one it left, so the
    // slot is part of both sides.
    const op = reparentVob(reader(), 2, 1, 0);

    expect(op).toEqual({
      op: 'ReparentVob',
      vob: 2,
      from: { path: '0/1', parentPath: '0', slot: 1 },
      to: { path: '0/0/0', parentPath: '0/0', slot: 0 },
    });
  });

  it('predicts the path the removal itself renumbers', () => {
    // Moving a VOB into a *later sibling* of itself: once it is gone the
    // destination has shifted down a slot, and the op has to say where the VOB
    // will actually be or its own inverse addresses somebody else. The binding
    // makes the same adjustment; `commitOps` checks the two agree.
    const op = reparentVob(reader(), 1, 2, 0);

    expect(op.from).toEqual({ path: '0/0', parentPath: '0', slot: 0 });
    expect(op.to).toEqual({ path: '0/0/0', parentPath: '0/1', slot: 0 });
  });

  it('takes a null parent to mean a root', () => {
    const op = reparentVob(reader(), 1, null, 2);
    expect(op.to).toEqual({ path: '2', parentPath: null, slot: 2 });
  });

  it('is its own inverse, with the two sides swapped', () => {
    const op = reparentVob(reader(), 2, 1, 0);
    const back = invertOp(op);

    expect(back).toEqual({ op: 'ReparentVob', vob: 2, from: op.to, to: op.from });
    expect(invertOp(back)).toEqual(op);
  });

  it('reaches the binding from the path the VOB is at, each way round', () => {
    // The half a swap of `from` and `to` does not give for free: undo moves the
    // VOB from where the op *put* it, not from where it started.
    const calls: string[] = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a property change'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('not an insert'); },
      deleteVob: () => { throw new Error('not a delete'); },
      reparentVob: (from, parent, slot) => {
        calls.push(`${from} -> ${parent}[${slot}]`);
        return parent === null ? String(slot) : `${parent}/${slot}`;
      },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const op = reparentVob(reader(), 2, 1, 0);

    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual(['0/1 -> 0/0[0]', '0/0/0 -> 0[1]']);
  });

  it('refuses a move that did not land where the op says it would', () => {
    const binding: OpBinding = {
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '0', deleteVob: () => {},
      reparentVob: () => '9/9',
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };

    expect(() => commitOps(binding, [reparentVob(reader(), 2, 1, 0)])).toThrow(/9\/9|0\/0\/0/);
  });

  it('refuses to put a VOB inside itself or its own subtree', () => {
    // The one move that destroys VOBs rather than misplacing them: a subtree
    // under its own descendant is unreachable from the roots, so it is not
    // enumerated, not counted and not written. The binding refuses it too; this
    // is here so the UI never offers it.
    expect(() => reparentVob(reader(), 0, 1, 0)).toThrow(/itself|descendant/i);
    expect(() => reparentVob(reader(), 0, 0, 0)).toThrow(/itself|descendant/i);
  });

  it('refuses a VOB or a parent that is not in the index', () => {
    expect(() => reparentVob(reader(), 9, 0, 0)).toThrow(/9/);
    expect(() => reparentVob(reader(), 1, 9, 0)).toThrow(/9/);
  });

  it('cannot be applied to the projection: it renumbers everything after it', () => {
    const live = reader();
    expect(() => applyOps(live, [reparentVob(live, 2, 1, 0)])).toThrow(/structural|re-read/i);
    expect(isStructuralOp(reparentVob(live, 2, 1, 0))).toBe(true);
  });

  it('has to be the only op in its batch, and an add does not', () => {
    // The distinction the batch guard rests on. Every op in a batch carries a
    // path resolved *before* the batch ran, so an op that renumbers invalidates
    // the ones after it — but appending a *root* renumbers nothing, because it
    // is enumerated last. Refusing every add would break the multi-op batches
    // one legitimately appears in; an add with a parent is refused with the
    // reparent, and that case is in the add's own describe.
    const binding: OpBinding = {
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '2', deleteVob: () => {}, reparentVob: () => '0/0/0',
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const live = reader();

    expect(() => commitOps(binding, [
      reparentVob(live, 2, 1, 0),
      moveVob(live, 3, [1, 2, 3]),
    ])).toThrow(/alone|only op|batch/i);

    expect(() => commitOps(binding, [
      addVob(live, { name: 'PLACED', position: [1, 2, 3] }),
      moveVob(live, 3, [1, 2, 3]),
    ])).not.toThrow();
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

  it('writes a property op into the interned columns the panels read', () => {
    // The name and the visual are dictionary indices, not values — so applying
    // one of these is not a write to a column but an intern plus a write, and a
    // projection that skipped it leaves the property grid naming the old visual
    // while the world holds the new one.
    const reader = createVobReader(vobIndex([
      { name: 'OLD', visual: 'OLD.3DS', flags: { showVisual: true, cdDynamic: true } },
    ]));

    const touched = applyOps(reader, [
      setVobProp(reader, 0, { name: 'NEW', visual: 'NEW.3DS', showVisual: false }),
    ]);

    expect(touched).toEqual([0]);
    expect(reader.name(0)).toBe('NEW');
    expect(reader.visual(0)).toBe('NEW.3DS');
    expect(reader.flags(0).showVisual).toBe(false);
    // A flag the op never named is not this op's to clear.
    expect(reader.flags(0).cdDynamic).toBe(true);
  });

  it('interns a name that is already in the dictionary instead of appending it', () => {
    // Every rename appending would grow the dictionary without bound behind a
    // user holding a checkbox, and two VOBs sharing a name would stop sharing
    // an entry — which is what the interning is for.
    const index = vobIndex([{ name: 'A' }, { name: 'B' }]);
    const reader = createVobReader(index);
    const before = index.names.length;

    applyOps(reader, [setVobProp(reader, 0, { name: 'B' })]);

    expect(reader.name(0)).toBe('B');
    expect(index.names.length).toBe(before);
  });

  it('restores every property exactly when a property op and its inverse are applied', () => {
    const reader = createVobReader(vobIndex([
      { name: 'OLD', visual: 'OLD.3DS', flags: { showVisual: true, vobStatic: true } },
    ]));
    const op = setVobProp(reader, 0, { name: 'NEW', visual: 'NEW.3DS', showVisual: false });

    applyOps(reader, [op]);
    applyOps(reader, [invertOp(op)]);

    expect(reader.name(0)).toBe('OLD');
    expect(reader.visual(0)).toBe('OLD.3DS');
    expect(reader.flags(0)).toEqual({
      showVisual: true, vobStatic: true, ambient: false,
      cdStatic: false, cdDynamic: false, physicsEnabled: false,
    });
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
      setVobRotation: () => { throw new Error('these batches are moves only'); },
      setVobProp: () => { throw new Error('these batches are moves only'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
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

  it('hands a property op its props, and the box only when the visual moved', () => {
    // The binding refuses a bbox that no visual swap justifies, so a writer that
    // always attached one would refuse every flag edit — and one that never
    // attached one would leave a swapped visual culled by the old visual's box.
    const calls: Array<[string, VobProps & { bbox?: ZenBounds }]> = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: (path, props) => { calls.push([path, props]); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };
    const box: ZenBounds = [0, 0, 0, 1, 1, 1];

    commitOps(binding, [
      { op: 'SetVobProp', vob: 0, path: '0/1', from: { showVisual: false }, to: { showVisual: true }, fromBbox: null, toBbox: null },
      { op: 'SetVobProp', vob: 1, path: '0/2', from: { visual: 'A.3DS' }, to: { visual: 'B.3DS' }, fromBbox: null, toBbox: box },
    ]);

    expect(calls).toEqual([
      ['0/1', { showVisual: true }],
      ['0/2', { visual: 'B.3DS', bbox: box }],
    ]);
  });

  it('unwinds a refused property batch back to the props each VOB had', () => {
    const calls: Array<[string, VobProps & { bbox?: ZenBounds }]> = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: (path, props) => {
        if (path === '0/2') throw new Error(`no vob at ${path}`);
        calls.push([path, props]);
      },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
    };

    expect(() => commitOps(binding, [
      { op: 'SetVobProp', vob: 0, path: '0/1', from: { name: 'A' }, to: { name: 'B' }, fromBbox: null, toBbox: null },
      { op: 'SetVobProp', vob: 1, path: '0/2', from: { name: 'C' }, to: { name: 'D' }, fromBbox: null, toBbox: null },
    ])).toThrow('no vob at 0/2');

    expect(calls).toEqual([['0/1', { name: 'B' }], ['0/1', { name: 'A' }]]);
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

describe('moving a waypoint', () => {
  // The first op that is not about a VOB at all, and the first whose address is
  // a bare index. A waynet is a flat list plus an edge set, so there is no path
  // to resolve — and no path is exactly what makes every VOB-shaped dispatch
  // below it dangerous: a wrong index always resolves to *some* waypoint.
  const NAMES = ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B'];
  const positions = () => Float32Array.from([0, 0, 0, 10, 20, 30, 40, 50, 60]);

  function waynetBinding(refuse?: string) {
    const calls: unknown[][] = [];
    const binding: OpBinding = {
      setVobPosition: (path, to) => calls.push(['position', path, to]),
      setVobRotation: () => { throw new Error('not a rotation'); },
      setVobProp: () => { throw new Error('not a prop'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: (waypoint, name, to) => {
        if (name === refuse) throw new Error(`no waypoint ${name}`);
        calls.push(['waypoint', waypoint, name, to]);
      },
    };
    return { binding, calls };
  }

  it('carries the waypoint\'s own origin and its name, read out of the payload', () => {
    // `from` comes out of the positions column rather than from the caller, for
    // the same reason every other op reads it: undo replays an op and never
    // consults a snapshot beside the history.
    const op = moveWaypoint(positions(), NAMES, 1, [11, 21, 31]);

    expect(op).toEqual({
      op: 'MoveWaypoint', waypoint: 1, name: 'WP_FIXTURE_A',
      from: [10, 20, 30], to: [11, 21, 31],
    });
  });

  it('is refused for a waypoint that is not in the payload', () => {
    expect(() => moveWaypoint(positions(), NAMES, 3, [0, 0, 0])).toThrow(/3/);
    expect(() => moveWaypoint(positions(), NAMES, -1, [0, 0, 0])).toThrow(/-1/);
  });

  it('inverts by swapping the two sides, and is its own round trip', () => {
    const op = moveWaypoint(positions(), NAMES, 2, [41, 51, 61]);
    const undo = invertOp(op) as MoveWaypoint;

    expect(undo.from).toEqual(op.to);
    expect(undo.to).toEqual(op.from);
    expect(undo.name).toBe('WP_FIXTURE_B');
    expect(invertOp(undo)).toEqual(op);
  });

  it('reaches the binding as setWaypointPosition, carrying the name as a guard', () => {
    // The name is the only defence an index-addressed op has. A stale VOB path
    // usually resolves to nothing; a stale waypoint index always resolves to a
    // waypoint, and moves the wrong one in silence.
    const { binding, calls } = waynetBinding();

    commitOps(binding, [moveWaypoint(positions(), NAMES, 1, [11, 21, 31])]);

    expect(calls).toEqual([['waypoint', 1, 'WP_FIXTURE_A', [11, 21, 31]]]);
  });

  it('is unwound by its own inverse when a later op in the batch is refused', () => {
    const { binding, calls } = waynetBinding('WP_FIXTURE_B');

    expect(() => commitOps(binding, [
      moveWaypoint(positions(), NAMES, 1, [11, 21, 31]),
      moveWaypoint(positions(), NAMES, 2, [41, 51, 61]),
    ])).toThrow('no waypoint WP_FIXTURE_B');

    expect(calls).toEqual([
      ['waypoint', 1, 'WP_FIXTURE_A', [11, 21, 31]],
      ['waypoint', 1, 'WP_FIXTURE_A', [10, 20, 30]],   // unwound
    ]);
  });

  it('is neither structural nor renumbering', () => {
    // Both answers are what let a waypoint move share a batch with a VOB move,
    // and `isStructuralOp` being false is what routes it into `applyOps` — which
    // is why the next test matters as much as this one.
    const op = moveWaypoint(positions(), NAMES, 1, [11, 21, 31]);

    expect(isStructuralOp(op)).toBe(false);
    expect(renumbersPaths(op)).toBe(false);
  });

  it('is refused by applyOps by name, and reports nothing as touched', () => {
    // The VOB columns have nowhere to put it. Before this refusal existed the
    // op fell through to the position write, where `op.vob` is `undefined`: a
    // `Float32Array` drops a write at a NaN index, so nothing moved and the
    // caller was still told a VOB had.
    const index = vobIndex([{ pos: [1, 2, 3] }]);
    const live = createVobReader(index);
    const op = moveWaypoint(positions(), NAMES, 1, [11, 21, 31]);

    // Matched on the reason, not on the op's name: the exhaustiveness tail also
    // refuses this op and also names it, so `/MoveWaypoint/` alone cannot tell
    // "the columns have no row for it" from "nobody wrote a branch".
    expect(() => applyOps(live, [op])).toThrow(/waynet op/);
    expect(live.position(0)).toEqual([1, 2, 3]);
  });

  it('writes the overlay column the points and the edge lines share', () => {
    // One `Float32Array` backs both, so writing it in place is what keeps a
    // moved waypoint and the edges into it from disagreeing.
    const column = positions();

    const touched = applyWaypointPositions(column, [
      moveWaypoint(column, NAMES, 1, [11, 21, 31]),
      moveWaypoint(column, NAMES, 2, [41, 51, 61]),
    ]);

    expect(Array.from(column)).toEqual([0, 0, 0, 11, 21, 31, 41, 51, 61]);
    expect(touched).toEqual([1, 2]);
  });

  it('refuses to write past the end of that column', () => {
    const column = positions();
    const op: MoveWaypoint = {
      op: 'MoveWaypoint', waypoint: 3, name: 'WP_GONE', from: [0, 0, 0], to: [1, 1, 1],
    };

    expect(() => applyWaypointPositions(column, [op])).toThrow(/3/);
  });

  it('leaves an unknown op kind refused rather than moving a VOB', () => {
    // The tail of every dispatch used to be `MoveVob`, so an op kind nobody
    // wrote a branch for was silently treated as a move. `WorldOp` is a
    // compile-time claim about data that arrives over IPC.
    const { binding } = waynetBinding();
    const bogus = { op: 'ScaleVob', vob: 0, path: '0/1', from: [0, 0, 0], to: [1, 1, 1] };

    expect(() => commitOps(binding, [bogus as unknown as WorldOp])).toThrow(/ScaleVob/);
  });
});
