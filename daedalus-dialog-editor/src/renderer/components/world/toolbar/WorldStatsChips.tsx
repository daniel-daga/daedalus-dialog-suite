import React from 'react';
import { Chip, Stack } from '@mui/material';
import type { InstancedPayload, WorldSummary } from '../../../../shared/worldTypes';

/**
 * The World bar's "stats" group (level-editor-ui-improvements.md slice 5):
 * VOB count, triangle count, draw-call count and (once the visuals payload
 * has arrived) placed count. Moved verbatim out of `WorldSurface.tsx`.
 */
export interface WorldStatsChipsProps {
  summary: WorldSummary | null;
  visuals: InstancedPayload | null;
}

const WorldStatsChips: React.FC<WorldStatsChipsProps> = ({ summary, visuals }) => (
  <>
    {summary && (
      <Stack direction="row" spacing={1}>
        <Chip size="small" label={`${summary.stats.vobCount.toLocaleString()} VOBs`} />
        <Chip size="small" label={`${summary.stats.worldTriangles.toLocaleString()} triangles`} />
        <Chip size="small" label={`${summary.stats.worldDrawGroups} world draw calls`} />
        {visuals && <Chip size="small" label={`${visuals.stats.vobsPlaced.toLocaleString()} placed`} />}
      </Stack>
    )}
  </>
);

export default WorldStatsChips;
