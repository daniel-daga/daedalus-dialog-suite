import React from 'react';
import { Box, Divider, Paper, Stack } from '@mui/material';
import WorldFileControls, { type WorldFileControlsProps } from './WorldFileControls';
import WorldOverlayControls, { type WorldOverlayControlsProps } from './WorldOverlayControls';
import WorldEditControls, { type WorldEditControlsProps } from './WorldEditControls';
import WorldStatsChips, { type WorldStatsChipsProps } from './WorldStatsChips';

/**
 * The World surface's toolbar (level-editor-ui-improvements.md slice 5):
 * four groups — file, overlays, edit, stats — in one row that scrolls
 * horizontally instead of wrapping to 2-3 rows on a narrow window (the
 * monolith this replaced used `flexWrap="wrap"`, which is what pushed the
 * viewport down). A priority "More" menu was rejected (level-editor-ui-
 * improvements.md slice 5): it needs `ResizeObserver` measurement jsdom
 * cannot exercise, and moving controls into a `Menu` breaks synchronous
 * `getByTestId` lookups the 178-case editing suite depends on.
 *
 * All state stays in `WorldSurface`; this and its four children are pure
 * props-down/callbacks-up. Every testid, enablement rule and `{summary &&
 * …}`-shaped guard (here, `hasWorld`) moved verbatim from the surface's own
 * JSX.
 */
export type WorldToolbarProps =
  WorldFileControlsProps & WorldOverlayControlsProps & WorldEditControlsProps & WorldStatsChipsProps;

const WorldToolbar: React.FC<WorldToolbarProps> = (props) => (
  <Paper square elevation={1} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ flexWrap: 'nowrap', overflowX: 'auto' }}
    >
      <Box
        data-testid="world-toolbar-file"
        sx={{ display: 'flex', flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 0 }}
      >
        <WorldFileControls {...props} />
      </Box>
      <Divider orientation="vertical" flexItem />
      <Box
        data-testid="world-toolbar-overlays"
        sx={{ display: 'flex', flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 0 }}
      >
        <WorldOverlayControls {...props} />
      </Box>
      <Divider orientation="vertical" flexItem />
      <Box
        data-testid="world-toolbar-edit"
        sx={{ display: 'flex', flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 0 }}
      >
        <WorldEditControls {...props} />
      </Box>
      <Divider orientation="vertical" flexItem />
      <Box
        data-testid="world-toolbar-stats"
        sx={{ display: 'flex', flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 0 }}
      >
        <WorldStatsChips {...props} />
      </Box>
    </Stack>
  </Paper>
);

export default WorldToolbar;
