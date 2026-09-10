import React from 'react';
import { Typography } from '@mui/material';
import type { InstancedPayload, WorldSummary } from '../../../../shared/worldTypes';

/**
 * The status bar's counts (level-editor.md §17): VOBs, triangles, draw calls
 * and — once the visuals payload has arrived — placed VOBs. One line of
 * tabular figures at the bar's right edge; they used to be four chips in the
 * toolbar, where they were the widest group and the first to wrap.
 */
export interface WorldStatusStatsProps {
  summary: WorldSummary;
  visuals: InstancedPayload | null;
}

const WorldStatusStats: React.FC<WorldStatusStatsProps> = ({ summary, visuals }) => (
  <Typography
    variant="caption"
    color="text.secondary"
    noWrap
    sx={{ ml: 'auto', pl: 2, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
    data-testid="world-status-stats"
  >
    {`${summary.stats.vobCount.toLocaleString()} VOBs`}
    {` · ${summary.stats.worldTriangles.toLocaleString()} triangles`}
    {` · ${summary.stats.worldDrawGroups} draw calls`}
    {/* Whether the visuals payload has arrived yet is a real fact only in the
        brief window between the summary landing and the visuals fetch
        resolving — not a second state to render a placeholder for. */}
    {visuals && ` · ${visuals.stats.vobsPlaced.toLocaleString()} placed`}
  </Typography>
);

export default WorldStatusStats;
