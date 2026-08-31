import React from 'react';
import { Box, Paper, Stack } from '@mui/material';
import WorldFileControls, { type WorldFileControlsProps } from './WorldFileControls';
import WorldOverlayControls, { type WorldOverlayControlsProps } from './WorldOverlayControls';
import WorldEditControls, { type WorldEditControlsProps } from './WorldEditControls';
import WorldStatsChips, { type WorldStatsChipsProps } from './WorldStatsChips';

/**
 * The World surface's toolbar (level-editor.md §17): four groups — file,
 * overlays, edit, stats — that wrap onto a new row on a narrow window, but
 * only *between* groups: each group's own `flexShrink: 0` keeps it a single
 * atomic flex item, so a group's controls never break across two rows the
 * way the monolith this replaced did with a bare `flexWrap="wrap"` on every
 * button. `justifyContent: 'space-between'` spreads each row's groups flush
 * across the full width — flex's version of justified text — rather than
 * leaving them ragged-right. The vertical rule between groups is a border on
 * each group's own container instead of a standalone `Divider` flex item:
 * a lone divider would be spread apart from its neighbours by the same
 * `space-between` gap the moment a row wraps, stranding a vertical bar with
 * a wide gap on either side of it.
 *
 * A priority "More" overflow menu was rejected: it needs `ResizeObserver`
 * measurement jsdom cannot exercise, and moving controls into a `Menu`
 * breaks the synchronous `getByTestId` lookups the 178-case editing suite
 * depends on. Horizontal scroll was tried and rejected in turn — it hid
 * controls off-screen with no visible cue that there was more toolbar to
 * see.
 *
 * All state stays in `WorldSurface`; this and its four children are pure
 * props-down/callbacks-up. Every testid, enablement rule and `{summary &&
 * …}`-shaped guard (here, `hasWorld`) moved verbatim from the surface's own
 * JSX.
 */
export type WorldToolbarProps =
  WorldFileControlsProps & WorldOverlayControlsProps & WorldEditControlsProps & WorldStatsChipsProps;

/** One group's own container: an atomic flex item (never breaks mid-group)
 *  with a right-hand rule that survives wrapping, since it belongs to the
 *  group rather than standing alone in the flex flow. `last` drops the rule
 *  the stats group would otherwise trail with nothing after it. */
const groupSx = (last = false) => ({
  display: 'flex', flexWrap: 'nowrap' as const, gap: 1, alignItems: 'center', flexShrink: 0,
  ...(last ? {} : { pr: 2, borderRight: 1, borderColor: 'divider' }),
});

const WorldToolbar: React.FC<WorldToolbarProps> = (props) => (
  <Paper square elevation={1} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
    <Stack
      direction="row"
      useFlexGap
      spacing={1}
      alignItems="center"
      justifyContent="space-between"
      sx={{ flexWrap: 'wrap', rowGap: 1 }}
    >
      <Box data-testid="world-toolbar-file" sx={groupSx()}>
        <WorldFileControls {...props} />
      </Box>
      <Box data-testid="world-toolbar-overlays" sx={groupSx()}>
        <WorldOverlayControls {...props} />
      </Box>
      <Box data-testid="world-toolbar-edit" sx={groupSx()}>
        <WorldEditControls {...props} />
      </Box>
      <Box data-testid="world-toolbar-stats" sx={groupSx(true)}>
        <WorldStatsChips {...props} />
      </Box>
    </Stack>
  </Paper>
);

export default WorldToolbar;
