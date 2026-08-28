// The VOB hierarchy, reconstructed from the columnar index (level-editor.md §6
// `model/`, §7).
//
// `vobIndex` is deliberately columnar and interned — 23,288 VOBs on retail
// NewWorld naming 445 visuals, 2,654 names and 37 classes, in 1.69 MB. What it
// says about structure is two columns: `parent`, the index of a VOB's parent,
// and `childIndex`, its position among its siblings. Everything a scene tree
// needs comes out of those two, and the shape it comes out into matters:
//
//   - **sibling order is `childIndex`.** Not VOB index. Retail worlds are
//     enumerated depth-first so the two usually agree, which is exactly why
//     sorting by the wrong one passes on the world you tested and reorders the
//     next one.
//   - **a flattened view costs what is visible.** A tree over 23,288 rows that
//     materialises all of them on open has paid for 23,283 rows nobody can see.
//   - **rows are read, not built.** `createVobReader` makes the column views
//     once; a row is an index, not an object.

/** The `vobIndex` payload, columnar with the repeated strings interned. */
export type { VobIndex } from '../scene';
import type { VobIndex } from '../scene';

export interface VobTree {
  count: number;
  /** VOBs with no parent, in sibling order. */
  roots: readonly number[];
  /** Children of `vob`, in sibling order; empty when it is a leaf. */
  children(vob: number): readonly number[];
  /** The parent of `vob`, or -1 when it is a root. */
  parent(vob: number): number;
  depth(vob: number): number;
  /** Root-first, excluding `vob` itself — what a viewport pick expands to
   *  reveal the row it selected. */
  ancestors(vob: number): number[];
}

export function buildVobTree(index: VobIndex): VobTree {
  const count = index.count;
  const parents = new Int32Array(index.parent);
  const childIndex = new Uint32Array(index.childIndex);

  // Compressed sparse row: one pass to count, a prefix sum, one pass to fill.
  // Nothing here allocates per node.
  const start = new Int32Array(count + 2);
  const rootAt = count;                     // roots live in the last bucket
  for (let vob = 0; vob < count; vob++) {
    start[(parents[vob] < 0 ? rootAt : parents[vob]) + 1] += 1;
  }
  for (let i = 0; i < count + 1; i++) start[i + 1] += start[i];

  const list = new Int32Array(count);
  const cursor = start.slice(0, count + 1);
  for (let vob = 0; vob < count; vob++) {
    list[cursor[parents[vob] < 0 ? rootAt : parents[vob]]++] = vob;
  }

  // Siblings are ordered by `childIndex`, not by the order they were counted
  // in. Sorting each bucket keeps that local: the whole index is never sorted.
  const bucket = (at: number): number[] => {
    const from = start[at];
    const to = start[at + 1];
    if (to - from <= 1) return from === to ? [] : [list[from]];
    return Array.prototype.slice.call(list, from, to).sort(
      (a: number, b: number) => childIndex[a] - childIndex[b],
    ) as number[];
  };

  const childrenOf: Array<readonly number[] | undefined> = new Array(count);
  const children = (vob: number): readonly number[] => {
    if (vob < 0 || vob >= count) return [];
    return (childrenOf[vob] ??= bucket(vob));
  };
  const roots = bucket(rootAt);

  // Depth by descent from the roots rather than by walking each VOB's parents:
  // a walk is O(depth) per VOB and this is one pass. It also does not assume a
  // parent is enumerated before its children — nothing in the format says so.
  const depths = new Int32Array(count);
  const stack = [...roots];
  while (stack.length > 0) {
    const vob = stack.pop()!;
    for (const child of children(vob)) {
      depths[child] = depths[vob] + 1;
      stack.push(child);
    }
  }

  return {
    count,
    roots,
    children,
    parent: (vob) => (vob < 0 || vob >= count ? -1 : parents[vob]),
    depth: (vob) => (vob < 0 || vob >= count ? 0 : depths[vob]),
    ancestors: (vob) => {
      const path: number[] = [];
      for (let at = vob < 0 || vob >= count ? -1 : parents[vob]; at >= 0; at = parents[at]) {
        path.push(at);
      }
      return path.reverse();
    },
  };
}

