import React, { useMemo } from 'react';
import {
  Box, Checkbox, Chip, FormControlLabel, Stack, TextField, Typography,
} from '@mui/material';
import type { VobProps } from 'zen-world';
import type { WorldSummary } from '../../../shared/worldTypes';
import { vobModelOf } from '../../world/vobModel';

// The property grid for the selected VOB (level-editor.md §6, §7). It reads the
// `VobIndex` the worker sent, and — since `SetVobProp` — it also writes: the
// name, the visual and the six flags.
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
    <Box data-testid={`world-prop-${name}`} sx={{ minWidth: 0, wordBreak: 'break-word' }}>
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

export interface WorldPropertyGridProps {
  summary: WorldSummary;
  /** The whole selection. The grid describes the last VOB in it — the one the
   *  gizmo anchors on — and says how many others an edit would take with it. */
  selection: readonly number[];
  /**
   * One property change, as the single key that changed.
   *
   * Only the changed key, because the op reads `from` for exactly the keys `to`
   * names: a grid that posted the whole object would build an inverse that
   * restores fields nobody edited, and nothing would show it until an undo.
   */
  onEditProps: (props: VobProps) => void;
}

const WorldPropertyGrid: React.FC<WorldPropertyGridProps> = (
  { summary, selection, onEditProps },
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
          key={`name-${selectedVob}-${name}`}
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
          key={`visual-${selectedVob}-${visual}`}
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
        {/* ZenGin space, centimetres — see the note at the top of this file. */}
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {position.map(coordinate).join(', ')}
        </Typography>
      </Field>
      <Field label="Rotation" name="rotation">
        <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-line' }}>
          {[0, 3, 6].map((at) => rotation.slice(at, at + 3).map(coordinate).join(', ')).join('\n')}
        </Typography>
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
