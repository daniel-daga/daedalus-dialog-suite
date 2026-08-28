import React, { useMemo, useState } from 'react';
import {
  Box, Checkbox, Chip, FormControlLabel, Stack, TextField, Typography,
} from '@mui/material';
import {
  BASE_FIELDS, classPropKeys, eulerDeltaRotation, eulerToZenRotation, fieldOf,
  zenRotationToEuler,
  type ClassPropValue, type ClassProps, type FieldDescriptor,
  type VobProps, type ZenEulerDegrees, type ZenPosition, type ZenRotation,
} from 'zen-world';
import type { WorldSummary } from '../../../shared/worldTypes';
import { vobModelOf } from '../../world/vobModel';

// The property grid for the selected VOB (level-editor.md §6, §7). It reads the
// `VobIndex` the worker sent, and — since `SetVobProp` — it also writes: the
// name, the visual, the six flags, the catalogued class fields, the three
// coordinates of the position, and (for a single selection) the three angles of
// the rotation, through `zen-world/coords`' one matrix↔Euler conversion.
//
// Two conventions it must not quietly improve on:
//
//   - **positions stay in ZenGin space, in centimetres.** The whole conversion
//     is one mirrored root node in the viewport (§7), and it is one-way. These
//     are the coordinates a `.zen` holds and an op would carry; showing metres
//     would show a number found nowhere else in the system.
//   - **`flags` is a bit word with named bits.** Printing 3 tells nobody that a
//     VOB is a visible static.
//
// It also answers the question a viewport cannot: why an object that is plainly
// in the world does not appear in it. A `zCVobLevelCompo` and an unresolved
// decal are both correct, measured behaviour, and the grid is where someone
// looks when they suspect a bug instead.
//
// **What editing here has to get right that the gizmo did not.** Every field it
// writes is invisible in the viewport: a VOB moved by the wrong op is on screen,
// a VOB renamed by the wrong op is not. So it sends **only the field that
// changed** — the op reads `from` for exactly the keys `to` names, and a grid
// that posted every field would build an inverse that restores values nobody
// edited. And an edit that changes nothing is not sent at all, which is the rule
// the gizmo already has: clicking into a field and out again would otherwise be
// an undo entry, and with a selection it would be one per VOB.

const FLAG_ORDER = [
  'showVisual', 'vobStatic', 'ambient', 'cdStatic', 'cdDynamic', 'physicsEnabled',
] as const;

/** Enough precision for a centimetre coordinate without printing float noise. */
const coordinate = (value: number) => Number(value.toFixed(2)).toString();

const Field: React.FC<{ label: string; name: string; children: React.ReactNode }> = (
  { label, name, children },
) => (
  <Box sx={{ display: 'flex', gap: 1, py: 0.25, alignItems: 'baseline' }}>
    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 84, flexShrink: 0 }}>
      {label}
    </Typography>
    {/* The value column grows: three coordinate inputs side by side in a 300 px
        panel overflow it otherwise, and the inputs are already `fullWidth`. */}
    <Box data-testid={`world-prop-${name}`} sx={{ flexGrow: 1, minWidth: 0, wordBreak: 'break-word' }}>
      {children}
    </Box>
  </Box>
);

/**
 * A text field that edits one property.
 *
 * Uncontrolled, and **keyed on the VOB *and* the value** by its caller. An
 * uncontrolled input keeps whatever it has across a re-render, and there are two
 * ways that goes wrong, not one:
 *
 *   - the selection moves, and a half-typed name follows it to the next VOB and
 *     is written there on the next blur;
 *   - the *value* changes under it — an undo, a redo, a batch edit from another
 *     VOB in the selection — and the panel goes on showing a name the world no
 *     longer has, then writes it back on the next blur.
 *
 * A key on the VOB alone only fixes the first, which is why the second was found
 * by driving the real app rather than by a test. Typing does not change `value`,
 * so nothing remounts mid-edit. Escape puts the VOB's own value back, which is
 * the only way out of a field once something has been typed into it.
 */
