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
  alignVobsToNormal,
  applyOps,
  applyWaypointNames,
  applyWaypointPositions,
  reparentVob,
  commitOps,
  createVobReader,
  deleteVob,
  deleteWaypoint,
  dropVobsToGround,
  duplicateVobSpec,
  duplicateVobs,
  pasteVobs,
  invertOp,
  isBarrierOp,
  isStructuralOp,
  isWaynetOp,
  moveVob,
  moveWaypoint,
  renameWaypoint,
  addWaypoint,
  connectWaypoints,
  disconnectWaypoints,
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
  type RenameWaypoint,
  type AddWaypoint,
  type SetWaypointEdge,
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
  /** Row-major 3x3. Identity when omitted — the same default the columnar
   *  builder writes, and the pose every op before the duplicate spec reads for
   *  nothing. */
  rot?: number[];
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
    rotations.set(vob.rot ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
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

describe('a drop to ground', () => {
  // Unlike `translateVobs`, there is no shared delta: each VOB found its own
  // ground point independently (its own downward raycast), so the batch takes
  // a destination per VOB rather than one delta for the whole selection.
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, pos: [100, 200, 300] },
    { parent: 0, childIndex: 4, pos: [10, 20, 30] },
    { parent: 0, childIndex: 5, pos: [-1, -2, -3] },
  ]));

  it('moves each VOB straight to its own ground point', () => {
    const ops = dropVobsToGround(reader(), [
      { vob: 0, ground: [100, 5, 300] },
      { vob: 2, ground: [-1, -50, -3] },
    ]);

    expect(ops).toEqual([
      { op: 'MoveVob', vob: 0, path: '0', from: [100, 200, 300], to: [100, 5, 300] },
      { op: 'MoveVob', vob: 2, path: '0/5', from: [-1, -2, -3], to: [-1, -50, -3] },
    ]);
  });

  it('inverts as a batch — the whole selection goes back where it came from', () => {
    const index = vobIndex([
      { childIndex: 0, pos: [100, 200, 300] },
      { parent: 0, childIndex: 4, pos: [10, 20, 30] },
    ]);
    const live = createVobReader(index);
    const ops = dropVobsToGround(live, [
      { vob: 0, ground: [100, 5, 300] },
      { vob: 1, ground: [10, -8, 30] },
    ]);

    applyOps(live, ops);
    applyOps(live, [...ops].reverse().map(invertOp));

    expect(live.position(0)).toEqual([100, 200, 300]);
    expect(live.position(1)).toEqual([10, 20, 30]);
  });

  it('is nothing at all when nothing is selected', () => {
    expect(dropVobsToGround(reader(), [])).toEqual([]);
  });

  it('is refused whole when one of the selected VOBs is not in the index', () => {
    expect(() => dropVobsToGround(reader(), [
      { vob: 0, ground: [1, 2, 3] },
      { vob: 9, ground: [4, 5, 6] },
    ])).toThrow(/9/);
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: (path, to) => calls.push(['position', path, to]),
      setVobRotation: (path, to, bbox) => calls.push(['rotation', path, to, bbox]),
      setVobProp: (path, props) => calls.push(['props', path, props]),
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };

    commitOps(binding, [rotateVob(reader(), 1, QUARTER_Y, BOUNDS)]);

    expect(calls).toEqual([['rotation', '0/4', QUARTER_Y, [0, 20, 29, 20, 22, 31]]]);
  });

  it('is unwound by its own inverse when a later op in the batch is refused', () => {
    // A mixed batch is still all-or-nothing, and a rotation is unwound by
    // rotating back — not by a move.
    const calls: string[] = [];
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: (path) => { if (path === '9/9') throw new Error('no vob'); calls.push(`move ${path}`); },
      setVobRotation: (path) => calls.push(`rotate ${path}`),
      setVobProp: (path) => calls.push(`props ${path}`),
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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

describe('an align to normal', () => {
  // Aligns each VOB's local +Y axis to its own hit normal (level-editor.md
  // §16.5) — the engine is Y-up, so +Y is the standard "up" default, and there
  // is deliberately no per-visual-class exception to it. Like a drop to
  // ground, there is no shared delta: each VOB found its own normal.
  const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const BOUNDS: ZenBounds = [-1, 0, -10, 1, 2, 10];

  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, pos: [100, 200, 300] },
    { parent: 0, childIndex: 4, pos: [10, 20, 30] },
  ]));

  it('leaves an already-upright VOB alone when the normal is straight up', () => {
    const ops = alignVobsToNormal(reader(), [{ vob: 0, normal: [0, 1, 0] }], () => BOUNDS);

    expect(ops[0].to).toEqual(IDENTITY);
  });

  it('rotates local +Y onto the given normal', () => {
    // Written out via Rodrigues' formula rather than derived from the
    // implementation: an implementation that aligned the wrong axis, or
    // aligned it backwards, would still pass a test built the same way it was.
    const ops = alignVobsToNormal(reader(), [{ vob: 1, normal: [1, 0, 0] }], () => BOUNDS);

    expect(ops[0].to).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1]);
    // The rotated local Y axis (the matrix's middle column) is the normal.
    const [, y1, , , y4, , , y7] = ops[0].to;
    expect([y1, y4, y7]).toEqual([1, 0, 0]);
  });

  it('refits the bounding box for both poses, same as a rotate op', () => {
    const ops = alignVobsToNormal(reader(), [{ vob: 1, normal: [1, 0, 0] }], () => BOUNDS);

    expect(ops[0].fromBbox).not.toBeNull();
    expect(ops[0].toBbox).not.toBeNull();
    expect(ops[0].toBbox).not.toEqual(ops[0].fromBbox);
  });

  it('asks for each VOB\'s own bounds, and takes null for an answer', () => {
    const asked: number[] = [];
    const ops = alignVobsToNormal(reader(), [
      { vob: 0, normal: [1, 0, 0] },
      { vob: 1, normal: [0, 1, 0] },
    ], (vob) => {
      asked.push(vob);
      return vob === 0 ? BOUNDS : null;
    });

    expect(asked).toEqual([0, 1]);
    expect(ops[0].toBbox).not.toBeNull();
    expect(ops[1].toBbox).toBeNull();
  });

  it('is nothing at all when nothing is selected', () => {
    expect(alignVobsToNormal(reader(), [], () => null)).toEqual([]);
  });

  it('is refused whole when one of the selected VOBs is not in the index', () => {
    expect(() => alignVobsToNormal(reader(), [
      { vob: 0, normal: [0, 1, 0] },
      { vob: 9, normal: [0, 1, 0] },
    ], () => null)).toThrow(/9/);
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a base property change'); },
      setVobClassProp: (path, props) => { calls.push([path, props]); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: (path) => { if (path === '9/9') throw new Error('no vob'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a base property change'); },
      setVobClassProp: (path, props) => { calls.push([path, props]); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (_spec, parentPath) => (parentPath === null ? '2' : `${parentPath}/1`),
      deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (spec, parentPath) => {
        calls.push(`insert ${spec.name} under ${String(parentPath)}`);
        return '0/1';
      },
      deleteVob: (path) => { calls.push(`delete ${path}`); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };
    const op = addVob(reader(), SPEC, 0);

    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual(['insert PLACED under 0', 'delete 0/1']);
  });

  it('carries the class and the instance an item is, untouched', () => {
    // The class is the object's C++ type and the binding is the only layer that
    // can author one (level-editor.md §16.15, I1), so this package's whole part
    // in it is to carry the two fields through unread — an `AddVob` describes a
    // VOB completely, and a spec that lost its class would insert a `zCVob`
    // wearing an item's name.
    let seen: NewVob | null = null;
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (spec) => { seen = spec; return '2'; },
      deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };
    const item: NewVob = {
      class: 'oCItem', instance: 'ITFO_APPLE', name: 'APPLE_01', position: [1, 2, 3],
    };

    commitOps(binding, [addVob(reader(), item)]);

    expect(seen).toEqual(item);
  });

  it('reaches the binding as an insert one way and a delete the other', () => {
    const calls: string[] = [];
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a property change'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (spec) => { calls.push(`insert ${spec.name}`); return '2'; },
      deleteVob: (path) => { calls.push(`delete ${path}`); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '7',
      deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };

    expect(() => commitOps(binding, [addVob(reader(), SPEC)])).toThrow(/7|2/);
  });

  it('is unwound by a delete when a later op in the batch is refused', () => {
    const calls: string[] = [];
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: (path) => { if (path === '9/9') throw new Error('no vob'); },
      setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { calls.push('insert'); return '2'; },
      deleteVob: (path) => { calls.push(`delete ${path}`); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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

describe('the spec a duplicate is built from', () => {
  // The whole of D1 (level-editor.md §16.14): a duplicate needs no new op,
  // because `addVob` already takes a description of a VOB — so the work is
  // reading one back out of the index, and what makes it worth a function of
  // its own is that the reading is where a field gets silently dropped.
  const reader = () => createVobReader(vobIndex([
    {
      childIndex: 0,
      name: 'BARREL_01',
      visual: 'BARREL.3DS',
      pos: [10, 20, 30],
      rot: [0, 0, 1, 0, 1, 0, -1, 0, 0],
      flags: { showVisual: true, cdDynamic: true, physicsEnabled: true },
    },
    { childIndex: 1 },
  ]));

  it('carries every field of the row a `NewVob` has a place for', () => {
    expect(duplicateVobSpec(reader(), 0)).toEqual({
      name: 'BARREL_01',
      visual: 'BARREL.3DS',
      position: [10, 20, 30],
      rotation: [0, 0, 1, 0, 1, 0, -1, 0, 0],
      // The five authorable flags, each of them stated: a spec that omitted the
      // false ones would author the binding's defaults instead of the row's
      // values, and a duplicate of a VOB with `showVisual` off would come back
      // visible.
      showVisual: true,
      vobStatic: false,
      ambient: false,
      cdStatic: false,
      cdDynamic: true,
    });
  });

  it('carries the class of a VOB the binding can construct', () => {
    // D2's class half (level-editor.md §16.14): a duplicate of a light is a
    // light, not a `zCVob` wearing its name. The class is in the index — it is
    // a column — so this is the reading and nothing more; `insertVob` learned
    // the construction in I1/I2.
    const live = createVobReader(vobIndex([
      { cls: 'zCVobLight', name: 'TORCH' },
      { cls: 'zCVobSoundDaytime', name: 'BIRDS' },
    ]));

    expect(duplicateVobSpec(live, 0).class).toBe('zCVobLight');
    expect(duplicateVobSpec(live, 1).class).toBe('zCVobSoundDaytime');
  });

  it('omits the class of a plain `zCVob`, which is the default anyway', () => {
    expect(duplicateVobSpec(reader(), 0)).not.toHaveProperty('class');
  });

  it('drops a class the binding cannot construct, rather than refusing the copy', () => {
    // An `oCMobDoor` still duplicates as a `zCVob` with the door's name, pose
    // and visual — lossy, exactly as it was before the class was carried at
    // all. Emitting the class would be refused by the IPC validator, which
    // turns a lossy duplicate into no duplicate.
    const live = createVobReader(vobIndex([{ cls: 'oCMobDoor', name: 'DOOR' }]));

    expect(duplicateVobSpec(live, 0)).not.toHaveProperty('class');
  });

  it('drops `oCItem`, whose `instance` is not in the index', () => {
    // The one authorable class this cannot carry: an `AddVob` of an `oCItem`
    // needs the instance it spawns, that is a class property behind
    // `getVobProps`, and a spec naming the class without it is refused.
    const live = createVobReader(vobIndex([{ cls: 'oCItem', name: 'ITMW_1H_SWORD_01' }]));

    const spec = duplicateVobSpec(live, 0);
    expect(spec).not.toHaveProperty('class');
    expect(spec).not.toHaveProperty('instance');
  });

  it('drops `physicsEnabled`, because `NewVob` has no place for it', () => {
    // D2's field, and the one the row carries that this cannot pass on:
    // `insertVob` does not take it. Asserted rather than left implicit, so the
    // increment that adds the follow-up op has a test that changes.
    expect(duplicateVobSpec(reader(), 0)).not.toHaveProperty('physicsEnabled');
  });

  it('omits a name and a visual the row does not have', () => {
    // An unnamed VOB interns to the empty string, and an empty `name` is not
    // the same as no name — the binding writes what it is given.
    expect(duplicateVobSpec(reader(), 1)).toEqual({
      position: [1, 2, 3],
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      showVisual: false,
      vobStatic: false,
      ambient: false,
      cdStatic: false,
      cdDynamic: false,
    });
  });

  it('takes the bounding box it is handed, fitted where the VOB stands', () => {
    // The one field of a duplicate that is *not* in the row: the index carries
    // no bbox column at all. The caller holds the visual's own bounds — the
    // same ones a rotation refits from — and the box is fitted through the
    // row's rotation, so a turned VOB duplicates with the box it had.
    const spec = duplicateVobSpec(reader(), 0, [-1, 0, -10, 1, 2, 10]);

    expect(spec.bbox).toEqual(placeBounds(
      [-1, 0, -10, 1, 2, 10], [0, 0, 1, 0, 1, 0, -1, 0, 0], [10, 20, 30],
    ));
  });

  it('carries no box when there are no bounds, rather than a guessed one', () => {
    expect(duplicateVobSpec(reader(), 0)).not.toHaveProperty('bbox');
  });

  it('is refused for a VOB that is not in the index', () => {
    expect(() => duplicateVobSpec(reader(), 9)).toThrow(/9/);
  });
});

describe('a selection duplicated as one batch', () => {
  // D4 (level-editor.md §16.14). One batch is one undo entry, which is the whole
  // point: five copies the user has to undo five times is not what "duplicate
  // the selection" means. It adds no op either — it is D1's spec, N times, with
  // the one correction a batch needs.
  //
  //  vob 0 (root 0) ── vob 1 ── vob 2
  //  vob 3 (root 1)
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, name: 'ROOT_A', visual: 'A.3DS' },
    { parent: 0, childIndex: 0, name: 'CHILD_A', visual: 'B.3DS' },
    { parent: 0, childIndex: 1, name: 'CHILD_B', visual: 'C.3DS' },
    { childIndex: 1, name: 'ROOT_B', visual: 'D.3DS' },
  ]));

  it('is one AddVob per VOB, each beside the VOB it was copied from', () => {
    const ops = duplicateVobs(reader(), [1, 3]);

    expect(ops.map((op) => [op.op, op.path, op.parentPath])).toEqual([
      ['AddVob', '0/2', '0'],
      ['AddVob', '2', null],
    ]);
    expect(ops[0].to).toMatchObject({ name: 'CHILD_A', visual: 'B.3DS' });
    expect(ops[1].to).toMatchObject({ name: 'ROOT_B', visual: 'D.3DS' });
  });

  it('gives two copies of the same parent consecutive slots', () => {
    // The one correction a batch needs, and the reason this is not `map`:
    // `addVob` resolves the slot against the world as it was, so both copies
    // would claim `0/2` — and `writeOp` would refuse the second, because the
    // list it was appended to has changed since.
    expect(duplicateVobs(reader(), [1, 2]).map((op) => op.path)).toEqual(['0/2', '0/3']);
    // Roots are the same list and get the same treatment.
    expect(duplicateVobs(reader(), [0, 3]).map((op) => op.path)).toEqual(['2', '3']);
  });

  it('takes the bounds each VOB is handed, so a copy keeps the box it had', () => {
    const bounds = (vob: number): ZenBounds | null => (vob === 3 ? [-1, 0, -10, 1, 2, 10] : null);
    const ops = duplicateVobs(reader(), [1, 3], bounds);

    expect(ops[0].to).not.toHaveProperty('bbox');
    expect(ops[1].to!.bbox).toEqual(placeBounds(
      [-1, 0, -10, 1, 2, 10], [1, 0, 0, 0, 1, 0, 0, 0, 1], [3, 6, 9],
    ));
  });

  it('refuses the whole batch when one VOB is not in the index', () => {
    // The same refusal `setVobProps` makes, for the same reason: a quietly
    // dropped op is the half-applied state `commitOps` exists to prevent.
    expect(() => duplicateVobs(reader(), [1, 9])).toThrow(/9/);
  });

  it('commits as one batch, and unwinds as one', () => {
    // The batch guard used to refuse this outright — a parented add renumbers.
    // What it renumbers is flat indices, and an op is addressed by a *path*: an
    // append never changes an existing one, which is what makes a batch of them
    // safe and a delete in one still not.
    const landed: string[] = [];
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: (_spec, parentPath) => {
        const path = parentPath === null ? `${2 + landed.length}` : `${parentPath}/${2 + landed.length}`;
        landed.push(path);
        return path;
      },
      deleteVob: (path) => { landed.splice(landed.indexOf(path), 1); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };

    commitOps(binding, duplicateVobs(reader(), [1, 2]));
    expect(landed).toEqual(['0/2', '0/3']);

    // And back to front on the way out: the inverse of the batch is what undo
    // replays, and it removes the appended slots in the order that leaves the
    // remaining ones where their ops say they are.
    commitOps(binding, [...duplicateVobs(reader(), [1, 2])].reverse().map(invertOp));
    expect(landed).toEqual([]);
  });

  it('does not let a delete into the batch it opened', () => {
    // The relaxation is a batch of adds, not a batch of structural ops. A delete
    // takes every VOB after it down by one wherever it sits — paths included.
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '0/2', deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };
    const live = reader();

    expect(() => commitOps(binding, [...duplicateVobs(live, [1]), deleteVob(live, 2)]))
      .toThrow(/only op in its batch/);
  });
});

describe('a clipboard pasted into a list', () => {
  // D3 (level-editor.md §16.14). Copy and paste are duplicate taken apart: the
  // specs are read at the copy, and where they land is chosen at the paste. So
  // this takes specs rather than VOBs — the clipboard's contents survive the
  // selection that filled it, and survive the VOBs being deleted.
  //
  //  vob 0 (root 0) -- vob 1 -- vob 2
  //  vob 3 (root 1)
  const reader = () => createVobReader(vobIndex([
    { childIndex: 0, name: 'ROOT_A', visual: 'A.3DS' },
    { parent: 0, childIndex: 0, name: 'CHILD_A', visual: 'B.3DS' },
    { parent: 0, childIndex: 1, name: 'CHILD_B', visual: 'C.3DS' },
    { childIndex: 1, name: 'ROOT_B', visual: 'D.3DS' },
  ]));
  const specs = (live = reader()) => [duplicateVobSpec(live, 1), duplicateVobSpec(live, 3)];

  it('is one AddVob per spec, all appended to the list it is given', () => {
    // Every copy goes into the *one* list the paste chose, which is the whole
    // difference from a duplicate: that puts each copy back beside its own
    // original.
    const ops = pasteVobs(reader(), specs(), 0);

    expect(ops.map((op) => [op.op, op.path, op.parentPath])).toEqual([
      ['AddVob', '0/2', '0'],
      ['AddVob', '0/3', '0'],
    ]);
    expect(ops[0].to).toMatchObject({ name: 'CHILD_A', visual: 'B.3DS' });
    expect(ops[1].to).toMatchObject({ name: 'ROOT_B', visual: 'D.3DS' });
  });

  it('appends to the roots when the paste has no parent', () => {
    // Consecutive there too: `addVob` resolves every slot against the world as
    // it was, so without the advance both copies would claim slot 2 and
    // `writeOp` would refuse the second.
    expect(pasteVobs(reader(), specs(), null).map((op) => op.path)).toEqual(['2', '3']);
  });

  it('pastes what was copied, not what the world holds now', () => {
    // The clipboard is a value. The VOB it was read from may be gone by the
    // time it is pasted, and the paste is still exact.
    const copied = specs();
    const ops = pasteVobs(reader(), [copied[0]], null);

    expect(ops[0].to).toBe(copied[0]);
  });

  it('is nothing at all for an empty clipboard', () => {
    expect(pasteVobs(reader(), [], null)).toEqual([]);
  });

  it('refuses a parent that is not in the index', () => {
    expect(() => pasteVobs(reader(), specs(), 9)).toThrow(/9/);
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: () => { throw new Error('not a property change'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('not an insert'); },
      deleteVob: (path) => { calls.push(`delete ${path}`); return undefined; },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };

    commitOps(binding, [deleteVob(reader(), 1)]);

    expect(calls).toEqual(['delete 0/0']);
  });

  it('has to be alone in its batch', () => {
    // Because it renumbers: every other op in the batch carries a path resolved
    // before the batch ran, and a delete moves the VOB each of them names.
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '2',
      deleteVob: () => {},
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
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
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
    };
    const op = reparentVob(reader(), 2, 1, 0);

    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual(['0/1 -> 0/0[0]', '0/0/0 -> 0[1]']);
  });

  it('refuses a move that did not land where the op says it would', () => {
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '0', deleteVob: () => {},
      reparentVob: () => '9/9',
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => {}, setVobRotation: () => {}, setVobProp: () => {},
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => '2', deleteVob: () => {}, reparentVob: () => '0/0/0',
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
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
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a turn'); },
      setVobProp: (path, props) => { calls.push([path, props]); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
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
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
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
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
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
      setWaypointName: (waypoint, name, to) => {
        if (name === refuse) throw new Error(`no waypoint ${name}`);
        calls.push(['rename', waypoint, name, to]);
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

describe('renaming a waypoint', () => {
  // W1 (§16.7). It renumbers nothing, so it stands on the shipped index+name
  // pair rather than needing an addressing scheme of its own — and its guard
  // *is* its origin, which is what makes the inverse the plain swap.
  const NAMES = ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B'];

  function renameBinding(refuse?: string) {
    const calls: unknown[][] = [];
    const binding: OpBinding = {
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a rotation'); },
      setVobProp: () => { throw new Error('not a prop'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: (waypoint, name, to) => {
        if (name === refuse) throw new Error(`no waypoint ${name}`);
        calls.push(['rename', waypoint, name, to]);
      },
    };
    return { binding, calls };
  }

  it('carries the name the index had, read out of the payload', () => {
    const op = renameWaypoint(NAMES, 1, 'WP_RENAMED');

    expect(op).toEqual({
      op: 'RenameWaypoint', waypoint: 1, from: 'WP_FIXTURE_A', to: 'WP_RENAMED',
    });
  });

  it('is refused for a waypoint that is not in the payload', () => {
    expect(() => renameWaypoint(NAMES, 3, 'WP_X')).toThrow(/3/);
    expect(() => renameWaypoint(NAMES, -1, 'WP_X')).toThrow(/-1/);
  });

  it('inverts by swapping the two sides, and is its own round trip', () => {
    const op = renameWaypoint(NAMES, 2, 'WP_RENAMED');
    const undo = invertOp(op) as RenameWaypoint;

    expect(undo.from).toBe('WP_RENAMED');
    expect(undo.to).toBe('WP_FIXTURE_B');
    expect(invertOp(undo)).toEqual(op);
  });

  it('reaches the binding as setWaypointName, guarded by the name it replaces', () => {
    const { binding, calls } = renameBinding();

    commitOps(binding, [renameWaypoint(NAMES, 1, 'WP_RENAMED')]);

    expect(calls).toEqual([['rename', 1, 'WP_FIXTURE_A', 'WP_RENAMED']]);
  });

  it('is unwound guarded by the name it just wrote, not the one it replaced', () => {
    // The half a plain `from`/`to` swap does not give for free. By the time the
    // batch unwinds, the waypoint is called `to` — a guard still naming `from`
    // would be refused by the binding, and the unwind would be the thing that
    // failed.
    const { binding, calls } = renameBinding('WP_FIXTURE_B');

    expect(() => commitOps(binding, [
      renameWaypoint(NAMES, 1, 'WP_RENAMED'),
      renameWaypoint(NAMES, 2, 'WP_ALSO_RENAMED'),
    ])).toThrow('no waypoint WP_FIXTURE_B');

    expect(calls).toEqual([
      ['rename', 1, 'WP_FIXTURE_A', 'WP_RENAMED'],
      ['rename', 1, 'WP_RENAMED', 'WP_FIXTURE_A'],   // unwound
    ]);
  });

  it('is neither structural nor renumbering, and is a waynet op', () => {
    const op = renameWaypoint(NAMES, 1, 'WP_RENAMED');

    expect(isStructuralOp(op)).toBe(false);
    expect(renumbersPaths(op)).toBe(false);
    expect(isWaynetOp(op)).toBe(true);
  });

  it('is refused by applyOps by name, and reports nothing as touched', () => {
    // The VOB columns have no row for a waypoint. Refused rather than skipped:
    // a skip would leave the panel showing a name the world no longer has.
    const index = vobIndex([{ pos: [1, 2, 3] }]);
    const live = createVobReader(index);

    expect(() => applyOps(live, [renameWaypoint(NAMES, 1, 'WP_RENAMED')]))
      .toThrow(/waynet op/);
    expect(live.position(0)).toEqual([1, 2, 3]);
  });

  it('writes the name list the panel reads, and answers which moved', () => {
    const names = [...NAMES];

    const touched = applyWaypointNames(names, [
      renameWaypoint(NAMES, 1, 'WP_RENAMED'),
      renameWaypoint(NAMES, 2, 'WP_ALSO_RENAMED'),
    ]);

    expect(names).toEqual(['FP_FIXTURE_FREE', 'WP_RENAMED', 'WP_ALSO_RENAMED']);
    expect(touched).toEqual([1, 2]);
  });

  it('refuses to write past the end of that list', () => {
    const op: RenameWaypoint = {
      op: 'RenameWaypoint', waypoint: 3, from: 'WP_GONE', to: 'WP_X',
    };

    expect(() => applyWaypointNames([...NAMES], [op])).toThrow(/3/);
  });
});

describe('adding a waypoint', () => {
  // W2 (§16.7). It appends, so every existing index still names the waypoint it
  // named before and the op needs no addressing scheme of its own — and its
  // inverse is the removal of the tail it just made, which renumbers nothing
  // either.
  const NAMES = ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B'];

  function addBinding(landsAt?: number) {
    const calls: unknown[][] = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a rotation'); },
      setVobProp: () => { throw new Error('not a prop'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
      addWaypoint: (name, to) => {
        calls.push(['add', name, to]);
        return landsAt ?? NAMES.length;
      },
      removeWaypoint: (waypoint, name, barrier) => {
        calls.push(['remove', waypoint, name, barrier]);
      },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
    };
    return { binding, calls };
  }

  it('takes the index one past the end, and carries its name at the top level', () => {
    const op = addWaypoint(NAMES, 'FP_ADDED', [1, 2, 3]);

    expect(op).toEqual({
      op: 'AddWaypoint', waypoint: 3, name: 'FP_ADDED', from: null, to: [1, 2, 3],
    });
  });

  it('is refused for an empty name and one the payload already has', () => {
    expect(() => addWaypoint(NAMES, '', [1, 2, 3])).toThrow(/empty/);
    expect(() => addWaypoint(NAMES, 'WP_FIXTURE_A', [1, 2, 3])).toThrow(/already/);
  });

  it('inverts into the removal of the waypoint it made, keeping the name', () => {
    const op = addWaypoint(NAMES, 'FP_ADDED', [1, 2, 3]);
    const undo = invertOp(op) as AddWaypoint;

    expect(undo.from).toEqual([1, 2, 3]);
    expect(undo.to).toBeNull();
    expect(undo.name).toBe('FP_ADDED');
    expect(invertOp(undo)).toEqual(op);
  });

  it('reaches the binding as addWaypoint, and as removeWaypoint when undone', () => {
    const { binding, calls } = addBinding();

    const op = addWaypoint(NAMES, 'FP_ADDED', [1, 2, 3]);
    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual([
      ['add', 'FP_ADDED', [1, 2, 3]],
      ['remove', 3, 'FP_ADDED', false],
    ]);
  });

  it('puts back a waypoint that landed at an index the op does not name', () => {
    // The waynet grew under the op — so the waypoint is at an index this op
    // cannot address, and its own inverse would remove whatever is at the tail.
    // Refused, and undone before the refusal, exactly as an insert is.
    const { binding, calls } = addBinding(7);

    expect(() => commitOps(binding, [addWaypoint(NAMES, 'FP_ADDED', [1, 2, 3])]))
      .toThrow(/landed at 7/);
    expect(calls).toEqual([
      ['add', 'FP_ADDED', [1, 2, 3]],
      ['remove', 7, 'FP_ADDED', false],
    ]);
  });

  it('is neither structural nor renumbering, and is a waynet op', () => {
    // Structural is about the *VOB* enumeration, which a waypoint has no part
    // in — so the columnar projection is not re-read for this, and the overlay's
    // own payload is what has to be.
    const op = addWaypoint(NAMES, 'FP_ADDED', [1, 2, 3]);

    expect(isStructuralOp(op)).toBe(false);
    expect(renumbersPaths(op)).toBe(false);
    expect(isBarrierOp(op)).toBe(false);
    expect(isWaynetOp(op)).toBe(true);
  });

  it('is refused by applyOps by name, and reports nothing as touched', () => {
    const index = vobIndex([{ pos: [1, 2, 3] }]);
    const live = createVobReader(index);

    expect(() => applyOps(live, [addWaypoint(NAMES, 'FP_ADDED', [1, 2, 3])]))
      .toThrow(/waynet op/);
    expect(live.position(0)).toEqual([1, 2, 3]);
  });
});

describe('joining and unjoining two waypoints', () => {
  // W3 (§16.7). An edge is a pair of waypoints and nothing else, so one op
  // shape carries both directions: `from` and `to` say whether the edge is
  // there, and the inverse is the plain swap. Neither direction touches the
  // point list, so both stand on the index+name pair every waynet op already
  // uses and neither needs an addressing scheme of its own.
  const NAMES = ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B'];

  function edgeBinding() {
    const calls: unknown[][] = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a rotation'); },
      setVobProp: () => { throw new Error('not a prop'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('no structural ops in this batch'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: () => { throw new Error('not a waypoint removal'); },
      addWaypointEdge: (a, aName, b, bName) => { calls.push(['join', a, aName, b, bName]); },
      removeWaypointEdge: (a, aName, b, bName) => { calls.push(['unjoin', a, aName, b, bName]); },
    };
    return { binding, calls };
  }

  it('carries both endpoints as the index+name pair, and the edge as its sides', () => {
    expect(connectWaypoints(NAMES, 0, 2)).toEqual({
      op: 'SetWaypointEdge',
      a: 0, aName: 'FP_FIXTURE_FREE', b: 2, bName: 'WP_FIXTURE_B',
      from: false, to: true,
    });
    expect(disconnectWaypoints(NAMES, 1, 2)).toEqual({
      op: 'SetWaypointEdge',
      a: 1, aName: 'WP_FIXTURE_A', b: 2, bName: 'WP_FIXTURE_B',
      from: true, to: false,
    });
  });

  it('is refused for an index the payload does not have, and for a self-loop', () => {
    expect(() => connectWaypoints(NAMES, 0, 3)).toThrow(/no waypoint 3/);
    expect(() => connectWaypoints(NAMES, -1, 0)).toThrow(/no waypoint -1/);
    expect(() => disconnectWaypoints(NAMES, 3, 0)).toThrow(/no waypoint 3/);
    expect(() => connectWaypoints(NAMES, 1, 1)).toThrow(/itself/);
  });

  it('inverts into the other direction, endpoints untouched', () => {
    // The endpoints are not sides: an edge op is about *one* pair whichever way
    // it is going, so only the two booleans swap.
    const op = connectWaypoints(NAMES, 0, 2);
    const undo = invertOp(op) as SetWaypointEdge;

    expect(undo).toEqual({ ...op, from: true, to: false });
    expect(invertOp(undo)).toEqual(op);
  });

  it('reaches the binding as the add, and as the removal when undone', () => {
    const { binding, calls } = edgeBinding();

    const op = connectWaypoints(NAMES, 0, 2);
    commitOps(binding, [op]);
    commitOps(binding, [invertOp(op)]);

    expect(calls).toEqual([
      ['join', 0, 'FP_FIXTURE_FREE', 2, 'WP_FIXTURE_B'],
      ['unjoin', 0, 'FP_FIXTURE_FREE', 2, 'WP_FIXTURE_B'],
    ]);
  });

  it('unwinds a refused batch through the side it came from', () => {
    // The half a `direction`-blind branch would get wrong: `commitOps` unwinds
    // by replaying the applied ops through `'from'`, so a join whose batch is
    // refused later has to be *unjoined* — not joined a second time.
    const { binding, calls } = edgeBinding();
    const refused: WorldOp = { op: 'MoveVob', vob: 0, path: '9', from: [0, 0, 0], to: [1, 1, 1] };

    expect(() => commitOps(binding, [connectWaypoints(NAMES, 0, 2), refused])).toThrow();

    expect(calls).toEqual([
      ['join', 0, 'FP_FIXTURE_FREE', 2, 'WP_FIXTURE_B'],
      ['unjoin', 0, 'FP_FIXTURE_FREE', 2, 'WP_FIXTURE_B'],
    ]);
  });

  it('is neither structural nor renumbering nor a barrier, and is a waynet op', () => {
    // An edge changes no enumeration at all — not the VOB columns and not the
    // point list — so the only thing that has to be re-read for it is the
    // overlay's own edge buffer.
    const op = connectWaypoints(NAMES, 0, 2);

    expect(isStructuralOp(op)).toBe(false);
    expect(renumbersPaths(op)).toBe(false);
    expect(isBarrierOp(op)).toBe(false);
    expect(isWaynetOp(op)).toBe(true);
  });

  it('is refused by applyOps by name, and reports nothing as touched', () => {
    const index = vobIndex([{ pos: [1, 2, 3] }]);
    const live = createVobReader(index);

    expect(() => applyOps(live, [connectWaypoints(NAMES, 0, 2)])).toThrow(/waynet op/);
    expect(live.position(0)).toEqual([1, 2, 3]);
  });
});

describe('deleting a waypoint', () => {
  // W4 (§16.7) — the one waynet op that renumbers, and therefore the one that
  // could not stand on the shipped index+name pair for free. §15 answers it the
  // way `DeleteVob` is answered rather than with a synthetic id: the op is a
  // **barrier**, the history clears both stacks behind it, and the user is told
  // first. That keeps every other waynet op's address honest — an index is only
  // ever read against the enumeration it was made against, because nothing
  // survives the delete to be replayed against a different one.
  const NAMES = ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B'];

  function deleteBinding() {
    const calls: unknown[][] = [];
    const binding: OpBinding = {
      setVobPosition: () => { throw new Error('not a move'); },
      setVobRotation: () => { throw new Error('not a rotation'); },
      setVobProp: () => { throw new Error('not a prop'); },
      setVobClassProp: () => { throw new Error('not a class property change'); },
      insertVob: () => { throw new Error('no structural ops in this batch'); },
      deleteVob: () => { throw new Error('not a vob delete'); },
      reparentVob: () => { throw new Error('not a reparent'); },
      setWaypointPosition: () => { throw new Error('not a waypoint move'); },
      setWaypointName: () => { throw new Error('not a waypoint rename'); },
      addWaypoint: () => { throw new Error('not a waypoint add'); },
      removeWaypoint: (waypoint, name, barrier) => {
        calls.push(['remove', waypoint, name, barrier]);
      },
      addWaypointEdge: () => { throw new Error('not an edge add'); },
      removeWaypointEdge: () => { throw new Error('not an edge removal'); },
    };
    return { binding, calls };
  }

  it('carries the index and the name it had, and nothing else', () => {
    // No `from` side, deliberately, and for `DeleteVob`'s reason: a side that
    // described the waypoint would claim the op could put it back, and the edges
    // it was in are not on it. The name is still the guard the bare index needs.
    expect(deleteWaypoint(NAMES, 1)).toEqual({
      op: 'DeleteWaypoint', waypoint: 1, name: 'WP_FIXTURE_A',
    });
  });

  it('is refused for an index the payload does not have', () => {
    expect(() => deleteWaypoint(NAMES, 3)).toThrow(/no waypoint 3/);
    expect(() => deleteWaypoint(NAMES, -1)).toThrow(/no waypoint -1/);
  });

  it('has no inverse, and says so rather than inventing one', () => {
    // An inverse built out of the payload would re-add the waypoint at the tail
    // — a different index, without its edges, and after everything else had been
    // renumbered. The undo would look like it worked.
    expect(() => invertOp(deleteWaypoint(NAMES, 1))).toThrow(/barrier|inverse/i);
    expect(isBarrierOp(deleteWaypoint(NAMES, 1))).toBe(true);
  });

  it('is a waynet op, and neither structural nor path-renumbering', () => {
    // It renumbers *waypoints*, which is what the barrier is for; the VOB
    // enumeration and the index paths are untouched, so the columnar projection
    // and the VOB selection are not this op's business.
    const op = deleteWaypoint(NAMES, 1);

    expect(isWaynetOp(op)).toBe(true);
    expect(isStructuralOp(op)).toBe(false);
    expect(renumbersPaths(op)).toBe(false);
  });

  it('reaches the binding as the barrier direction of removeWaypoint', () => {
    // The same call an undone append makes, with the flag that lets it take an
    // index in the middle and the edges naming it — which is the whole of what
    // the barrier buys.
    const { binding, calls } = deleteBinding();

    commitOps(binding, [deleteWaypoint(NAMES, 1)]);

    expect(calls).toEqual([['remove', 1, 'WP_FIXTURE_A', true]]);
  });

  it('has to be alone in its batch', () => {
    // Every other waypoint op in the batch carries an index read before it ran,
    // and this is the one op that moves them. There is no unwinding it either:
    // a later failure would replay the applied ops backwards, and this one has
    // no backwards.
    const { binding, calls } = deleteBinding();
    const move = moveWaypoint(new Float32Array(9), NAMES, 2, [1, 2, 3]);

    expect(() => commitOps(binding, [deleteWaypoint(NAMES, 1), move]))
      .toThrow(/only op in its batch/);
    expect(calls).toEqual([]);
  });

  it('is refused by applyOps by name, and reports nothing as touched', () => {
    const index = vobIndex([{ pos: [1, 2, 3] }]);
    const live = createVobReader(index);

    expect(() => applyOps(live, [deleteWaypoint(NAMES, 1)])).toThrow(/waynet op/);
    expect(live.position(0)).toEqual([1, 2, 3]);
  });
});
