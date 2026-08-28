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
import {
  eulerDeltaRotation, eulerToZenRotation,
  type ClassProps, type VobProps, type ZenRotation,
} from 'zen-world';
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
  { name: 'SWORD', cls: 'oCItem', visual: 'ITMW_1H_SWORD_01.3DS' },
  // The two classes that carry the `bool` and `int` kinds. Neither has a visual
  // — a zone is invisible in the viewport, which is why every field of it is
  // only ever seen here.
  { name: 'NW_MUSIC', cls: 'oCZoneMusic', visualType: 'UNKNOWN' },
  { name: 'NW_FOG', cls: 'zCZoneZFog', visualType: 'UNKNOWN' },
]));

/**
 * What the per-class read answers for VOB 1, in the shape `getVobProps` sends
 * it: the **whole** props object, base fields and all, because it is the same
 * reader `normalizeWorld` uses. The grid picks the catalogued keys out of it
 * rather than being handed a pre-filtered record — a filter on the way in would
 * be a fourth allowlist beside the three the catalogue exists to replace.
 */
/** Every read carries these three, whatever the class: they are `zCVob`'s own
 *  and the props object is the whole of what the VOB holds. */
const BASE_READ = { presetName: '', visualCamAlign: 0, bias: 0 };
const LIGHT: ClassProps = {
  class: 'zCVobLight', range: 2000, color: [255, 220, 180, 255], lightType: 0, ...BASE_READ,
};
const ITEM: ClassProps = { class: 'oCItem', instance: 'ITMW_1H_SWORD_01', ...BASE_READ };
const MUSIC: ClassProps = {
  class: 'oCZoneMusic',
  enabled: true, priority: 2, ellipsoid: false, reverb: -30, volume: 0.5, loop: true,
  ...BASE_READ,
};
const FOG: ClassProps = {
  class: 'zCZoneZFog',
  rangeCenter: 12000, innerRangePercentage: 0.5,
  fadeOutSky: true, overrideColor: false, color: [120, 130, 140, 255],
  ...BASE_READ,
};

const field = (label: string) => screen.getByTestId(`world-prop-${label}`);
/** The editable fields are inputs, so their value is not their text content. */
const input = (label: string) => screen.getByTestId(`world-prop-${label}-input`) as HTMLInputElement;

let edits: Array<VobProps> = [];
const onEdit = (props: VobProps) => { edits.push(props); };
let classEdits: Array<ClassProps> = [];
const onEditClass = (props: ClassProps) => { classEdits.push(props); };
/** The base fields that have no column — `presetName`, `visualCamAlign`,
 *  `bias`. A separate spy because they leave by a separate handler: like a class
 *  field they need the fetched props as their `from`, so they are the described
 *  VOB's alone where a flag is the whole selection's. */
let baseEdits: Array<VobProps> = [];
const onEditBase = (props: VobProps) => { baseEdits.push(props); };
/** A typed coordinate arrives as a *delta*, which is the gizmo's own shape. */
let moves: Array<[number, number, number]> = [];
const onTranslate = (delta: [number, number, number]) => { moves.push(delta); };
/** A typed angle arrives as an *absolute* rotation for a single selection —
 *  `rotateVob`'s shape. */
let rotates: Array<ZenRotation> = [];
const onRotate = (to: ZenRotation) => { rotates.push(to); };
/** ...and as a *delta* for a multi-selection — `rotateVobs`' shape, the one a
 *  gizmo drag arrives in. The two are separate spies because sending the wrong
 *  one is the whole failure mode: an absolute matrix down the selection path
 *  would stack N VOBs into one pose. */
let turns: Array<ZenRotation> = [];
const onRotateSelection = (delta: ZenRotation) => { turns.push(delta); };
beforeEach(() => {
  edits = []; classEdits = []; baseEdits = []; moves = []; rotates = []; turns = [];
});

/** The wiring every render needs. `classProps` is null by default because that
 *  is what a VOB of an uncatalogued class gets — nothing is fetched for one —
 *  and the tests that are about the class section hand it values themselves. */
const wiring = {
  onEditProps: onEdit,
  onEditClassProps: onEditClass,
  onEditBaseProps: onEditBase,
  classProps: null,
  onTranslate,
  onRotate,
  onRotateSelection,
  /** Bumped by the shell in `commitOps`' catch when the main process refuses an
   *  edit — the tests that are about refusal hand it a bumped value themselves. */
  refusalGeneration: 0,
  /** No script project loaded, which is what a world opened on its own has —
   *  the tests that are about the item index hand it names themselves. */
  itemInstances: new Set<string>(),
};