const EditableField: React.FC<{
  name: string;
  value: string;
  disabled?: boolean;
  helper?: string;
  onCommit: (value: string) => void;
}> = ({ name, value, disabled, helper, onCommit }) => (
  <TextField
    variant="standard"
    size="small"
    fullWidth
    defaultValue={value}
    disabled={disabled}
    helperText={helper}
    inputProps={{ 'data-testid': `world-prop-${name}-input`, spellCheck: false }}
    onBlur={(event) => { if (event.target.value !== value) onCommit(event.target.value); }}
    onKeyDown={(event) => {
      const target = event.target as HTMLInputElement;
      if (event.key === 'Enter') {
        if (target.value !== value) onCommit(target.value);
        target.blur();
      } else if (event.key === 'Escape') {
        target.value = value;
        target.blur();
      }
    }}
  />
);

/**
 * A class field's value as text, and text back to a value of its kind.
 *
 * Text for every kind but `bool`, a colour included, because the alternative is
 * an input widget per kind where the catalogue has one table — and because the
 * four channels of a `zCVobLight.color` are one value the op carries whole, not
 * four fields whose inverse would restore three of them. A boolean is the one
 * exception and it goes the other way, to a checkbox: a text field would have to
 * decide what "true", "1" and "yes" mean, which is a parsing problem this panel
 * would be inventing for itself when the six base flags above already have a
 * control that has none.
 *
 * `parse` answers null for anything the field cannot hold, and null is the whole
 * of the refusal: nothing is sent, and the catalogue's own bounds are what it
 * checks against, so the number the grid rejects is the number C++ would have
 * rejected — at the bottom of a batch that may already have applied.
 */
const formatted = (value: ClassPropValue): string => {
  // The same rounding the coordinates get, and for the same reason: a float32
  // range that came out of the archive prints as 299.99998474121094 otherwise,
  // and a user who edits the colour beside it has not asked to see that.
  if (typeof value === 'string') return value;
  // A `bool` never reaches here — it is drawn as a checkbox — but the value type
  // is the catalogue's whole union, and `String(true)` is what the type demands
  // rather than a case anything hits.
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return coordinate(value);
  return value.map(coordinate).join(', ');
};

const parse = (field: FieldDescriptor, text: string): ClassPropValue | null => {
  if (field.kind === 'string') return text;

  const within = (value: number) => Number.isFinite(value)
    && (field.min === undefined || value >= field.min)
    && (field.max === undefined || value <= field.max);

  if (field.kind === 'float' || field.kind === 'int') {
    // `Number('')` is 0, and an emptied field is not a request to set zero.
    const value = text.trim() === '' ? NaN : Number(text);
    if (!within(value)) return null;
    // An `int` field is an `int32_t` in the archive: a fraction accepted here
    // truncates on the cast in C++ and reports success, so 2.5 is refused rather
    // than rounded — the user asked for a number this field cannot hold.
    return field.kind === 'int' && !Number.isInteger(value) ? null : value;
  }

  const parts = text.split(',');
  if (parts.length !== 4) return null;
  // The same rule the float branch above states, and for the same reason:
  // `Number('')` is 0, so "255,,180,255" would parse as a green of 0 and commit
  // it. A typo that dropped a channel is not a request to darken the light.
  if (parts.some((part) => part.trim() === '')) return null;
  const channels = parts.map((part) => Number(part.trim()));
  // Integers, because a channel is a byte in the archive and 127.5 is written
  // as something else entirely.
  return channels.every((channel) => Number.isInteger(channel) && within(channel))
    ? channels
    : null;
};

/**
 * One catalogued class field.
 *
 * It reuses `EditableField` rather than growing a second text input, so the
 * blur/Enter/Escape rules and the value-in-the-key remount are the ones already
 * proven above — with the VOB in the key as well, since the selection can move
 * to another VOB of the same class while a value is half typed.
 *
 * The refusal counter is the part `EditableField` cannot do on its own: a
 * refused value is not a commit, so nothing changes and nothing re-renders, and
 * an uncontrolled input goes on showing a range the light does not have. Bumping
 * it remounts through the same key, which is Escape's behaviour reached by a
 * different route.
 */