export interface VobRow {
  vob: number;
  depth: number;
  hasChildren: boolean;
}

/**
 * The rows a scene tree actually draws, in pre-order.
 *
 * Walks only into expanded nodes, so a world whose root is collapsed costs one
 * row — not 23,288. An expansion under a collapsed ancestor is not reached,
 * which is what makes collapsing a subtree cheap rather than a re-computation.
 */
export function flattenVisible(tree: VobTree, expanded: ReadonlySet<number>): VobRow[] {
  const rows: VobRow[] = [];

  const walk = (vob: number, depth: number) => {
    const children = tree.children(vob);
    rows.push({ vob, depth, hasChildren: children.length > 0 });
    if (!expanded.has(vob)) return;
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of tree.roots) walk(root, 0);

  return rows;
}

/**
 * What a scene-tree filter asks for: a substring of the VOB's name, a set of
 * class names, or both. An absent or blank half means "any".
 *
 * Spacer filters by exactly these two, and neither of them needs a per-VOB
 * round trip: `names`/`nameIndex` and `classes`/`classIndex` are already in the
 * summary, interned.
 */
export interface VobQuery {
  /** Case-insensitive, matched anywhere in the name. */
  text?: string;
  /** Kept classes, matched exactly against the class dictionary. Empty is
   *  "any class", not "no class". */
  classes?: readonly string[];
}

/** Whether a query would keep every VOB, and so is not worth running. */
export function isEmptyQuery(query: VobQuery): boolean {
  return (query.text ?? '').trim() === '' && (query.classes ?? []).length === 0;
}

/**
 * One byte per VOB: 1 when it matches, 0 when it does not.
 *
 * The query is answered against the **dictionaries** first — retail worlds name
 * 2,654 names and 37 classes for 41,393 VOBs — and the sweep over the VOBs is
 * then an integer lookup per row. Lowercasing per row instead would do fifteen
 * times the string work for the same answer, on every keystroke.
 */
export function matchVobs(index: VobIndex, query: VobQuery): Uint8Array {
  const matches = new Uint8Array(index.count);
  if (isEmptyQuery(query)) {
    matches.fill(1);
    return matches;
  }

  const text = (query.text ?? '').trim().toLowerCase();
  const classes = query.classes ?? [];
  const nameHits = text === ''
    ? null
    : index.names.map((name) => (name.toLowerCase().includes(text) ? 1 : 0));
  const classHits = classes.length === 0
    ? null
    : index.classes.map((cls) => (classes.includes(cls) ? 1 : 0));

  const nameIndex = new Uint32Array(index.nameIndex);
  const classIndex = new Uint32Array(index.classIndex);
  for (let vob = 0; vob < index.count; vob++) {
    if (nameHits !== null && nameHits[nameIndex[vob]] === 0) continue;
    if (classHits !== null && classHits[classIndex[vob]] === 0) continue;
    matches[vob] = 1;
  }
  return matches;
}

/**
 * The rows a filtered scene tree draws: every match, and the ancestors that
 * make it reachable, in pre-order.
 *
 * A match's own children are *not* kept unless they matched too — the point of
 * the filter is that what is on screen is the answer, and a matched crate that
 * unfolded into its forty unmatched contents would not be. That is why
 * `hasChildren` is about the kept children and not the tree's: it is what a row
 * can actually show.
 *
 * Expansion state is not consulted. A filter that also had to be unfolded by
 * hand would hide the hit it just found.
 */
export function flattenMatching(tree: VobTree, matches: Uint8Array): VobRow[] {
  const kept = new Uint8Array(matches);
  for (let vob = 0; vob < kept.length; vob++) {
    if (matches[vob] === 0) continue;
    // Stops at the first already-kept ancestor: two matches under one parent
    // walk the shared part of the path once between them.
    for (let at = tree.parent(vob); at >= 0 && kept[at] === 0; at = tree.parent(at)) {
      kept[at] = 1;
    }
  }

  const rows: VobRow[] = [];
  const walk = (vob: number, depth: number) => {
    const children = tree.children(vob).filter((child) => kept[child] === 1);
    rows.push({ vob, depth, hasChildren: children.length > 0 });
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of tree.roots) if (kept[root] === 1) walk(root, 0);

  return rows;
}