describe('WorldPropertyGrid', () => {
  it('says nothing is selected rather than showing an empty grid', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[]} {...wiring} />);
    expect(screen.getByTestId('world-props-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('world-prop-class')).not.toBeInTheDocument();
  });

  it('shows the identity of the selected VOB', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

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
    // would be most tempting to. The coordinates are typed entry now, so what
    // they show is three inputs' values rather than the row's text.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    expect(input('position-x').value).toBe('12.5');
    expect(input('position-y').value).toBe('4400');
    expect(input('position-z').value).toBe('-73.25');
  });

  it('names the flag bits instead of printing the word', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

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
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);
    expect(field('parent')).toHaveTextContent('CASTLE');

    render(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} />);
    expect(screen.getAllByTestId('world-prop-parent')[1]).toHaveTextContent(/none|root/i);
    expect(screen.getAllByTestId('world-prop-children')[1]).toHaveTextContent('2');
  });

  it('explains a level compo rather than showing it as a missing mesh', () => {
    // Its visual names the source mesh a slice of the already-compiled world
    // came from, and drawing it draws the world twice. It is skipped on
    // purpose, and the grid is where someone asks why their VOB is invisible.
    render(<WorldPropertyGrid summary={WORLD} selection={[2]} {...wiring} />);
    expect(screen.getByTestId('world-prop-note')).toHaveTextContent(/compo|not drawn|world mesh/i);
  });

  it('explains an unresolved visual as a fact, not an error', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[3]} {...wiring} />);
    expect(screen.getByTestId('world-prop-note')).toHaveTextContent(/Daedalus|not a mesh|not in the VFS/i);
  });

  it('describes the last VOB selected, and says how many are going with it', () => {
    // The grid describes one VOB — a multi-select drag moves them all, and
    // without a count the only evidence of that is the viewport. The one it
    // describes is the last one added, which is also the one the gizmo sits on.
    render(<WorldPropertyGrid summary={WORLD} selection={[0, 1]} {...wiring} />);

    expect(field('index')).toHaveTextContent('1');
    expect(screen.getByTestId('world-prop-selection')).toHaveTextContent('2');
  });

  it('says nothing about a selection of one', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);
    expect(screen.queryByTestId('world-prop-selection')).not.toBeInTheDocument();
  });

  it('shows no note for an ordinary drawn VOB', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);
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
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

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
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    commitName('TORCH');
    fireEvent.blur(input('visual'));

    expect(edits).toEqual([]);
  });

  it('sends one flag, not the whole word', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    fireEvent.click(screen.getByTestId('world-prop-flag-cdDynamic'));

    expect(edits).toEqual([{ cdDynamic: true }]);
  });

  it('clears a flag that was set', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

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
    render(<WorldPropertyGrid summary={world} selection={[0]} {...wiring} />);

    expect(input('visual')).toBeDisabled();
    expect(input('name')).not.toBeDisabled();
  });

  it('reverts to the VOB\'s own value on Escape', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    fireEvent.change(input('name'), { target: { value: 'TYPED_BY_MISTAKE' } });
    fireEvent.keyDown(input('name'), { key: 'Escape' });

    expect(input('name').value).toBe('TORCH');
    expect(edits).toEqual([]);
  });

  it('commits on Enter without waiting for a blur', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

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
      <WorldPropertyGrid summary={world} selection={[0]} {...wiring} />,
    );
    expect(input('name').value).toBe('BEFORE');

    const undone = summaryOf(vobIndex([{ name: 'AFTER', visual: 'A.3DS' }]));
    rerender(<WorldPropertyGrid summary={undone} selection={[0]} {...wiring} />);

    expect(input('name').value).toBe('AFTER');
  });

  it('shows the next VOB\'s values when the selection moves, not the last one\'s', () => {
    // An uncontrolled input keeps whatever was typed into it unless it is reset,
    // so this is the defect that puts one VOB's name in another VOB's field —
    // and then writes it there on the next blur.
    const { rerender } = render(
      <WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />,
    );
    fireEvent.change(input('name'), { target: { value: 'NEVER_COMMITTED' } });

    rerender(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} />);

    expect(input('name').value).toBe('CASTLE');
  });

  it('says an edit will take the whole selection with it', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[0, 1]} {...wiring} />);
    expect(screen.getByTestId('world-prop-edit-scope')).toHaveTextContent(/2/);
  });
});