const ClassField: React.FC<{
  vob: number;
  /** `class` for a catalogued class field, `base` for one of the three `zCVob`
   *  fields that have no column. It is only the test id and the remount key: the
   *  two groups reach the world by different ops but are typed identically, and
   *  a second copy of the blur/Escape/refusal rules is exactly what this
   *  component exists not to have. */
  group?: 'class' | 'base';
  field: FieldDescriptor;
  value: ClassPropValue;
  /**
   * The values this field is allowed to take, uppercased — or undefined when
   * nothing constrains it, which is every field but one.
   *
   * Uppercased because Daedalus symbol names are case-insensitive and the parser
   * keys its index by the name as it was *written*: a verbatim lookup would
   * refuse `itmw_2h_axe_01`, which names the same symbol. The comparison is
   * case-folded; the value committed is the one the user typed.
   */
  knownValues?: ReadonlySet<string>;
  helper?: string;
  onCommit: (value: ClassPropValue) => void;
}> = ({
  vob, group = 'class', field, value, knownValues, helper, onCommit,
}) => {
  const [refusals, setRefusals] = useState(0);

  // A boolean is a checkbox, controlled, exactly like the six base flags above:
  // there is no text to type, so there is nothing to refuse, nothing to remount
  // and no blur to wait for. `value === true` rather than a cast, because the
  // props object is what a world answered and this is the boundary it crosses.
  if (field.kind === 'bool') {
    return (
      <Checkbox
        size="small"
        sx={{ p: 0, ml: 0.25 }}
        checked={value === true}
        inputProps={{ 'data-testid': `world-prop-${group}-${field.key}-input` } as React.InputHTMLAttributes<HTMLInputElement>}
        onChange={(event) => onCommit(event.target.checked)}
      />
    );
  }

  const text = formatted(value);

  return (
    <EditableField
      key={`${group}-${vob}-${field.key}-${text}-${refusals}`}
      name={`${group}-${field.key}`}
      value={text}
      helper={helper}
      onCommit={(typed) => {
        const parsed = parse(field, typed);
        // A value outside the allowed set is refused by the same route a value
        // the field cannot hold is: nothing is sent, and the field remounts
        // showing what the world has. The two are the same refusal to a user.
        if (parsed === null
          || (knownValues !== undefined && !knownValues.has(String(parsed).toUpperCase()))) {
          setRefusals((at) => at + 1);
        } else onCommit(parsed);
      }}
    />
  );
};

/** The axes, in the order the index stores them. */
const AXES = ['x', 'y', 'z'] as const;

/**
 * A coordinate, from text, or null for anything that is not one.
 *
 * Null is the whole of the refusal, exactly as it is for a class field: nothing
 * is sent, so a number the binding would reject never reaches the bottom of a
 * batch that has already applied its other ops. The float32 check is not
 * decoration — the archive holds a float32 and the binding takes one, so a
 * magnitude beyond it would arrive as an Infinity.
 */
const parseCoordinate = (text: string): number | null => {
  // `Number('')` is 0, and an emptied field is not a request to set zero.
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && Number.isFinite(Math.fround(value)) ? value : null;
};

/**
 * One typed coordinate (level-editor.md §14.1 item 1.5).
 *
 * It reuses `EditableField` for the same reason `ClassField` does: the
 * blur/Enter/Escape rules and the value-in-the-key remount are already proven,
 * and a second text input would be a second set of them to keep in step. The
 * refusal counter is likewise the part `EditableField` cannot do alone — a
 * refused value is not a commit, so nothing re-renders and an uncontrolled input
 * would go on showing a coordinate the world does not have.
 *
 * A number equal to the one already there is refused by the same route rather
 * than sent: "12.50" is different text and the same coordinate, and committing
 * it would be a zero-delta op per selected VOB on the undo stack — the rule the
 * name field and the gizmo both already have.
 */
const CoordinateField: React.FC<{
  vob: number;
  axis: string;
  value: number;
  onCommit: (value: number) => void;
}> = ({ vob, axis, value, onCommit }) => {
  const [refusals, setRefusals] = useState(0);
  const text = coordinate(value);

  return (
    <EditableField
      key={`position-${vob}-${axis}-${text}-${refusals}`}
      name={`position-${axis}`}
      value={text}
      onCommit={(typed) => {
        const parsed = parseCoordinate(typed);
        if (parsed === null || parsed === value) setRefusals((at) => at + 1);
        else onCommit(parsed);
      }}
    />
  );
};

