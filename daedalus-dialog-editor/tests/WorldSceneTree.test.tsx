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
import { render, screen, within } from '@testing-library/react';
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
    render(<WorldSceneTree summary={NESTED} selectedVob={null} onSelect={jest.fn()} />);

    expect(row(0)).toBeInTheDocument();
    expect(row(4)).toBeInTheDocument();
    expect(row(1)).not.toBeInTheDocument();
    expect(row(3)).not.toBeInTheDocument();
  });

  it('reveals children when a row is expanded, and hides them again', async () => {
    const user = userEvent.setup();
    render(<WorldSceneTree summary={NESTED} selectedVob={null} onSelect={jest.fn()} />);

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
    render(<WorldSceneTree summary={NESTED} selectedVob={null} onSelect={jest.fn()} />);

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
    render(<WorldSceneTree summary={unnamed} selectedVob={null} onSelect={jest.fn()} />);

    expect(within(row(0)!).getByText('NW_NATURE_HOHETANNEN_02_531P.3DS')).toBeInTheDocument();
    // Nothing to fall back to but the class, which every row carries anyway.
    expect(within(row(1)!).getByText('zCVobLight')).toBeInTheDocument();
  });

  it('reports the VOB index, not the row, when a row is clicked', async () => {
    // Names are not unique and rows move as the tree expands; the index into
    // the VobIndex is the only stable identity a VOB has.
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<WorldSceneTree summary={NESTED} selectedVob={null} onSelect={onSelect} />);

    await user.click(screen.getByTestId('world-vob-toggle-0'));
    // VOB 4 deliberately: with 0 expanded the visible rows are 0, 1, 2, 4, so
    // it sits at *position 3*. A row that reported its position would return 3
    // here and would agree with the VOB index for every other row in this tree.
    await user.click(row(4)!);

    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('expands the ancestors of a VOB selected from the viewport', () => {
    // The loop that makes the tree worth having: a click in the viewport
    // returns a VOB index and nothing else, and the row for it is three levels
    // down inside collapsed parents.
    const { rerender } = render(
      <WorldSceneTree summary={NESTED} selectedVob={null} onSelect={jest.fn()} />,
    );
    expect(row(3)).not.toBeInTheDocument();

    rerender(<WorldSceneTree summary={NESTED} selectedVob={3} onSelect={jest.fn()} />);

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
    render(<WorldSceneTree summary={many} selectedVob={null} onSelect={jest.fn()} />);

    await user.click(screen.getByTestId('world-vob-toggle-0'));

    const rendered = screen.getAllByRole('treeitem');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(200);
  });

  it('says how many VOBs the world has, since the tree only ever shows a few', () => {
    render(<WorldSceneTree summary={NESTED} selectedVob={null} onSelect={jest.fn()} />);
    expect(screen.getByTestId('world-tree-count')).toHaveTextContent('5');
  });
});
