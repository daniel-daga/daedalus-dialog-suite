/**
 * The world property grid (level-editor.md §6).
 *
 * Read-only, like everything in Phase 1a. What it has to get right is what the
 * numbers *mean*, because every one of them is a plausible-looking number in
 * the wrong convention:
 *
 *   - positions are ZenGin space, in centimetres, unconverted. The single
 *     conversion lives at the scene root (§7); a grid that showed metres would
 *     show coordinates no op could carry and no `.zen` file contains.
 *   - `flags` is a bit word, and the bits have names.
 *   - an unresolved visual is a normal fact about a world, not an error — a
 *     decal names a texture and a `.pfx` is a Daedalus instance.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VobProps } from 'zen-world';
import type { VobIndex, WorldSummary } from '../src/shared/worldTypes';
import WorldPropertyGrid from '../src/renderer/components/world/WorldPropertyGrid';

interface Spec {
  parent?: number;
  childIndex?: number;
  cls?: string;
  name?: string;
  visual?: string;
  visualType?: string;
  pos?: [number, number, number];
  rot?: number[];
  flags?: number;
}

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
    positions.set(vob.pos ?? [0, 0, 0], i * 3);
    rotations.set(vob.rot ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
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

function summaryOf(index: VobIndex): WorldSummary {
  return {
    worldPath: 'NewWorld.zen',
    bbox: [0, 0, 0, 1, 1, 1],
    vobIndex: index,
    stats: { vobCount: index.count, materials: 0, worldDrawGroups: 0, worldTriangles: 0 },
    timings: {},
  };
}

const WORLD = summaryOf(vobIndex([
  { name: 'CASTLE', cls: 'zCVob' },
  {
    parent: 0, name: 'TORCH', cls: 'zCVobLight',
    visual: 'TORCH.3DS', visualType: 'MULTI_RESOLUTION_MESH',
    // Centimetres, ZenGin space. Deliberately not round: a grid that rounded
    // to whole metres would show "0, 1, -1".
    pos: [12.5, 4400, -73.25],
    flags: 0b000011,
  },
  { parent: 0, cls: 'zCVobLevelCompo', visual: 'NW_PART_01.3DS', visualType: 'MESH' },
  { name: 'SMOKE', cls: 'zCPFXController', visual: 'PFX_SMOKE', visualType: 'PARTICLE_EFFECT' },
]));

const field = (label: string) => screen.getByTestId(`world-prop-${label}`);
/** The editable fields are inputs, so their value is not their text content. */
const input = (label: string) => screen.getByTestId(`world-prop-${label}-input`) as HTMLInputElement;

let edits: Array<VobProps> = [];
const onEdit = (props: VobProps) => { edits.push(props); };
beforeEach(() => { edits = []; });

describe('WorldPropertyGrid', () => {
  it('says nothing is selected rather than showing an empty grid', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[]} onEditProps={onEdit} />);
    expect(screen.getByTestId('world-props-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('world-prop-class')).not.toBeInTheDocument();
  });

  it('shows the identity of the selected VOB', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    expect(field('index')).toHaveTextContent('1');
    expect(field('class')).toHaveTextContent('zCVobLight');
    // Name and visual are editable now, so what they show is an input's value.
    expect(input('name').value).toBe('TORCH');
    expect(input('visual').value).toBe('TORCH.3DS');
    expect(field('visualType')).toHaveTextContent('MULTI_RESOLUTION_MESH');
  });

  it('shows the position in ZenGin centimetres, unconverted', () => {
    // The single conversion is one mirrored root node in the viewport (§7).
    // Nothing else in the codebase converts, and this grid is the place it
    // would be most tempting to.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    const position = field('position').textContent ?? '';
    expect(position).toContain('12.5');
    expect(position).toContain('4400');
    expect(position).toContain('-73.25');
  });

  it('names the flag bits instead of printing the word', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    // 0b11 is showVisual + vobStatic. Printing 3 tells nobody that a VOB is a
    // visible static, which is the whole point of naming them.
    expect(field('flags')).toHaveTextContent('showVisual');
    expect(field('flags')).toHaveTextContent('vobStatic');
    expect(field('flags')).toHaveTextContent('cdDynamic');
    expect(screen.getByTestId('world-prop-flag-showVisual')).toBeChecked();
    expect(screen.getByTestId('world-prop-flag-vobStatic')).toBeChecked();
    expect(screen.getByTestId('world-prop-flag-cdDynamic')).not.toBeChecked();
  });

  it('places the VOB in the hierarchy', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);
    expect(field('parent')).toHaveTextContent('CASTLE');

    render(<WorldPropertyGrid summary={WORLD} selection={[0]} onEditProps={onEdit} />);
    expect(screen.getAllByTestId('world-prop-parent')[1]).toHaveTextContent(/none|root/i);
    expect(screen.getAllByTestId('world-prop-children')[1]).toHaveTextContent('2');
  });

  it('explains a level compo rather than showing it as a missing mesh', () => {
    // Its visual names the source mesh a slice of the already-compiled world
    // came from, and drawing it draws the world twice. It is skipped on
    // purpose, and the grid is where someone asks why their VOB is invisible.
    render(<WorldPropertyGrid summary={WORLD} selection={[2]} onEditProps={onEdit} />);
    expect(screen.getByTestId('world-prop-note')).toHaveTextContent(/compo|not drawn|world mesh/i);
  });

  it('explains an unresolved visual as a fact, not an error', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[3]} onEditProps={onEdit} />);
    expect(screen.getByTestId('world-prop-note')).toHaveTextContent(/Daedalus|not a mesh|not in the VFS/i);
  });

  it('describes the last VOB selected, and says how many are going with it', () => {
    // The grid describes one VOB — a multi-select drag moves them all, and
    // without a count the only evidence of that is the viewport. The one it
    // describes is the last one added, which is also the one the gizmo sits on.
    render(<WorldPropertyGrid summary={WORLD} selection={[0, 1]} onEditProps={onEdit} />);

    expect(field('index')).toHaveTextContent('1');
    expect(screen.getByTestId('world-prop-selection')).toHaveTextContent('2');
  });

  it('says nothing about a selection of one', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);
    expect(screen.queryByTestId('world-prop-selection')).not.toBeInTheDocument();
  });

  it('shows no note for an ordinary drawn VOB', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);
    expect(screen.queryByTestId('world-prop-note')).not.toBeInTheDocument();
  });
});