/** The angle names, in the order `ZenEulerDegrees` holds them. */
const ANGLE_AXES = ['yaw', 'pitch', 'roll'] as const;

/**
 * One typed angle (level-editor.md §14.1 item 1.5, the rotation half).
 *
 * Shaped on `CoordinateField` — same `EditableField`, same local refusal
 * counter, same `parseCoordinate` (an angle is degrees, but "not a number" and
 * "a magnitude float32 cannot hold" are the same refusals).
 *
 * **The equality refusal is the load-bearing part, and it is per angle.** The
 * read *normalizes*: 30.2 % of retail VOBs store a matrix that is
 * non-orthonormal by more than 1e-6, so `eulerToZenRotation(zenRotationToEuler(M))`
 * differs from `M` for a third of the world. Committing an angle the user did
 * not change would therefore re-orthonormalize the matrix and rewrite bytes
 * nobody asked to change. The comparison is against the *displayed* number as
 * well as the exact one, because the display rounds ("30" on screen can be
 * 30.000000000000004 decomposed, and retyping what is on screen is not an
 * edit).
 *
 * A committed angle can legitimately come back different: the decomposition is
 * canonical — yaw/roll in (-180, 180], pitch in [-90, 90] — so a committed 190
 * remounts as -170. That is the same angle, not a defect to fight here.
 */
const AngleField: React.FC<{
  vob: number;
  axis: string;
  value: number;
  onCommit: (value: number) => void;
}> = ({ vob, axis, value, onCommit }) => {
  const [refusals, setRefusals] = useState(0);
  const text = coordinate(value);

  return (
    <EditableField
      key={`rotation-${vob}-${axis}-${text}-${refusals}`}
      name={`rotation-${axis}`}
      value={text}
      onCommit={(typed) => {
        const parsed = parseCoordinate(typed);
        if (parsed === null || parsed === value || parsed === Number(text)) {
          setRefusals((at) => at + 1);
        } else onCommit(parsed);
      }}
    />
  );
};

