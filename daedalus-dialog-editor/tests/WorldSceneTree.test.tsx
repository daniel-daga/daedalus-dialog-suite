/**
 * The world scene tree (level-editor.md §6 — the Phase 1a surface beside the
 * viewport).
 *
 * Tested at the component level rather than through Playwright on purpose. The
 * browser mock harness reports "no world" instead of fabricating one — a
 * deliberate decision recorded in `mockAPI.ts` and exercised by
 * `tests/e2e/world-surface.spec.ts` — so there is no world in that harness for
 * a tree to be a tree of. Here a small `VobIndex` in exactly the columnar shape
 * the binding emits is enough, and it reaches the two things that actually
 * matter: virtualization, and the loop between a viewport pick and the row.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VobIndex, WorldSummary } from '../src/shared/worldTypes';
import WorldSceneTree from '../src/renderer/components/world/WorldSceneTree';

// The house pattern for react-window under jsdom, which has no layout.
jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

interface Spec {
  parent?: number;
  childIndex?: number;
  cls?: string;
  name?: string;
  visual?: string;
}

function vobIndex(vobs: Spec[]): VobIndex {
  const classes: string[] = [];
  const names: string[] = [];
  const visuals: string[] = [];
  const intern = (dict: string[], value: string) => {
    const at = dict.indexOf(value);
    return at === -1 ? dict.push(value) - 1 : at;
  };

  const parent = new Int32Array(vobs.length);
  const childIndex = new Uint32Array(vobs.length);
  const classIndex = new Uint32Array(vobs.length);
  const nameIndex = new Uint32Array(vobs.length);
  const visualIndex = new Uint32Array(vobs.length);

  vobs.forEach((vob, i) => {
    parent[i] = vob.parent ?? -1;
    childIndex[i] = vob.childIndex ?? 0;
    classIndex[i] = intern(classes, vob.cls ?? 'zCVob');
    nameIndex[i] = intern(names, vob.name ?? '');
    visualIndex[i] = intern(visuals, vob.visual ?? '');
  });

  return {
    count: vobs.length,
    parent: parent.buffer,
    childIndex: childIndex.buffer,
    positions: new Float32Array(vobs.length * 3).buffer,
    rotations: new Float32Array(vobs.length * 9).buffer,
    flags: new Uint32Array(vobs.length).fill(1).buffer,
    classes, classIndex: classIndex.buffer,
    names, nameIndex: nameIndex.buffer,
    visuals, visualIndex: visualIndex.buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(vobs.length).buffer,
  };
}

function summaryOf(index: VobIndex): WorldSummary {
  return {
    worldPath: 'NewWorld.zen',
    bbox: [0, 0, 0, 1, 1, 1],
    vobIndex: index,
    stats: { vobCount: index.count, materials: 0, worldDrawGroups: 0, worldTriangles: 0 },
    timings: {},
  };
}

//  0 "CASTLE" ── 1 "GATE"
//               └ 2 (unnamed) ── 3 "TORCH"
//  4 "WELL"
const NESTED = summaryOf(vobIndex([
  { name: 'CASTLE', cls: 'zCVob' },
  { parent: 0, childIndex: 0, name: 'GATE', cls: 'oCMobDoor' },
  { parent: 0, childIndex: 1, cls: 'zCVobLevelCompo' },
  { parent: 2, childIndex: 0, name: 'TORCH', cls: 'zCVobLight', visual: 'TORCH.3DS' },
  { childIndex: 1, name: 'WELL', cls: 'zCVob' },
]));

const row = (vob: number) => screen.queryByTestId(`world-vob-row-${vob}`);

describe('WorldSceneTree', () => {
  it('starts collapsed, showing only the roots', () => {
    // 23,288 VOBs: an expand-everything default is 23,288 rows on open.
    render(<WorldSceneTree summary={NESTED} selection={[]} onSelect={jest.fn()} />);

    expect(row(0)).toBeInTheDocument();
    expect(row(4)).toBeInTheDocument();
    expect(row(1)).not.toBeInTheDocument();
    expect(row(3)).not.toBeInTheDocument();
  });

  it('reveals children when a row is expanded, and hides them again', async () => {
    const user = userEvent.setup();
    render(<WorldSceneTree summary={NESTED} selection={[]} onSelect={jest.fn()} />);

    await user.click(screen.getByTestId('world-vob-toggle-0'));
    expect(row(1)).toBeInTheDocument();
    expect(row(2)).toBeInTheDocument();
    // One level at a time — 2's own child stays hidden.
    expect(row(3)).not.toBeInTheDocument();

    await user.click(screen.getByTestId('world-vob-toggle-0'));
    expect(row(1)).not.toBeInTheDocument();
  });

  it('labels a VOB by name, else by visual, and always shows the class', async () => {
    // Measured on retail NewWorld: 23,288 VOBs carry 2,654 distinct names, so
    // most rows have none. Falling straight back to the class produced a tree
    // that was a column of the word "zCVob" — the visual is what actually
    // identifies an unnamed prop.
    const user = userEvent.setup();
    render(<WorldSceneTree summary={NESTED} selection={[]} onSelect={jest.fn()} />);

    expect(within(row(0)!).getByText('CASTLE')).toBeInTheDocument();
    expect(within(row(0)!).getByText('zCVob')).toBeInTheDocument();

    await user.click(screen.getByTestId('world-vob-toggle-0'));
    await user.click(screen.getByTestId('world-vob-toggle-2'));
    // 3 has both a name and a visual: the name wins.
    expect(within(row(3)!).getByText('TORCH')).toBeInTheDocument();
    expect(within(row(3)!).queryByText('TORCH.3DS')).not.toBeInTheDocument();
  });

  it('identifies an unnamed VOB by its visual rather than repeating the class', () => {
    const unnamed = summaryOf(vobIndex([
      { cls: 'zCVob', visual: 'NW_NATURE_HOHETANNEN_02_531P.3DS' },
      { cls: 'zCVobLight' },
    ]));
    render(<WorldSceneTree summary={unnamed} selection={[]} onSelect={jest.fn()} />);

    expect(within(row(0)!).getByText('NW_NATURE_HOHETANNEN_02_531P.3DS')).toBeInTheDocument();
    // Nothing to fall back to but the class, which every row carries anyway.
    expect(within(row(1)!).getByText('zCVobLight')).toBeInTheDocument();
  });

  it('reports the VOB index, not the row, when a row is clicked', async () => {
    // Names are not unique and rows move as the tree expands; the index into
    // the VobIndex is the only stable identity a VOB has.
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<WorldSceneTree summary={NESTED} selection={[]} onSelect={onSelect} />);

    await user.click(screen.getByTestId('world-vob-toggle-0'));
    // VOB 4 deliberately: with 0 expanded the visible rows are 0, 1, 2, 4, so
    // it sits at *position 3*. A row that reported its position would return 3
    // here and would agree with the VOB index for every other row in this tree.
    await user.click(row(4)!);

    expect(onSelect).toHaveBeenCalledWith(4, false);
  });

  it('asks to add to the selection on a Ctrl or Meta click, and to replace it otherwise', async () => {
    // The tree is the only place a VOB the viewport cannot show — a decal, a
    // sound VOB, anything unplaced — can be added to a batch at all.
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<WorldSceneTree summary={NESTED} selection={[0]} onSelect={onSelect} />);

    await user.keyboard('{Control>}');
    await user.click(row(4)!);
    await user.keyboard('{/Control}');
    expect(onSelect).toHaveBeenLastCalledWith(4, true);

    await user.click(row(4)!);
    expect(onSelect).toHaveBeenLastCalledWith(4, false);
  });

  it('marks every VOB in the selection, not just the one the panels describe', async () => {
    const user = userEvent.setup();
    render(<WorldSceneTree summary={NESTED} selection={[0, 4]} onSelect={jest.fn()} />);

    expect(row(0)).toHaveAttribute('aria-selected', 'true');
    expect(row(4)).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByTestId('world-vob-toggle-0'));
    expect(row(1)).toHaveAttribute('aria-selected', 'false');
  });

  it('expands the ancestors of a VOB selected from the viewport', () => {
    // The loop that makes the tree worth having: a click in the viewport
    // returns a VOB index and nothing else, and the row for it is three levels
    // down inside collapsed parents.
    const { rerender } = render(
      <WorldSceneTree summary={NESTED} selection={[]} onSelect={jest.fn()} />,
    );
    expect(row(3)).not.toBeInTheDocument();

    rerender(<WorldSceneTree summary={NESTED} selection={[3]} onSelect={jest.fn()} />);

    expect(row(3)).toBeInTheDocument();
    expect(row(0)).toBeInTheDocument();
    expect(row(2)).toBeInTheDocument();
    expect(row(3)).toHaveAttribute('aria-selected', 'true');
    expect(row(0)).toHaveAttribute('aria-selected', 'false');
  });

  it('renders only the rows in view, not every row that exists', async () => {
    // The whole reason for react-window here. 20,000 siblings expanded is 20k
    // rows in the model and a screenful in the DOM.
    const user = userEvent.setup();
    const many = summaryOf(vobIndex([
      { name: 'ROOT' },
      ...Array.from({ length: 20_000 }, (_, i) => ({ parent: 0, childIndex: i })),
    ]));
    render(<WorldSceneTree summary={many} selection={[]} onSelect={jest.fn()} />);

    await user.click(screen.getByTestId('world-vob-toggle-0'));

    const rendered = screen.getAllByRole('treeitem');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(200);
  });

  it('reparents a VOB dropped onto another row, as that row’s last child', () => {
    // Drop *onto* a row rather than between rows: the gesture has to be
    // unambiguous without an insertion indicator, and "becomes a child of what
    // you dropped it on" is the one reading that needs no extra UI. The slot is
    // the end of that parent's children, which is where a drop with no position
    // in it can honestly mean.
    const onReparent = jest.fn();
    render(<WorldSceneTree
      summary={NESTED}
      selection={[]}
      onSelect={jest.fn()}
      onReparent={onReparent}
    />);

    fireEvent.dragStart(row(4)!);
    fireEvent.dragOver(row(0)!);
    fireEvent.drop(row(0)!);

    // CASTLE already has two children, so WELL becomes the third.
    expect(onReparent).toHaveBeenCalledWith(4, 0, 2);
  });

  it('refuses a drop onto the VOB being dragged, or onto its own descendant', () => {
    // The move that destroys VOBs rather than misplacing them: a subtree under
    // its own descendant is unreachable from the roots, so it is not
    // enumerated, not counted and not written. The op refuses it and so does
    // the binding; this is the layer that must not offer it.
    const onReparent = jest.fn();
    render(<WorldSceneTree
      summary={NESTED}
      selection={[]}
      onSelect={jest.fn()}
      onReparent={onReparent}
    />);

    fireEvent.click(screen.getByTestId('world-vob-toggle-0'));

    // Onto itself. A drop ends the drag whether or not it was accepted, so each
    // attempt below starts a fresh one — which is also what the browser does.
    fireEvent.dragStart(row(0)!);
    fireEvent.drop(row(0)!);
    expect(onReparent).not.toHaveBeenCalled();

    // Onto its own child. In a browser this drop never fires at all, because
    // dragover refuses to preventDefault for it; dispatching it directly is the
    // only way to reach the second guard, and the second guard is the one that
    // matters if anything ever dispatches a drop itself.
    fireEvent.dragStart(row(0)!);
    fireEvent.drop(row(1)!);
    expect(onReparent).not.toHaveBeenCalled();

    // And a sibling is a legitimate target.
    fireEvent.dragStart(row(0)!);
    fireEvent.drop(row(4)!);
    expect(onReparent).toHaveBeenCalledWith(0, 4, 0);
  });

  describe('a drop between rows', () => {
    // The gesture the "drop onto a row" rule could not express: a position in a
    // list, rather than the end of one. Every gap is read as "immediately before
    // the row under the line", which is what gives it one meaning where the
    // depth changes — the row below is the only one whose own list the line is
    // actually inside.
    const strip = (edge: string, vob: number) => screen.getByTestId(`world-vob-drop-${edge}-${vob}`);

    function tree(onReparent: jest.Mock) {
      render(<WorldSceneTree
        summary={NESTED}
        selection={[]}
        onSelect={jest.fn()}
        onReparent={onReparent}
      />);
      // CASTLE open, so the rows are 0, 1, 2, 4 and both lists are reachable.
      fireEvent.click(screen.getByTestId('world-vob-toggle-0'));
    }

    it('lands before the row the line is under, in that row’s own list', () => {
      const onReparent = jest.fn();
      tree(onReparent);

      // WELL, a root, dropped on the line above the unnamed compo: it becomes
      // CASTLE's second child, where the compo is now.
      fireEvent.dragStart(row(4)!);
      fireEvent.drop(strip('before', 2));

      expect(onReparent).toHaveBeenCalledWith(4, 0, 1);
    });

    it('lands among the roots when the row under the line is a root', () => {
      // The case a drop *onto* a row cannot express at all: there is no row to
      // drop onto that means "a root", so before this landed the only way into
      // the root list was to have never left it.
      const onReparent = jest.fn();
      tree(onReparent);

      fireEvent.dragStart(row(1)!);
      fireEvent.drop(strip('before', 0));

      expect(onReparent).toHaveBeenCalledWith(1, null, 0);
    });

    it('appends to the last row’s list when dropped under the last row', () => {
      // The one "after" in the tree, and the reason it exists: nothing is below
      // the last row, so the gap under it belongs to no row below.
      const onReparent = jest.fn();
      tree(onReparent);

      fireEvent.dragStart(row(1)!);
      fireEvent.drop(strip('after', 4));

      // WELL is root slot 1, so after it is root slot 2.
      expect(onReparent).toHaveBeenCalledWith(1, null, 2);
    });

    it('counts the slot in the list as it will be once the VOB has left it', () => {
      // The off-by-one that is a misplaced VOB rather than an error: within one
      // list the removal vacates a slot before the insert happens, so a
      // destination later in that same list has already shifted down one.
      //
      // Three siblings, because two cannot tell the two answers apart: moving
      // the first of two before the second is where it already is, and the tree
      // refuses it as a no-op before the arithmetic is ever reached. This is the
      // shape that exercises it — A dropped before C is [B, A, C], and passing
      // the unadjusted 2 would make it [B, C, A].
      const onReparent = jest.fn();
      //  0 "P" ── 1 "A", 2 "B", 3 "C"
      render(<WorldSceneTree
        summary={summaryOf(vobIndex([
          { name: 'P' },
          { parent: 0, childIndex: 0, name: 'A' },
          { parent: 0, childIndex: 1, name: 'B' },
          { parent: 0, childIndex: 2, name: 'C' },
        ]))}
        selection={[]}
        onSelect={jest.fn()}
        onReparent={onReparent}
      />);
      fireEvent.click(screen.getByTestId('world-vob-toggle-0'));

      fireEvent.dragStart(row(1)!);
      fireEvent.drop(strip('before', 3));

      expect(onReparent).toHaveBeenCalledWith(1, 0, 1);
    });

    it('refuses a landing whose parent is inside the subtree being dragged', () => {
      // The same destruction the drop-onto rule refuses: a subtree under its own
      // descendant is unreachable from the roots, so it is not enumerated, not
      // counted and not written.
      const onReparent = jest.fn();
      tree(onReparent);
      fireEvent.click(screen.getByTestId('world-vob-toggle-2'));

      // The line above TORCH is inside the compo, which is CASTLE's own child.
      fireEvent.dragStart(row(0)!);
      fireEvent.drop(strip('before', 3));
      expect(onReparent).not.toHaveBeenCalled();

      // And its own edges are not a destination either.
      fireEvent.dragStart(row(2)!);
      fireEvent.drop(strip('before', 2));
      expect(onReparent).not.toHaveBeenCalled();
    });

    it('refuses a landing that is where the VOB already is', () => {
      // A no-op reparent is still an op: a batch, an entry in the history and a
      // full re-read of the index for a world that did not change. And it is
      // the rule that refuses a row's own edges, which is why there is no
      // separate guard for them — both of those compute the slot the VOB is in.
      const onReparent = jest.fn();
      //  0 "P" ── 1 "A", 2 "B", 3 "C"
      render(<WorldSceneTree
        summary={summaryOf(vobIndex([
          { name: 'P' },
          { parent: 0, childIndex: 0, name: 'A' },
          { parent: 0, childIndex: 1, name: 'B' },
          { parent: 0, childIndex: 2, name: 'C' },
        ]))}
        selection={[]}
        onSelect={jest.fn()}
        onReparent={onReparent}
      />);
      fireEvent.click(screen.getByTestId('world-vob-toggle-0'));

      // The line above B is where A already is — a different row, and still the
      // same world. This is the one that reaches the rule; the two below reach
      // it through a row's own edges.
      fireEvent.dragStart(row(1)!);
      fireEvent.drop(strip('before', 2));
      expect(onReparent).not.toHaveBeenCalled();

      fireEvent.dragStart(row(1)!);
      fireEvent.drop(strip('before', 1));
      expect(onReparent).not.toHaveBeenCalled();

      fireEvent.dragStart(row(3)!);
      fireEvent.drop(strip('after', 3));
      expect(onReparent).not.toHaveBeenCalled();
    });

    it('draws the insertion line in one gap, and only over a legal one', () => {
      const onReparent = jest.fn();
      tree(onReparent);

      fireEvent.dragStart(row(4)!);
      fireEvent.dragOver(strip('before', 2));
      expect(strip('before', 2)).toHaveAttribute('data-active', 'true');
      expect(strip('before', 1)).not.toHaveAttribute('data-active');

      // Moving to another gap moves the line rather than lighting a second one.
      fireEvent.dragLeave(strip('before', 2));
      fireEvent.dragOver(strip('before', 1));
      expect(strip('before', 1)).toHaveAttribute('data-active', 'true');
      expect(strip('before', 2)).not.toHaveAttribute('data-active');

      // And a gap that cannot be landed in never lights up: the drag is over
      // WELL's own position.
      fireEvent.dragLeave(strip('before', 1));
      fireEvent.dragOver(strip('before', 4));
      expect(strip('before', 4)).not.toHaveAttribute('data-active');
    });

    it('forgets a drag that ended without a drop', () => {
      // A drag abandoned outside the tree delivers no drop anywhere, so nothing
      // else ever clears it — and the next pass over a row's edge would draw an
      // insertion line for a drag that is not happening, and drop on it.
      const onReparent = jest.fn();
      tree(onReparent);

      fireEvent.dragStart(row(4)!);
      fireEvent.dragEnd(row(4)!);

      fireEvent.dragOver(strip('before', 2));
      expect(strip('before', 2)).not.toHaveAttribute('data-active');
      fireEvent.drop(strip('before', 2));
      expect(onReparent).not.toHaveBeenCalled();
    });

    it('has no strips at all on a read-only tree', () => {
      render(<WorldSceneTree summary={NESTED} selection={[]} onSelect={jest.fn()} />);
      expect(screen.queryByTestId('world-vob-drop-before-0')).not.toBeInTheDocument();
    });
  });

  it('does not drag at all when no handler is given', () => {
    // The tree is a Phase 1a read-only surface without one, and a row that
    // looks draggable but drops nowhere is worse than a row that does not.
    render(<WorldSceneTree summary={NESTED} selection={[]} onSelect={jest.fn()} />);
    expect(row(0)).not.toHaveAttribute('draggable', 'true');
  });

  it('says how many VOBs the world has, since the tree only ever shows a few', () => {
    render(<WorldSceneTree summary={NESTED} selection={[]} onSelect={jest.fn()} />);
    expect(screen.getByTestId('world-tree-count')).toHaveTextContent('5');
  });
});
