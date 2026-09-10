import React from 'react';
import { Box, Paper, Stack } from '@mui/material';
import WorldFileControls, { type WorldFileControlsProps } from './WorldFileControls';
import WorldAddControls, { type WorldAddControlsProps } from './WorldAddControls';
import WorldEditControls, { type WorldEditControlsProps } from './WorldEditControls';
import WorldViewControls, { type WorldViewControlsProps } from './WorldViewControls';

/**
 * The World surface's toolbar (level-editor.md §17): four groups — file, add,
 * edit, view. The first three are packed from the left; the view group is
 * pinned to the right edge with `marginLeft: auto`, so the one group whose
 * width changes while a world is open (the time slider and the quest-state
 * lens appear inside it) grows into its own slack and moves nothing else.
 * `space-between` was tried and rejected: it spread the groups across the
 * full width, so every group shifted whenever any of them changed width.
 *
 * The groups wrap onto a new row on a narrow window, but only *between*
 * groups: each group's own `flexShrink: 0` keeps it a single atomic flex
 * item, so a group's controls never break across two rows. The vertical rule
 * between groups is a border on each group's own container rather than a
 * standalone `Divider` flex item, which wrapping would strand.
 *
 * The counts (VOBs, triangles, draw calls, placed) are not here: they are the
 * status bar's, under the viewport, beside the terrain readout.
 *
 * A priority "More" overflow menu was rejected: it needs `ResizeObserver`
 * measurement jsdom cannot exercise, and moving controls into a `Menu`
 * breaks the synchronous `getByTestId` lookups the 178-case editing suite
 * depends on. Horizontal scroll was tried and rejected in turn — it hid
 * controls off-screen with no visible cue that there was more toolbar to
 * see.
 *
 * All state stays in `WorldSurface`; this and its four children are pure
 * props-down/callbacks-up.
 */
export type WorldToolbarProps =
  WorldFileControlsProps & WorldAddControlsProps & WorldEditControlsProps & WorldViewControlsProps;

/** One group's own container: an atomic flex item (never breaks mid-group)
 *  with a right-hand rule that survives wrapping, since it belongs to the
 *  group rather than standing alone in the flex flow. The last group drops
 *  the rule and takes the right edge. */
const groupSx = (last = false) => ({
  display: 'flex', flexWrap: 'nowrap' as const, gap: 0.5, alignItems: 'center', flexShrink: 0,
  ...(last
    ? { ml: 'auto' }
    : { pr: 1.5, borderRight: 1, borderColor: 'divider' }),
});

const WorldToolbar: React.FC<WorldToolbarProps> = (props) => (
  <Paper square elevation={1} sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
    <Stack
      direction="row"
      useFlexGap
      spacing={1}
      alignItems="center"
      sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
    >
      <Box data-testid="world-toolbar-file" sx={groupSx()}>
        <WorldFileControls {...props} />
      </Box>
      <Box data-testid="world-toolbar-add" sx={groupSx()}>
        <WorldAddControls {...props} />
      </Box>
      <Box data-testid="world-toolbar-edit" sx={groupSx()}>
        <WorldEditControls {...props} />
      </Box>
      <Box data-testid="world-toolbar-view" sx={groupSx(true)}>
        <WorldViewControls {...props} />
      </Box>
    </Stack>
  </Paper>
);

export default WorldToolbar;