export interface WorldPropertyGridProps {
  summary: WorldSummary;
  /** The whole selection. The grid describes the last VOB in it — the one the
   *  gizmo anchors on — and says how many others an edit would take with it. */
  selection: readonly number[];
  /**
   * How many edits the main process has refused — bumped by the shell in
   * `commitOps`' catch, and folded into every editable field's key.
   *
   * The local refusal counters above cover only the refusals a field decides
   * itself. A refusal that comes back from the main process changes *nothing*:
   * the world holds the value it always held, so the value in the key is
   * unchanged, no field remounts, and an uncontrolled input goes on showing the
   * number the user typed as though it had been taken
   * (refactoring-targets.md §7). This counter is the remount that refusal was
   * missing — the same rule the class section got when `setClassProps(null)`
   * moved into that same catch, applied to the fields the columnar index backs
   * and therefore never nulls.
   */
  refusalGeneration: number;
  /**
   * One property change, as the single key that changed.
   *
   * Only the changed key, because the op reads `from` for exactly the keys `to`
   * names: a grid that posted the whole object would build an inverse that
   * restores fields nobody edited, and nothing would show it until an undo.
   */
  onEditProps: (props: VobProps) => void;
  /**
   * The described VOB's per-class fields, as `getVobProps` answered them — the
   * whole props object, base fields and all — or null while that read is in
   * flight.
   *
   * None of this is in the columnar index: it interns a class *name* and carries
   * not one field of the class, so it arrives over IPC and one round trip behind
   * the selection. Null therefore means "not here yet", never "empty", and the
   * grid says so rather than drawing fields that would write a blank on blur.
   *
   * **It must be the described VOB's.** The fields drawn come from the catalogue
   * by that VOB's class, and nothing in a props object says which VOB it was
   * read for — so props belonging to another one pass as a loaded read and the
   * grid indexes keys they do not have. Keeping the two in step is the caller's:
   * it tags the read with its VOB and answers null on a mismatch, because its
   * own effect learns of a selection change a render too late.
   */
  classProps: ClassProps | null;
  /**
   * One class field change, as the single key that changed — and on the
   * described VOB alone.
   *
   * Alone because each VOB in a batch would need its own fetched `from` and a
   * selection can hold mixed classes, which is a lazy read per VOB and a guard
   * that does not exist yet (level-editor.md §14.1 item 1.4, D7).
   */
  onEditClassProps: (props: ClassProps) => void;
  /**
   * One base-field change — `presetName`, `visualCamAlign` or `bias` — as the
   * single key that changed, and on the described VOB alone.
   *
   * Separate from `onEditProps` although both build a `SetVobProp`: these three
   * have no column in the index, so their `from` side is the fetched props
   * rather than something the op builder can read back per VOB. That is the
   * class fields' constraint reached by a different route, and it has the class
   * fields' consequence — the described VOB only, where a flag takes the whole
   * selection.
   */
  onEditBaseProps: (props: VobProps) => void;
  /**
   * Every item instance the loaded script project declares, **uppercased** —
   * the parser's `items` map, which is `C_ITEM` instances and nothing else.
   *
   * It is here for one field: an `oCItem` spawns the Daedalus instance it names,
   * and ZenGin crashes on a name no script declares (level-editor.md §14.1). A
   * typo is invisible in the viewport, invisible in the file, and survives every
   * check the save pipeline has, so this is the only layer that can catch it —
   * `assertApplyOpsRequest` cannot, because the main process holds no item
   * index at all (see `ipcValidation.ts`, `DAEDALUS_INSTANCE`).
   *
   * **Empty means "nothing is known", never "nothing is legal".** A world can be
   * opened with no script project behind it, and the index is also empty until
   * ingestion has merged the item files, so an empty set refuses nothing and the
   * field is the free text it always was. That is the whole reason this refusal
   * lives here rather than in the main process: a hard refusal cannot know
   * whether an index it does not have would have allowed the name.
   */
  itemInstances: ReadonlySet<string>;
  /**
   * A typed coordinate, as the **delta** it moves the described VOB by — the
   * gizmo's own shape, and the gizmo's own handler.
   *
   * A delta rather than the destination because a typed coordinate is the same
   * edit a drag is, and a drag of a multi-selection moves every VOB by one
   * delta: an absolute applied to all of them would stack the selection on one
   * point, and each op would lose the `from` that makes the batch invertible.
   * Sending it this way also means there is no second op-building path to keep
   * in step with `translateVobs` — the difference between typing and dragging
   * ends here.
   */
  onTranslate: (delta: ZenPosition) => void;
  /**
   * A typed angle for a **selection of one**, as the **absolute** rotation that
   * VOB should have — `rotateVob`'s shape, unlike the delta a gizmo drag or a
   * typed coordinate leaves as.
   *
   * Absolute because with one VOB the typed angles *are* the destination: the
   * field shows the decomposed pose and the user replaced one angle of it, and
   * an absolute angle is what the grid can read off a single VOB. The asymmetry
   * with `onRotateSelection` below is the same one position already has between
   * what it displays and what it sends, and is not a wart.
   */
  onRotate: (to: ZenRotation) => void;
  /**
   * A typed angle for a selection of **N**, as the **delta** every selected VOB
   * turns by — `rotateVobs`' shape, and the gizmo's own handler.
   *
   * Relative rather than absolute (level-editor.md §16.4, decided 2026-08-28)
   * for the reason the position fields are: a multi-selection moves together and
   * keeps its spacing, and a rotation that snapped N VOBs to one pose would be
   * the odd one out — it destroys their relative orientation with no way back
   * but undo. Sending it this way also means there is no second op-building path
   * beside `rotateVobs`, so typing and dragging cannot drift apart about what
   * "turn 45 degrees" means.
   */
  onRotateSelection: (delta: ZenRotation) => void;
}

