// The VOB tree, over the columnar index (level-editor.md §6 `model/`, §7).
//
// `vobIndex` gives `parent` and `childIndex` and nothing else about structure —
// the scene tree has to reconstruct the hierarchy from those two columns, for
// 23,288 VOBs, without ever building 23,288 row objects. Three things here are
// load-bearing and all three fail quietly:
//
//   - sibling order is `childIndex`, NOT VOB index. A world whose siblings
//     happen to be enumerated in order hides a tree that sorts by the wrong key.
//   - a flattened view costs what is *visible*, not what exists, or opening a
//     world means laying out 23,288 rows nobody asked for.
//   - reading a row must not allocate a typed-array view per column per row.

import {
  buildVobTree,
  createVobReader,
  flattenVisible,
  type VobIndex,
} from '../src/model';

interface Spec {
  parent?: number;
  childIndex?: number;
  cls?: string;
  name?: string;
  visual?: string;
  visualType?: string;
  pos?: [number, number, number];
  flags?: number;
}

/** A VOB table in the columnar shape `vobIndex` emits. */
function vobIndex(vobs: Spec[]): VobIndex {
  const classes: string[] = [];
  const names: string[] = [];
  const visuals: string[] = [];
  const visualTypes: string[] = [];
  const intern = (dict: string[], value: string) => {
    const at = dict.indexOf(value);
    return at === -1 ? dict.push(value) - 1 : at;
  };

  const parent = new Int32Array(vobs.length);
  const childIndex = new Uint32Array(vobs.length);
  const positions = new Float32Array(vobs.length * 3);
  const rotations = new Float32Array(vobs.length * 9);
  const flags = new Uint32Array(vobs.length);
  const classIndex = new Uint32Array(vobs.length);
  const nameIndex = new Uint32Array(vobs.length);
  const visualIndex = new Uint32Array(vobs.length);
  const visualTypeIndex = new Uint32Array(vobs.length);

  vobs.forEach((vob, i) => {
    parent[i] = vob.parent ?? -1;
    childIndex[i] = vob.childIndex ?? 0;
    positions.set(vob.pos ?? [i, i * 2, i * 3], i * 3);
    rotations.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
    flags[i] = vob.flags ?? 0;
    classIndex[i] = intern(classes, vob.cls ?? 'zCVob');
    nameIndex[i] = intern(names, vob.name ?? '');
    visualIndex[i] = intern(visuals, vob.visual ?? '');
    visualTypeIndex[i] = intern(visualTypes, vob.visualType ?? 'MULTI_RESOLUTION_MESH');
  });

  return {
    count: vobs.length,
    parent: parent.buffer,
    childIndex: childIndex.buffer,
    positions: positions.buffer,
    rotations: rotations.buffer,
    flags: flags.buffer,
    classes, classIndex: classIndex.buffer,
    names, nameIndex: nameIndex.buffer,
    visuals, visualIndex: visualIndex.buffer,
    visualTypes, visualTypeIndex: visualTypeIndex.buffer,
  };
}

describe('buildVobTree', () => {
  it('reads the hierarchy out of parent and childIndex', () => {
    //  0 ── 1
    //    └── 2 ── 3
    const tree = buildVobTree(vobIndex([
      {},
      { parent: 0, childIndex: 0 },
      { parent: 0, childIndex: 1 },
      { parent: 2, childIndex: 0 },
    ]));

    expect(tree.roots).toEqual([0]);
    expect(tree.children(0)).toEqual([1, 2]);
    expect(tree.children(2)).toEqual([3]);
    expect(tree.children(1)).toEqual([]);
    expect(tree.parent(3)).toBe(2);
    expect(tree.parent(0)).toBe(-1);
  });

  it('orders siblings by childIndex, not by VOB index', () => {
    // The two columns disagree deliberately: VOB 1 is stored first but is the
    // *third* child. A tree that sorts by VOB index passes on every world whose
    // siblings happen to be enumerated in order, and silently reorders the rest.
    const tree = buildVobTree(vobIndex([
      {},
      { parent: 0, childIndex: 2 },
      { parent: 0, childIndex: 0 },
      { parent: 0, childIndex: 1 },
    ]));

    expect(tree.children(0)).toEqual([2, 3, 1]);
  });

  it('handles several roots, in their own sibling order', () => {
    const tree = buildVobTree(vobIndex([
      { childIndex: 1 },
      { childIndex: 0 },
      { parent: 1, childIndex: 0 },
    ]));

    expect(tree.roots).toEqual([1, 0]);
    expect(tree.children(1)).toEqual([2]);
  });

  it('gives each VOB its depth and its ancestors, root first', () => {
    const tree = buildVobTree(vobIndex([
      {},
      { parent: 0 },
      { parent: 1 },
      { parent: 2 },
    ]));

    expect([0, 1, 2, 3].map((vob) => tree.depth(vob))).toEqual([0, 1, 2, 3]);
    // Root first, and excluding the VOB itself — this is what a viewport pick
    // expands to reveal the row it selected.
    expect(tree.ancestors(3)).toEqual([0, 1, 2]);
    expect(tree.ancestors(0)).toEqual([]);
  });

  it('does not assume a parent is enumerated before its children', () => {
    // Retail worlds are enumerated depth-first, so they are. Depending on it
    // would be depending on something nothing in the format guarantees.
    const tree = buildVobTree(vobIndex([
      { parent: 1, childIndex: 0 },
      {},
    ]));

    expect(tree.roots).toEqual([1]);
    expect(tree.children(1)).toEqual([0]);
    expect(tree.depth(0)).toBe(1);
  });
});

