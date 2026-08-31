import React from 'react';
import { Chip, Stack } from '@mui/material';
import type { InstancedPayload, WorldSummary } from '../../../../shared/worldTypes';

/**
 * The World bar's "stats" group (level-editor.md §17):
 * VOB count, triangle count, draw-call count and (once the visuals payload
 * has arrived) placed count. Moved verbatim out of `WorldSurface.tsx`.
 */
export interface WorldStatsChipsProps {
  summary: WorldSummary | null;
  visuals: InstancedPayload | null;
}

/** The three counts that always have a slot in the row, and the outlined
 *  "—" they fall back to with no world open — never a bare 0, which would
 *  read as an empty world rather than as no data at all. Always rendered,
 *  never conditionally mounted: a Chip that pops in and out at open/close
 *  shifts every group after it in the row. */
const StatChip: React.FC<{ label: string | null }> = ({ label }) => (
  <Chip size="small" variant={label === null ? 'outlined' : 'filled'} label={label ?? '—'} />
);

const WorldStatsChips: React.FC<WorldStatsChipsProps> = ({ summary, visuals }) => (
  <Stack direction="row" spacing={1}>
    <StatChip label={summary && `${summary.stats.vobCount.toLocaleString()} VOBs`} />
    <StatChip label={summary && `${summary.stats.worldTriangles.toLocaleString()} triangles`} />
    <StatChip label={summary && `${summary.stats.worldDrawGroups} world draw calls`} />
    {/* The one exception: whether the visuals payload has arrived yet is a
        real fact only while a world is already open (the brief window
        between the summary landing and the visuals fetch resolving), not a
        second "no world" state to render a placeholder for. */}
    {visuals && <Chip size="small" label={`${visuals.stats.vobsPlaced.toLocaleString()} placed`} />}
  </Stack>
);

export default WorldStatsChips;