export interface VobFlags {
  showVisual: boolean;
  vobStatic: boolean;
  ambient: boolean;
  cdStatic: boolean;
  cdDynamic: boolean;
  physicsEnabled: boolean;
}

export interface VobReader {
  count: number;
  /** The column views, made once. Exposed so a caller with a hot loop can read
   *  them directly rather than through the per-row accessors. */
  columns: {
    parent: Int32Array;
    childIndex: Uint32Array;
    positions: Float32Array;
    rotations: Float32Array;
    flags: Uint32Array;
    classIndex: Uint32Array;
    nameIndex: Uint32Array;
    visualIndex: Uint32Array;
    visualTypeIndex: Uint32Array;
  };
  /**
   * The interned dictionaries `nameIndex` and `visualIndex` point into.
   *
   * Exposed because a property op renames a VOB, and a name is a dictionary
   * index rather than a value — applying one is an intern plus a column write,
   * and neither half is reachable through the accessors above.
   */
  dictionaries: { names: string[]; visuals: string[] };
  className(vob: number): string | null;
  name(vob: number): string | null;
  visual(vob: number): string | null;
  visualType(vob: number): string | null;
  /** ZenGin space, unconverted — the coordinates an op would carry. */
  position(vob: number): [number, number, number] | null;
  /** Row-major 3x3. */
  rotation(vob: number): number[] | null;
  flags(vob: number): VobFlags;
}

const NO_FLAGS: VobFlags = {
  showVisual: false, vobStatic: false, ambient: false,
  cdStatic: false, cdDynamic: false, physicsEnabled: false,
};

/**
 * A read-out over the index whose typed-array views are created once.
 *
 * The naive version builds five views per call, which behind a virtualized list
 * over 23,288 VOBs means allocating on every scroll frame — the same rule §7
 * states for `semanticModel` and memoized components, in the world surface.
 */
export function createVobReader(index: VobIndex): VobReader {
  const columns = {
    parent: new Int32Array(index.parent),
    childIndex: new Uint32Array(index.childIndex),
    positions: new Float32Array(index.positions),
    rotations: new Float32Array(index.rotations),
    flags: new Uint32Array(index.flags),
    classIndex: new Uint32Array(index.classIndex),
    nameIndex: new Uint32Array(index.nameIndex),
    visualIndex: new Uint32Array(index.visualIndex),
    visualTypeIndex: new Uint32Array(index.visualTypeIndex),
  };
  const inside = (vob: number) => vob >= 0 && vob < index.count;

  return {
    count: index.count,
    columns,
    dictionaries: { names: index.names, visuals: index.visuals },
    className: (vob) => (inside(vob) ? index.classes[columns.classIndex[vob]] : null),
    name: (vob) => (inside(vob) ? index.names[columns.nameIndex[vob]] : null),
    visual: (vob) => (inside(vob) ? index.visuals[columns.visualIndex[vob]] : null),
    visualType: (vob) => (inside(vob) ? index.visualTypes[columns.visualTypeIndex[vob]] : null),
    position: (vob) => (inside(vob)
      ? [columns.positions[vob * 3], columns.positions[vob * 3 + 1], columns.positions[vob * 3 + 2]]
      : null),
    rotation: (vob) => (inside(vob)
      ? Array.prototype.slice.call(columns.rotations, vob * 9, vob * 9 + 9) as number[]
      : null),
    flags: (vob) => {
      if (!inside(vob)) return NO_FLAGS;
      const word = columns.flags[vob];
      return {
        showVisual: (word & 0b000001) !== 0,
        vobStatic: (word & 0b000010) !== 0,
        ambient: (word & 0b000100) !== 0,
        cdStatic: (word & 0b001000) !== 0,
        cdDynamic: (word & 0b010000) !== 0,
        physicsEnabled: (word & 0b100000) !== 0,
      };
    },
  };
}