// Editing (level-editor.md §7, `SetVobProp`). Everything below is the half of
// the op the viewport cannot show: a name, a visual and six flags, none of which
// is visible on screen the way a moved VOB is.
describe('WorldPropertyGrid, editing', () => {
  const commitName = (value: string) => {
    fireEvent.change(input('name'), { target: { value } });
    fireEvent.blur(input('name'));
  };

  it('asks for the name it was given, and only the name', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    commitName('TORCH_02');

    // Exactly one key: the op reads `from` for the keys `to` names, so a grid
    // that sent every field would make an inverse that restores fields nobody
    // edited.
    expect(edits).toEqual([{ name: 'TORCH_02' }]);
  });

  it('does not ask for an edit that changes nothing', () => {
    // Clicking into a field and out of it again is not an edit, and with fifty
    // VOBs selected it would be fifty ops on the undo stack for a batch that
    // undoes nothing — the rule the gizmo already has.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    commitName('TORCH');
    fireEvent.blur(input('visual'));

    expect(edits).toEqual([]);
  });

  it('sends one flag, not the whole word', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    fireEvent.click(screen.getByTestId('world-prop-flag-cdDynamic'));

    expect(edits).toEqual([{ cdDynamic: true }]);
  });

  it('clears a flag that was set', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    fireEvent.click(screen.getByTestId('world-prop-flag-showVisual'));

    expect(edits).toEqual([{ showVisual: false }]);
  });

  it('refuses to rename a visual the VOB does not have', () => {
    // 15,749 of the 41,393 retail VOBs carry a visual object with an empty name
    // and type UNKNOWN, and the binding refuses to name one: giving a VOB a
    // visual replaces the object and has to decide its class. Offering the
    // field and having the edit refused at the bottom of the stack is worse
    // than not offering it.
    const world = summaryOf(vobIndex([{ name: 'MARKER', visual: '', visualType: 'UNKNOWN' }]));
    render(<WorldPropertyGrid summary={world} selection={[0]} onEditProps={onEdit} />);

    expect(input('visual')).toBeDisabled();
    expect(input('name')).not.toBeDisabled();
  });

  it('reverts to the VOB\'s own value on Escape', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    fireEvent.change(input('name'), { target: { value: 'TYPED_BY_MISTAKE' } });
    fireEvent.keyDown(input('name'), { key: 'Escape' });

    expect(input('name').value).toBe('TORCH');
    expect(edits).toEqual([]);
  });

  it('commits on Enter without waiting for a blur', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />);

    fireEvent.change(input('name'), { target: { value: 'TORCH_03' } });
    fireEvent.keyDown(input('name'), { key: 'Enter' });

    expect(edits).toEqual([{ name: 'TORCH_03' }]);
  });

  it('follows the value when the world changes under it — an undo, not a click', () => {
    // Found by driving the real app: an uncontrolled input keeps what it has
    // unless something resets it, and a key on the *VOB* does not change when
    // an undo changes that VOB's name. The panel then goes on showing a name
    // the world no longer has — and writes it back on the next blur.
    //
    // The selection-change test below passed the whole time, because its
    // fixture only ever moved the selection. Changing the value is what tells
    // the two apart.
    const world = summaryOf(vobIndex([{ name: 'BEFORE', visual: 'A.3DS' }]));
    const { rerender } = render(
      <WorldPropertyGrid summary={world} selection={[0]} onEditProps={onEdit} />,
    );
    expect(input('name').value).toBe('BEFORE');

    const undone = summaryOf(vobIndex([{ name: 'AFTER', visual: 'A.3DS' }]));
    rerender(<WorldPropertyGrid summary={undone} selection={[0]} onEditProps={onEdit} />);

    expect(input('name').value).toBe('AFTER');
  });

  it('shows the next VOB\'s values when the selection moves, not the last one\'s', () => {
    // An uncontrolled input keeps whatever was typed into it unless it is reset,
    // so this is the defect that puts one VOB's name in another VOB's field —
    // and then writes it there on the next blur.
    const { rerender } = render(
      <WorldPropertyGrid summary={WORLD} selection={[1]} onEditProps={onEdit} />,
    );
    fireEvent.change(input('name'), { target: { value: 'NEVER_COMMITTED' } });

    rerender(<WorldPropertyGrid summary={WORLD} selection={[0]} onEditProps={onEdit} />);

    expect(input('name').value).toBe('CASTLE');
  });

  it('says an edit will take the whole selection with it', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[0, 1]} onEditProps={onEdit} />);
    expect(screen.getByTestId('world-prop-edit-scope')).toHaveTextContent(/2/);
  });
});