// The per-class fields (level-editor.md §14.1 item 1.4, `SetVobClassProp`).
//
// These are the first values in this panel that do **not** come out of the
// columnar index: the index interns a class *name* and carries not one field of
// the class, so they are fetched over IPC and arrive as a prop. That is what
// every test below has to keep straight — the grid renders what it was handed,
// and null means "not here yet", never "empty".
describe('WorldPropertyGrid, class fields', () => {
  it('draws the fields of the VOB\'s own class, and nothing from another', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} classProps={LIGHT} />);

    expect(input('class-range').value).toBe('2000');
    // Four channels, in the order the archive holds them.
    expect(input('class-color').value).toBe('255, 220, 180, 255');
    // `instance` is an oCItem's, and this is a light. A grid keyed on the props
    // object rather than the catalogue would draw whatever the read answered.
    expect(screen.queryByTestId('world-prop-class-instance')).not.toBeInTheDocument();
    // And nothing the catalogue does not have, however much of it the read sent.
    expect(screen.queryByTestId('world-prop-class-lightType')).not.toBeInTheDocument();
  });

  it('draws an item\'s instance', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[4]} {...wiring} classProps={ITEM} />);
    expect(input('class-instance').value).toBe('ITMW_1H_SWORD_01');
  });

  it('draws no class section at all for a class the catalogue does not have', () => {
    // 37 classes in a retail world, two of them here. The rest are not an error
    // and not an empty section — there is nothing this panel can write on them.
    render(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} classProps={{ class: 'zCVob', ...BASE_READ }} />);
    expect(screen.queryByTestId('world-prop-class-section')).not.toBeInTheDocument();
  });

  it('waits rather than showing empty fields before the values arrive', () => {
    // The fetch is one IPC round trip behind the selection. An empty field here
    // reads as "this light has no range", and blurring it would write that.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    expect(screen.getByTestId('world-prop-class-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('world-prop-class-range-input')).not.toBeInTheDocument();
  });

  it('asks for exactly the one key that changed', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} classProps={LIGHT} />);

    fireEvent.change(input('class-range'), { target: { value: '3000' } });
    fireEvent.blur(input('class-range'));

    // Not `{ range, color }`: the op reads `from` for the keys `to` names, and a
    // grid that sent both would build an inverse restoring a colour nobody
    // touched.
    expect(classEdits).toEqual([{ range: 3000 }]);
  });

  it('parses a colour back into four channels', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} classProps={LIGHT} />);

    fireEvent.change(input('class-color'), { target: { value: '255, 0, 180, 255' } });
    fireEvent.blur(input('class-color'));

    expect(classEdits).toEqual([{ color: [255, 0, 180, 255] }]);
  });

  it('refuses a value the field cannot hold instead of sending it down', () => {
    // The bounds are in the catalogue precisely so this side can reject before
    // an op exists. A negative range and a three-channel colour are both refused
    // in C++ too — at the bottom of a batch that may already have applied.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} classProps={LIGHT} />);

    fireEvent.change(input('class-range'), { target: { value: 'bright' } });
    fireEvent.blur(input('class-range'));
    fireEvent.change(input('class-range'), { target: { value: '-5' } });
    fireEvent.blur(input('class-range'));
    fireEvent.change(input('class-color'), { target: { value: '255, 0, 180' } });
    fireEvent.blur(input('class-color'));
    fireEvent.change(input('class-color'), { target: { value: '255, 0, 180, 900' } });
    fireEvent.blur(input('class-color'));

    expect(classEdits).toEqual([]);
    // And the field shows the value the world has again, rather than the one it
    // just refused to write — the same rule Escape follows.
    expect(input('class-range').value).toBe('2000');
    expect(input('class-color').value).toBe('255, 220, 180, 255');
  });

  it('refuses a colour with an emptied channel rather than reading it as zero', () => {
    // `Number('')` is 0, which the float branch already refuses for its own
    // field. A typo that dropped a channel would otherwise be an accepted edit
    // that writes a green of 0 — and the refusal counter exists so that a value
    // this panel will not write is visibly not written.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} classProps={LIGHT} />);

    fireEvent.change(input('class-color'), { target: { value: '255,,180,255' } });
    fireEvent.blur(input('class-color'));

    expect(classEdits).toEqual([]);
    expect(input('class-color').value).toBe('255, 220, 180, 255');
  });

  // The item index (level-editor.md §14.1, the board's "SetVobClassProp writes
  // oCItem.instance as free text" card). An `oCItem` spawns the Daedalus
  // instance it names and ZenGin crashes on one no script declares, so this is
  // the one class field whose legal values are a set the app already knows —
  // when a script project is loaded. When one is not, it knows nothing, and
  // refusing on an empty index would take the field away from anybody editing a
  // world on its own.
  const ITEMS = new Set(['ITMW_1H_SWORD_01', 'ITMW_2H_AXE_01']);

  it('refuses an item instance no loaded script declares', () => {
    render(
      <WorldPropertyGrid summary={WORLD} selection={[4]} {...wiring} classProps={ITEM} itemInstances={ITEMS} />,
    );

    // One transposition away from a real name — the typo the engine crashes on,
    // and the one no shape check can catch.
    fireEvent.change(input('class-instance'), { target: { value: 'ITMW_1H_SWROD_01' } });
    fireEvent.blur(input('class-instance'));

    expect(classEdits).toEqual([]);
    // And the field shows the instance the world has again, rather than the one
    // it just refused to write.
    expect(input('class-instance').value).toBe('ITMW_1H_SWORD_01');
  });

  it('takes a declared instance whatever its case, because Daedalus is case-insensitive', () => {
    // The parser keys `items` by the name as it was *written*, so a lookup that
    // compared verbatim would refuse `itmw_2h_axe_01` — which names the same
    // symbol and is what a user typing from memory writes.
    render(
      <WorldPropertyGrid summary={WORLD} selection={[4]} {...wiring} classProps={ITEM} itemInstances={ITEMS} />,
    );

    fireEvent.change(input('class-instance'), { target: { value: 'itmw_2h_axe_01' } });
    fireEvent.blur(input('class-instance'));

    // Committed as typed: the case the user chose is the case the world gets,
    // exactly as the free-text field always did.
    expect(classEdits).toEqual([{ instance: 'itmw_2h_axe_01' }]);
  });

  it('writes any instance at all when no script project is loaded', () => {
    // A world can legitimately be opened with no project behind it, and an empty
    // index is "nothing is known", never "nothing is legal". The field is free
    // text again, exactly as it was before the index existed.
    render(
      <WorldPropertyGrid summary={WORLD} selection={[4]} {...wiring} classProps={ITEM} itemInstances={new Set()} />,
    );

    fireEvent.change(input('class-instance'), { target: { value: 'ITMW_1H_SWROD_01' } });
    fireEvent.blur(input('class-instance'));

    expect(classEdits).toEqual([{ instance: 'ITMW_1H_SWROD_01' }]);
  });

  it('checks the instance and nothing else against the index', () => {
    // The index is item instances. A light's range is a number and a sound name
    // is a file in the VFS; neither is in it, and a check that ran on every
    // string field would refuse both.
    render(
      <WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} classProps={LIGHT} itemInstances={ITEMS} />,
    );

    fireEvent.change(input('class-range'), { target: { value: '3000' } });
    fireEvent.blur(input('class-range'));

    expect(classEdits).toEqual([{ range: 3000 }]);
  });

  it('says what the instance field is checked against, rather than refusing silently', () => {
    const checked = render(
      <WorldPropertyGrid summary={WORLD} selection={[4]} {...wiring} classProps={ITEM} itemInstances={ITEMS} />,
    );
    expect(field('class-instance')).toHaveTextContent(/item instance/i);
    checked.unmount();

    // …and says nothing when there is no index to check against, because then
    // there is no rule to explain.
    render(
      <WorldPropertyGrid summary={WORLD} selection={[4]} {...wiring} classProps={ITEM} itemInstances={new Set()} />,
    );
    expect(field('class-instance')).not.toHaveTextContent(/item instance/i);
  });

  it('says the class section is about the primary VOB alone', () => {
    // Every other edit in this panel takes the whole selection with it. This one
    // cannot: each VOB would need its own fetched `from`, and a selection can
    // hold mixed classes. The note is the difference being visible.
    render(<WorldPropertyGrid summary={WORLD} selection={[0, 1]} {...wiring} classProps={LIGHT} />);

    expect(screen.getByTestId('world-prop-class-scope')).toHaveTextContent(/only|alone|primary/i);
  });

  it('says nothing about scope when one VOB is selected', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} classProps={LIGHT} />);
    expect(screen.queryByTestId('world-prop-class-scope')).not.toBeInTheDocument();
  });

  // The `bool` and `int` kinds (level-editor.md §14.1 item 1.4). A boolean is a
  // checkbox and not a field reading "true", because "true"/"1"/"yes" is a
  // parsing problem this panel would be inventing for itself; an integer is a
  // typed field with an integer refusal, because there is nothing to click.
  it('draws a boolean as a checkbox showing the value the world has', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[5]} {...wiring} classProps={MUSIC} />);

    expect(input('class-enabled').checked).toBe(true);
    expect(input('class-ellipsoid').checked).toBe(false);
    expect(input('class-loop').checked).toBe(true);
    // A checkbox is not a text field, so nothing here should have parsed the
    // value into one.
    expect(input('class-enabled').type).toBe('checkbox');
  });

  it('commits the flipped boolean, and only that key', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[5]} {...wiring} classProps={MUSIC} />);

    fireEvent.click(input('class-ellipsoid'));
    fireEvent.click(input('class-enabled'));

    // The same rule every other field in this panel follows: the op reads `from`
    // for exactly the keys `to` names, so a grid that posted the other five
    // booleans would build an inverse restoring values nobody edited.
    expect(classEdits).toEqual([{ ellipsoid: true }, { enabled: false }]);
  });

  it('takes a whole number for an int field and refuses a fraction', () => {
    // `priority` is an `int32_t` in the archive. Sent as 2.5 it would truncate
    // on the cast in C++ and report success, so the refusal is here — before an
    // op exists — exactly as the float bounds are.
    render(<WorldPropertyGrid summary={WORLD} selection={[5]} {...wiring} classProps={MUSIC} />);

    fireEvent.change(input('class-priority'), { target: { value: '7' } });
    fireEvent.blur(input('class-priority'));
    expect(classEdits).toEqual([{ priority: 7 }]);

    for (const bad of ['2.5', '-1', 'high', '']) {
      fireEvent.change(input('class-priority'), { target: { value: bad } });
      fireEvent.blur(input('class-priority'));
    }
    expect(classEdits).toEqual([{ priority: 7 }]);
    // And the refused field is showing the world's own value again.
    expect(input('class-priority').value).toBe('2');
  });

  it('draws a fog zone\'s overrideColor immediately above the colour it governs', () => {
    // ZenGin reads `zCZoneZFog.color` only while `overrideColor` is true. The
    // colour shipped a release before its switch did, and a colour edit on a
    // zone that does not override reads to a user as the editor having done
    // nothing — so the adjacency is the whole of what makes the pair legible.
    render(<WorldPropertyGrid summary={WORLD} selection={[6]} {...wiring} classProps={FOG} />);

    const section = screen.getByTestId('world-prop-class-section');
    const drawn = Array.from(section.querySelectorAll('[data-testid^="world-prop-class-"]'))
      .map((node) => node.getAttribute('data-testid'))
      // The control inside each row carries the same prefix plus `-input`; the
      // rows are what this is about.
      .filter((id) => id !== null && !id.endsWith('-input'));
    expect(drawn).toEqual([
      'world-prop-class-rangeCenter', 'world-prop-class-innerRangePercentage',
      'world-prop-class-fadeOutSky', 'world-prop-class-overrideColor', 'world-prop-class-color',
    ]);
    expect(input('class-overrideColor').checked).toBe(false);
  });
});

