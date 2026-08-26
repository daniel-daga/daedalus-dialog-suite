import React, { useMemo } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import type { WorldSummary } from '../../../shared/worldTypes';
import { vobModelOf } from '../../world/vobModel';

// The property grid for the selected VOB (level-editor.md §6). Read-only:
// Phase 1a adds no writer and no op, and everything here is a projection of
// the `VobIndex` the worker already sent.
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

export interface WorldPropertyGridProps {
  summary: WorldSummary;
  /** The whole selection. The grid describes the last VOB in it — the one the
   *  gizmo anchors on — and says how many others a drag would take with it. */
  selection: readonly number[];
}

const WorldPropertyGrid: React.FC<WorldPropertyGridProps> = ({ summary, selection }) => {
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
      <Field label="Name" name="name">
        <Typography variant="caption" color={name ? 'text.primary' : 'text.secondary'}>
          {name || '(unnamed)'}
        </Typography>
      </Field>
      <Field label="Visual" name="visual">
        <Typography variant="caption" color={visual ? 'text.primary' : 'text.secondary'}>
          {visual || '(none)'}
        </Typography>
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
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {FLAG_ORDER.filter((flag) => flags[flag]).map((flag) => (
            <Chip key={flag} size="small" label={flag} variant="outlined" />
          ))}
          {FLAG_ORDER.every((flag) => !flags[flag]) && (
            <Typography variant="caption" color="text.secondary">(none)</Typography>
          )}
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