const WorldPropertyGrid: React.FC<WorldPropertyGridProps> = (
  {
    summary, selection, refusalGeneration,
    onEditProps, classProps, onEditClassProps, onEditBaseProps, itemInstances,
    onTranslate, onRotate, onRotateSelection,
  },
) => {
  const { tree, reader } = useMemo(() => vobModelOf(summary), [summary]);
  const selectedVob = selection.length === 0 ? null : selection[selection.length - 1];

  if (selectedVob === null || reader.className(selectedVob) === null) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" data-testid="world-props-empty">
          Select a VOB in the viewport or the scene tree.
        </Typography>
      </Box>
    );
  }

  const className = reader.className(selectedVob)!;
  const name = reader.name(selectedVob);
  const visual = reader.visual(selectedVob);
  const visualType = reader.visualType(selectedVob);
  const position = reader.position(selectedVob)!;
  const rotation = reader.rotation(selectedVob)!;
  const flags = reader.flags(selectedVob);
  const parent = tree.parent(selectedVob);
  const children = tree.children(selectedVob).length;
  // The catalogue's own order and its own descriptors. It answers [] for a class
  // it does not have — 35 of the 37 in a retail world — and that empty list is
  // the whole test for whether there is a section to draw at all.
  const classFields = classPropKeys(className).flatMap((key) => fieldOf(className, key) ?? []);

  // The one catalogued field whose legal values are a set this app already
  // holds. Undefined for every other field and for every class, so nothing else
  // is constrained: a sound name is a file in the VFS and a light's range is a
  // number, and neither is in an item index.
  const knownValuesFor = (key: string): ReadonlySet<string> | undefined => (
    className === 'oCItem' && key === 'instance' && itemInstances.size > 0
      ? itemInstances
      : undefined
  );

  // The described VOB's rotation as angles — the anchor's, whatever the size of
  // the selection, and null when no angles describe it. `zenRotationToEuler`
  // **throws** on a reflection or a collapsed matrix (correctly: no triple of
  // angles is either), and this is a render path, where an uncaught throw is a
  // blank panel for the whole VOB rather than one unavailable row. Retail has
  // zero of both, but a world this editor writes is not retail.
  const euler = ((): ZenEulerDegrees | null => {
    try {
      return zenRotationToEuler(rotation);
    } catch {
      return null;
    }
  })();

  // Why a VOB that exists is not on screen. All three are measured, correct
  // behaviour rather than gaps (§3, "The unresolved visuals").
  let note: string | null = null;
  if (className === 'zCVobLevelCompo') {
    note = 'A level compo is not drawn: its visual names the source mesh a slice of the '
      + 'already-compiled world came from, so drawing it would draw the world twice. '
      + 'The part .zen beside the world is its editable source.';
  } else if (visualType === 'PARTICLE_EFFECT') {
    note = 'A particle effect is a Daedalus instance, not a file in the VFS, so it has no '
      + 'mesh to draw.';
  } else if (visualType === 'DECAL') {
    note = 'A decal is not a mesh: its visual names a texture, and the quad is built by the '
      + 'renderer rather than loaded.';
  }

  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      {/* A drag moves the whole selection and the grid only ever describes one
          VOB of it, so without this the count is visible nowhere but the
          viewport — where a VOB out of view is not visible at all. */}
      {selection.length > 1 && (
        <Chip
          size="small"
          label={`${selection.length} VOBs selected`}
          data-testid="world-prop-selection"
          sx={{ mb: 1 }}
        />
      )}
      <Field label="Index" name="index">
        <Typography variant="caption">{selectedVob}</Typography>
      </Field>
      <Field label="Class" name="class">
        <Typography variant="caption">{className}</Typography>
      </Field>
      {selection.length > 1 && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="world-prop-edit-scope"
          sx={{ display: 'block', mb: 0.5 }}
        >
          {`An edit here is applied to all ${selection.length} selected VOBs.`}
        </Typography>
      )}
      <Field label="Name" name="name">
        <EditableField
          key={`name-${selectedVob}-${name}-${refusalGeneration}`}
          name="name"
          value={name ?? ''}
          onCommit={(value) => onEditProps({ name: value })}
        />
      </Field>
      <Field label="Visual" name="visual">
        {/* A VOB whose visual type is UNKNOWN has no visual object to rename,
            and the binding refuses to name one — giving a VOB a visual replaces
            that object and has to decide its class, which the file name cannot
            settle (`.3DS` is zCProgMeshProto 20,716 times and zCMesh 31 times
            across the retail corpus). Offering the field and having the edit
            refused at the bottom of the stack is worse than not offering it. */}
        <EditableField
          key={`visual-${selectedVob}-${visual}-${refusalGeneration}`}
          name="visual"
          value={visual ?? ''}
          disabled={!visual || visualType === 'UNKNOWN'}
          helper={!visual || visualType === 'UNKNOWN'
            ? 'This VOB has no visual to rename.'
            : undefined}
          onCommit={(value) => onEditProps({ visual: value })}
        />
      </Field>
      <Field label="Type" name="visualType">
        <Typography variant="caption">{visualType}</Typography>
      </Field>
      <Field label="Position" name="position">
        {/* ZenGin space, centimetres — see the note at the top of this file.
            Typed, and it leaves as a delta: the destination is this axis
            changed and the other two left alone. */}
        <Stack direction="row" spacing={0.5}>
          {AXES.map((axis, at) => (
            <CoordinateField
              // The generation is in the *component's* key rather than a prop:
              // remounting the whole field resets its local refusal count along
              // with the input, which is exactly what a fresh look at the
              // world's own value means.
              key={`${axis}-${refusalGeneration}`}
              vob={selectedVob}
              axis={axis}
              value={position[at]}
              onCommit={(value) => {
                const delta: ZenPosition = [0, 0, 0];
                delta[at] = value - position[at];
                onTranslate(delta);
              }}
            />
          ))}
        </Stack>
      </Field>
      <Field label="Rotation" name="rotation">
        {/* Typed angles through `zen-world/coords`' one matrix↔Euler conversion
            (intrinsic Y-X-Z, degrees), for a selection of any size: the fields
            describe the anchor VOB, and what a commit *means* is what changes
            with the count — absolute for one VOB, a delta every selected VOB
            turns by for N (§16.4). The read-only matrix is what is left when no
            angles describe the anchor at all. */}
        {euler === null
          ? (
            <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-line' }}>
              {[0, 3, 6].map((at) => rotation.slice(at, at + 3).map(coordinate).join(', ')).join('\n')}
            </Typography>
          )
          : (
            <Stack direction="row" spacing={0.5}>
              {ANGLE_AXES.map((axis, at) => (
                <AngleField
                  // The generation is in the component's key for the same
                  // reason it is on `CoordinateField`: a main-process refusal
                  // changes nothing in the world, so only this remounts the
                  // field showing the angle the world still has.
                  key={`${axis}-${refusalGeneration}`}
                  vob={selectedVob}
                  axis={axis}
                  value={euler[at]}
                  onCommit={(value) => {
                    // The typed angle replaces one entry of the decomposed
                    // pose; the other two stay at full precision, not at what
                    // the display rounded them to.
                    const typed = [...euler] as ZenEulerDegrees;
                    typed[at] = value;
                    // One VOB gets the pose; N get the turn between the pose on
                    // screen and the one typed. The delta is built from the two
                    // angle triples and not from the stored matrix, so the
                    // anchor's own drift — 30.2 % of retail VOBs are
                    // non-orthonormal — stays on the anchor instead of being
                    // applied to everything else in the selection.
                    if (selection.length === 1) {
                      onRotate(eulerToZenRotation(typed) as ZenRotation);
                    } else {
                      onRotateSelection(eulerDeltaRotation(euler, typed) as ZenRotation);
                    }
                  }}
                />
              ))}
            </Stack>
          )}
        {euler === null && (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="world-prop-rotation-unavailable"
            sx={{ display: 'block' }}
          >
            No angles describe this matrix — it is a reflection or has collapsed
            axes, which a rotation cannot be. The gizmo can still turn this VOB.
          </Typography>
        )}
      </Field>
      <Field label="Flags" name="flags">
        {/* Named, not a bit word: printing 3 tells nobody that a VOB is a
            visible static. Every flag is shown rather than only the set ones,
            because an unset flag is now something to click. */}
        <Stack direction="column" sx={{ my: -0.75 }}>
          {FLAG_ORDER.map((flag) => (
            <FormControlLabel
              key={flag}
              control={(
                <Checkbox
                  size="small"
                  checked={flags[flag]}
                  inputProps={{ 'data-testid': `world-prop-flag-${flag}` } as React.InputHTMLAttributes<HTMLInputElement>}
                  onChange={(event) => onEditProps({ [flag]: event.target.checked })}
                />
              )}
              label={<Typography variant="caption">{flag}</Typography>}
              sx={{ ml: -1, my: -0.5 }}
            />
          ))}
        </Stack>
      </Field>
      {/* The three base fields that are not in the columnar index — the Spacer
          preset a VOB was made from, how its visual faces the camera, and the
          depth bias. They are drawn for every class, unlike the section below,
          because every VOB has them; they sit here because they arrive with the
          same read, one round trip behind the selection. */}
      <Box
        data-testid="world-prop-base-section"
        sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}
      >
        {selection.length > 1 && (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="world-prop-base-scope"
            sx={{ display: 'block', mb: 0.5 }}
          >
            {`These fields are edited on this VOB only, not on the other ${selection.length - 1} selected.`}
          </Typography>
        )}
        {classProps === null
          ? (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="world-prop-base-loading"
            >
              Reading this VOB&apos;s base fields…
            </Typography>
          )
          : BASE_FIELDS.map((baseField) => (
            <Field
              key={`${baseField.key}-${refusalGeneration}`}
              label={baseField.key}
              name={`base-${baseField.key}`}
            >
              <ClassField
                vob={selectedVob}
                group="base"
                field={baseField}
                value={classProps[baseField.key]}
                onCommit={(value) => onEditBaseProps({ [baseField.key]: value })}
              />
            </Field>
          ))}
      </Box>
      {/* The fields that make a VOB the thing it *is* — an item's Daedalus
          instance, a light's range and colour. They sit after the base ones
          rather than among them because they are read over IPC and the base ones
          are read out of the index: everything above is on screen the moment the
          selection moves, and this can still be arriving. */}
      {classFields.length > 0 && (
        <Box
          data-testid="world-prop-class-section"
          sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}
        >
          {selection.length > 1 && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="world-prop-class-scope"
              sx={{ display: 'block', mb: 0.5 }}
            >
              {`${className} fields are edited on this VOB only, not on the other ${selection.length - 1} selected.`}
            </Typography>
          )}
          {classProps === null
            ? (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="world-prop-class-loading"
              >
                {`Reading this ${className}'s fields…`}
              </Typography>
            )
            : classFields.map((classField) => (
              <Field
                // The class section is also unmounted whole by `classProps`
                // going null in `commitOps`' catch; the generation is folded in
                // anyway so a refused class edit follows the same rule as every
                // other field rather than depending on that null alone.
                key={`${classField.key}-${refusalGeneration}`}
                label={classField.key}
                name={`class-${classField.key}`}
              >
                <ClassField
                  vob={selectedVob}
                  field={classField}
                  value={classProps[classField.key]}
                  knownValues={knownValuesFor(classField.key)}
                  // Stated up front rather than only on a refusal: a field that
                  // silently declines what was typed is the complaint the
                  // refusal idiom's remount already comes close to, and the rule
                  // is worth knowing before it bites.
                  helper={knownValuesFor(classField.key) === undefined
                    ? undefined
                    : 'Must be an item instance declared by the loaded scripts.'}
                  onCommit={(value) => onEditClassProps({ [classField.key]: value })}
                />
              </Field>
            ))}
        </Box>
      )}
      <Field label="Parent" name="parent">
        <Typography variant="caption" color={parent < 0 ? 'text.secondary' : 'text.primary'}>
          {parent < 0
            ? 'none (root)'
            : `${reader.name(parent) || '(unnamed)'} — ${reader.className(parent)}`}
        </Typography>
      </Field>
      <Field label="Children" name="children">
        <Typography variant="caption">{children}</Typography>
      </Field>

      {note && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="world-prop-note"
          sx={{ display: 'block', mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}
        >
          {note}
        </Typography>
      )}
    </Box>
  );
};

export default WorldPropertyGrid;