// Typed transform entry (level-editor.md §14.1 item 1.5).
//
// The coordinates were read-only monospace text; Spacer takes them typed. What
// this has to get right is that a typed coordinate is *the same edit the gizmo
// makes* — it leaves as a delta, so it goes down `translateVobs` and reaches
// undo, the history barrier and the atomic batch by the one path that already
// exists, rather than by a second one that would have to be kept in step.
//
// Rotation is typed entry too now — its own describe below, because it leaves
// as an *absolute* matrix through `zen-world/coords` rather than as a delta.
describe('WorldPropertyGrid, the base fields with no column', () => {
  // `presetName`, `visualCamAlign` and `bias` are on every `zCVob` and in none
  // of the index's columns, so they arrive with the class read and are drawn for
  // every class — including the 35 of 37 that have no class section at all.
  const BASE: ClassProps = {
    class: 'zCVob', presetName: 'FIRE_STAT', visualCamAlign: 1, bias: 2,
  };

  it('draws all three for a class the catalogue has no fields for', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} classProps={BASE} />);

    expect(input('base-presetName').value).toBe('FIRE_STAT');
    expect(input('base-visualCamAlign').value).toBe('1');
    expect(input('base-bias').value).toBe('2');
    // The class section is a different question and this VOB still has none.
    expect(screen.queryByTestId('world-prop-class-section')).not.toBeInTheDocument();
  });

  it('waits rather than showing empty fields before the read arrives', () => {
    // An empty preset name here reads as "this VOB has none", and blurring it
    // would write that.
    render(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} />);

    expect(screen.getByTestId('world-prop-base-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('world-prop-base-bias-input')).not.toBeInTheDocument();
  });

  it('asks for exactly the one key that changed', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} classProps={BASE} />);

    fireEvent.change(input('base-bias'), { target: { value: '7' } });
    fireEvent.blur(input('base-bias'));

    expect(baseEdits).toEqual([{ bias: 7 }]);
    // Not down the flag path: that one takes the whole selection and reads its
    // `from` out of the index, which has no column for this.
    expect(edits).toEqual([]);
  });

  it('clears a preset name, which is a value and not an absence', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} classProps={BASE} />);

    fireEvent.change(input('base-presetName'), { target: { value: '' } });
    fireEvent.blur(input('base-presetName'));

    expect(baseEdits).toEqual([{ presetName: '' }]);
  });

  it('refuses a number the packed vob layout cannot hold', () => {
    // Two bits and five bits: 32 is written as 0 by the packed writer and
    // reported as written, which is why the refusal is here and not only in C++.
    render(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} classProps={BASE} />);

    for (const bad of ['32', '-1', '1.5', 'near']) {
      fireEvent.change(input('base-bias'), { target: { value: bad } });
      fireEvent.blur(input('base-bias'));
    }
    for (const bad of ['4', '-1', '0.5']) {
      fireEvent.change(input('base-visualCamAlign'), { target: { value: bad } });
      fireEvent.blur(input('base-visualCamAlign'));
    }

    expect(baseEdits).toEqual([]);
    // 3 is one past the enum's three named values and is what 7 retail VOBs
    // hold, so it is taken: the inverse of an edit on one of them writes it.
    fireEvent.change(input('base-visualCamAlign'), { target: { value: '3' } });
    fireEvent.blur(input('base-visualCamAlign'));
    expect(baseEdits).toEqual([{ visualCamAlign: 3 }]);
  });

  it('says a base edit is the described VOB alone, not the selection', () => {
    // The described VOB is the last of the selection — the one the gizmo
    // anchors on — so the props handed in are that one's.
    render(<WorldPropertyGrid summary={WORLD} selection={[1, 0]} {...wiring} classProps={BASE} />);
    expect(screen.getByTestId('world-prop-base-scope')).toBeInTheDocument();
  });
});