describe('flattenVisible', () => {
  const index = vobIndex([
    {},
    { parent: 0, childIndex: 0 },
    { parent: 0, childIndex: 1 },
    { parent: 2, childIndex: 0 },
    { childIndex: 1 },
  ]);

  it('shows only roots when nothing is expanded', () => {
    const rows = flattenVisible(buildVobTree(index), new Set());
    expect(rows).toEqual([
      { vob: 0, depth: 0, hasChildren: true },
      { vob: 4, depth: 0, hasChildren: false },
    ]);
  });

  it('expands one level at a time, in pre-order', () => {
    const tree = buildVobTree(index);

    expect(flattenVisible(tree, new Set([0])).map((row) => row.vob)).toEqual([0, 1, 2, 4]);
    // 2 expanded but 0 collapsed: its children stay hidden, because an
    // expansion below a collapsed ancestor is not visible.
    expect(flattenVisible(tree, new Set([2])).map((row) => row.vob)).toEqual([0, 4]);
    expect(flattenVisible(tree, new Set([0, 2])).map((row) => row.vob)).toEqual([0, 1, 2, 3, 4]);
  });

  it('reports depth so a row can be indented without walking parents', () => {
    const rows = flattenVisible(buildVobTree(index), new Set([0, 2]));
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 2, 0]);
  });

  it('costs what is visible, not what exists', () => {
    // 20,000 VOBs under one collapsed root is one row. A flatten that walks the
    // whole index instead would be the difference between opening NewWorld's
    // tree instantly and laying out 23,288 rows nobody asked for.
    const many = vobIndex([
      {},
      ...Array.from({ length: 20_000 }, (_, i) => ({ parent: 0, childIndex: i })),
    ]);
    const tree = buildVobTree(many);

    expect(flattenVisible(tree, new Set())).toEqual([{ vob: 0, depth: 0, hasChildren: true }]);
    expect(flattenVisible(tree, new Set([0]))).toHaveLength(20_001);
  });
});

describe('createVobReader', () => {
  const index = vobIndex([
    { cls: 'zCVobLight', name: 'TORCH', visual: 'TORCH.3DS', visualType: 'MESH', pos: [1, 2, 3], flags: 0b101 },
    { cls: 'oCItem', name: 'ITMW_SWORD', visual: 'ITMW_SWORD.3DS', pos: [-10, 0, 40.5], flags: 0 },
  ]);

  it('reads a row out of the interned columns', () => {
    const reader = createVobReader(index);

    expect(reader.className(0)).toBe('zCVobLight');
    expect(reader.name(0)).toBe('TORCH');
    expect(reader.visual(0)).toBe('TORCH.3DS');
    expect(reader.visualType(0)).toBe('MESH');
    // ZenGin space, unconverted — what a property grid shows and what an op
    // would carry.
    expect(reader.position(1)).toEqual([-10, 0, 40.5]);
    expect(reader.className(1)).toBe('oCItem');
  });

  it('decodes the flag bits by name', () => {
    const reader = createVobReader(index);

    // bit 0 showVisual, 1 vobStatic, 2 ambient, 3 cdStatic, 4 cdDynamic,
    // 5 physicsEnabled — 0b101 is showVisual + ambient.
    expect(reader.flags(0)).toEqual({
      showVisual: true, vobStatic: false, ambient: true,
      cdStatic: false, cdDynamic: false, physicsEnabled: false,
    });
    expect(reader.flags(1).showVisual).toBe(false);
  });

  it('creates its column views once, not once per row', () => {
    // 23,288 VOBs behind a virtualized list: a reader that rebuilt a typed
    // array per row would allocate on every scroll frame. That is invisible to
    // any assertion on the values — a rebuilt view over the same buffer reads
    // identically — so the buffer counts how often it is asked for instead.
    let reads = 0;
    const counted: VobIndex = {
      ...index,
      get classIndex() { reads += 1; return index.classIndex; },
    };

    const reader = createVobReader(counted);
    const afterConstruction = reads;
    for (let i = 0; i < 100; i++) reader.className(i % 2);

    expect(afterConstruction).toBe(1);
    expect(reads).toBe(1);
    expect(reader.count).toBe(2);
    expect(reader.columns.classIndex.length).toBe(index.count);
  });

  it('refuses a VOB that is not in the index', () => {
    const reader = createVobReader(index);
    expect(reader.className(-1)).toBeNull();
    expect(reader.className(2)).toBeNull();
    expect(reader.position(2)).toBeNull();
  });
});