describe('WorldPropertyGrid, typed position', () => {
  const commitCoordinate = (axis: string, value: string) => {
    fireEvent.change(input(`position-${axis}`), { target: { value } });
    fireEvent.blur(input(`position-${axis}`));
  };

  it('sends the difference on one axis, and nothing on the other two', () => {
    // A delta and not a destination, because that is what a drag of a
    // multi-select produces: the VOBs keep the spacing they had, and each op
    // still carries its own VOB's origin.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    commitCoordinate('x', '112.5');

    expect(moves).toEqual([[100, 0, 0]]);
  });

  it('moves a coordinate that is negative in the file', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    commitCoordinate('z', '-70.25');

    expect(moves).toEqual([[0, 0, 3]]);
  });

  it('commits on Enter without waiting for a blur', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    fireEvent.change(input('position-y'), { target: { value: '4500' } });
    fireEvent.keyDown(input('position-y'), { key: 'Enter' });

    expect(moves).toEqual([[0, 100, 0]]);
  });

  it('reverts to the VOB\'s own coordinate on Escape', () => {
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    fireEvent.change(input('position-x'), { target: { value: '999' } });
    fireEvent.keyDown(input('position-x'), { key: 'Escape' });

    expect(input('position-x').value).toBe('12.5');
    expect(moves).toEqual([]);
  });

  it('refuses a coordinate that is not a number, before an op exists', () => {
    // Refused here rather than committed and rejected: an op that reached the
    // batch would be refused by the binding halfway through one that may
    // already have applied. The field shows the world's own value again, which
    // is the same rule Escape follows.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    commitCoordinate('x', 'over there');
    commitCoordinate('y', '');
    // Float32 is what the archive holds and what the binding takes; a magnitude
    // it cannot hold would arrive as an Infinity.
    commitCoordinate('z', '1e39');

    expect(moves).toEqual([]);
    expect(input('position-x').value).toBe('12.5');
    expect(input('position-y').value).toBe('4400');
    expect(input('position-z').value).toBe('-73.25');
  });

  it('sends nothing when the number typed is the number already there', () => {
    // "12.50" is different text and the same coordinate. Sent, it would be a
    // zero-delta op on the undo stack for every VOB in the selection — the rule
    // the name field and the gizmo both already have.
    render(<WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />);

    commitCoordinate('x', '12.50');

    expect(moves).toEqual([]);
  });

  it('shows the next VOB\'s coordinates when the selection moves', () => {
    // The same uncontrolled-input trap the name field has: a half-typed
    // coordinate must not follow the selection and be written on the next blur.
    const { rerender } = render(
      <WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />,
    );
    fireEvent.change(input('position-x'), { target: { value: '999' } });

    rerender(<WorldPropertyGrid summary={WORLD} selection={[0]} {...wiring} />);

    expect(input('position-x').value).toBe('0');
  });

  it('shows the world\'s own value again after the main process refuses an edit', () => {
    // The live bug (refactoring-targets.md §7): a refused edit was corrected by
    // the field remounting through a key that carries the value — but a
    // main-process refusal changes nothing in the world, so the key never
    // changed, and the uncontrolled input went on showing the number the user
    // typed as though it had been taken. The shell now bumps a refusal
    // generation in `commitOps`' catch, and the grid folds it into every
    // editable field's key: the remount is a rule rather than a value change.
    const { rerender } = render(
      <WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />,
    );

    fireEvent.change(input('position-x'), { target: { value: '999' } });
    fireEvent.blur(input('position-x'));
    expect(moves).toEqual([[986.5, 0, 0]]);

    // The main process refused the op: nothing in the world changed — the
    // summary is the same object — and the only thing the shell has to say
    // about it is the bumped generation.
    rerender(
      <WorldPropertyGrid
        summary={WORLD}
        selection={[1]}
        {...wiring}
        refusalGeneration={1}
      />,
    );

    expect(input('position-x').value).toBe('12.5');
  });

  it('puts a refused name back too, not only a coordinate', () => {
    // The name and the visual read from the same columnar index the position
    // does, so they had the same bug for the same reason: no unmount, no key
    // change, a typed name kept on screen after the world refused it.
    const { rerender } = render(
      <WorldPropertyGrid summary={WORLD} selection={[1]} {...wiring} />,
    );

    fireEvent.change(input('name'), { target: { value: 'REFUSED_NAME' } });
    fireEvent.blur(input('name'));
    expect(edits).toEqual([{ name: 'REFUSED_NAME' }]);

    rerender(
      <WorldPropertyGrid
        summary={WORLD}
        selection={[1]}
        {...wiring}
        refusalGeneration={1}
      />,
    );

    expect(input('name').value).toBe('TORCH');
  });

});

// Typed rotation entry (level-editor.md §14.1 item 1.5, the rotation half).
//
// A `zCVob` stores a row-major 3x3; a level designer types three angles. The
// conversion is `zen-world/coords`' — intrinsic Y-X-Z, degrees, canonical
// ranges yaw/roll (-180, 180], pitch [-90, 90] — and the grid's whole job is
// to use it without inventing a second convention beside it.
//
// The trap this suite pins hardest: **the read normalizes.** 30.2 % of retail
// VOBs are non-orthonormal, so `eulerToZenRotation(zenRotationToEuler(M))`
// differs from `M` for a third of the world — a commit of an angle the user
// did not change would re-orthonormalize the matrix and rewrite bytes nobody
// asked for. The refusal of a value equal to the displayed one is therefore
// applied per angle, exactly as the position fields refuse an unchanged
// coordinate.
describe('WorldPropertyGrid, typed rotation', () => {
  // A quarter turn about the vertical, stored exactly: Ry(90) in row-major is
  // [0,0,1, 0,1,0, -1,0,0], every entry exact in float32, so the decomposition
  // answers 90/0/0 without float noise.
  const YAW_90 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  // The retail case: a matrix that is a rotation times a small uniform drift —
  // non-orthonormal, as 12,514 of 41,393 retail VOBs are. Reading it shows the
  // nearest rotation's angles; committing one of them unchanged would silently
  // replace the matrix with the orthonormalized one.
  const cy = Math.cos(Math.PI / 6);
  const SKEWED = [cy * 1.02, 0, 0.5 * 1.02, 0, 1.02, 0, -0.5 * 1.02, 0, cy * 1.02];
  const ROTATIONS = summaryOf(vobIndex([
    { name: 'PLAIN' }, // identity
    { name: 'TURNED', rot: YAW_90 },
    { name: 'SKEWED', rot: SKEWED },
    // A reflection: det -1, which no triple of angles describes. Retail has
    // none, but an uncaught throw in a render path is a blank grid.
    { name: 'MIRRORED', rot: [-1, 0, 0, 0, 1, 0, 0, 0, 1] },
    // A collapsed matrix: no three independent axes.
    { name: 'FLAT', rot: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ]));

  const commitAngle = (axis: string, value: string) => {
    fireEvent.change(input(`rotation-${axis}`), { target: { value } });
    fireEvent.blur(input(`rotation-${axis}`));
  };

  it('shows the stored rotation as yaw, pitch and roll in degrees', () => {
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[1]} {...wiring} />);

    expect(input('rotation-yaw').value).toBe('90');
    expect(input('rotation-pitch').value).toBe('0');
    expect(input('rotation-roll').value).toBe('0');
  });

  it('commits an absolute rotation with the one angle that changed', () => {
    // Absolute, not a delta: the board's shape for a single selection is
    // `rotateVob(..., eulerToZenRotation(typed), bounds)`. Compared exactly,
    // because the expectation is computed by the very function the grid uses.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[0]} {...wiring} />);

    commitAngle('yaw', '90');

    expect(rotates).toEqual([eulerToZenRotation([90, 0, 0])]);
  });

  it('keeps the other two angles as they were', () => {
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[1]} {...wiring} />);

    commitAngle('pitch', '10');

    expect(rotates).toHaveLength(1);
    const expected = eulerToZenRotation([90, 10, 0]);
    rotates[0].forEach((entry, at) => expect(entry).toBeCloseTo(expected[at], 10));
  });

  it('refuses an angle equal to the one displayed, per angle', () => {
    // THE trap: this VOB's matrix is non-orthonormal, so committing the very
    // angle on screen would re-orthonormalize it and change bytes nobody asked
    // to change. The refusal is per angle — "30.0" is different text and the
    // same angle.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[2]} {...wiring} />);
    expect(input('rotation-yaw').value).toBe('30');

    commitAngle('yaw', '30');
    commitAngle('yaw', '30.0');
    commitAngle('pitch', '0');
    commitAngle('roll', '0');

    expect(rotates).toEqual([]);
  });

  it('refuses an angle that is not a number, and shows the world\'s own again', () => {
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[1]} {...wiring} />);

    commitAngle('yaw', 'north');
    commitAngle('pitch', '');

    expect(rotates).toEqual([]);
    expect(input('rotation-yaw').value).toBe('90');
    expect(input('rotation-pitch').value).toBe('0');
  });

  it('does not keep a typed angle the main process refused', () => {
    // The same rule the position fields got: a refusal changes nothing in the
    // world, so only the bumped generation remounts the field.
    const { rerender } = render(
      <WorldPropertyGrid summary={ROTATIONS} selection={[0]} {...wiring} />,
    );

    commitAngle('yaw', '45');
    expect(rotates).toHaveLength(1);

    rerender(
      <WorldPropertyGrid
        summary={ROTATIONS}
        selection={[0]}
        {...wiring}
        refusalGeneration={1}
      />,
    );

    expect(input('rotation-yaw').value).toBe('0');
  });

  it('offers angle entry for a multi-selection, showing the anchor VOB\'s own angles', () => {
    // Decided 2026-08-28 (level-editor.md §16.4): a typed angle turns each
    // selected VOB by that much from where it is, so the fields are offered for
    // N VOBs and describe the anchor — the last VOB of the selection, the one
    // every other row of this grid already describes.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[0, 1]} {...wiring} />);

    expect(input('rotation-yaw').value).toBe('90');
    expect(input('rotation-pitch').value).toBe('0');
    expect(input('rotation-roll').value).toBe('0');
  });

  it('commits a delta for a multi-selection, not an absolute pose', () => {
    // The whole decision, in one assertion: relative, like the position fields,
    // so the selection keeps the relative orientation it had. An absolute
    // matrix down this path would snap all N VOBs to one pose with nothing but
    // undo to get back. Expected as a quarter-turn matrix written out, not as
    // the implementation's own product.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[0, 1]} {...wiring} />);

    commitAngle('yaw', '180');

    expect(rotates).toEqual([]);
    expect(turns).toHaveLength(1);
    // The anchor is at yaw 90; typing 180 is a further quarter turn about the
    // vertical, which is Ry(90) = [0,0,1, 0,1,0, -1,0,0] in ZenGin row-major.
    [0, 0, 1, 0, 1, 0, -1, 0, 0].forEach((entry, at) => {
      expect(turns[0][at]).toBeCloseTo(entry, 10);
    });
  });

  it('builds the delta from the angles on screen, not from the anchor\'s stored matrix', () => {
    // The trap the read normalizes into: the anchor here is non-orthonormal by
    // 2 %, and a delta built as `R(to) * M^-1` would carry that 2 % into every
    // other VOB of the selection. Built from the displayed angles the delta is
    // exactly a rotation, and the anchor's own drift stays on the anchor —
    // where `rotateVob` composes it back in unchanged.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[1, 2]} {...wiring} />);
    expect(input('rotation-yaw').value).toBe('30');

    commitAngle('yaw', '40');

    // Close rather than exact, and that is itself the point twice over: the
    // anchor's decomposed yaw is 30.000000x rather than the 30 on screen — the
    // grid builds the delta from the full-precision angles, not from what the
    // display rounded them to — and the drift the stored matrix carries is
    // nowhere in the result.
    expect(turns).toHaveLength(1);
    eulerDeltaRotation([30, 0, 0], [40, 0, 0]).forEach((entry, at) => {
      expect(turns[0][at]).toBeCloseTo(entry, 6);
    });
    // Orthonormal: no scale rode along. The middle entry of a pure Ry is 1, not
    // the anchor's 1.02.
    expect(turns[0][4]).toBeCloseTo(1, 12);
  });

  it('still refuses an angle equal to the one displayed for a multi-selection', () => {
    // The per-angle equality refusal is not weakened by the delta: a zero turn
    // for every VOB in the selection is N no-op ops on the undo stack.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[0, 1]} {...wiring} />);

    commitAngle('yaw', '90');
    commitAngle('yaw', '90.0');
    commitAngle('pitch', 'north');

    expect(turns).toEqual([]);
    expect(rotates).toEqual([]);
  });

  it('commits an absolute pose for a selection of one, on the single-selection path', () => {
    // The asymmetry is deliberate and is the one the position fields already
    // have: an absolute angle is what the grid can read off one VOB.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[1]} {...wiring} />);

    commitAngle('yaw', '180');

    expect(turns).toEqual([]);
    expect(rotates).toHaveLength(1);
  });

  it('says a multi-selection anchored on a reflection has no angles', () => {
    // The unavailable row is about the anchor's matrix, not about how many VOBs
    // are selected — there is still no triple of angles to start a delta from.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[0, 3]} {...wiring} />);

    expect(screen.getByTestId('world-prop-rotation-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('world-prop-rotation-yaw-input')).not.toBeInTheDocument();
    expect(field('rotation')).toHaveTextContent('-1, 0, 0');
  });

  it('says a reflection has no angles rather than crashing the grid', () => {
    // `zenRotationToEuler` throws on a matrix with det < 0 — correctly, since
    // no angles describe it — and an uncaught throw here is a blank panel for
    // the whole VOB, not just the row.
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[3]} {...wiring} />);

    expect(screen.getByTestId('world-prop-rotation-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('world-prop-rotation-yaw-input')).not.toBeInTheDocument();
    // The rest of the grid is intact.
    expect(input('name').value).toBe('MIRRORED');
  });

  it('says a collapsed matrix has no angles either', () => {
    render(<WorldPropertyGrid summary={ROTATIONS} selection={[4]} {...wiring} />);

    expect(screen.getByTestId('world-prop-rotation-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('world-prop-rotation-yaw-input')).not.toBeInTheDocument();
  });
});
