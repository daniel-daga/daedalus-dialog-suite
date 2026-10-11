import React, { useMemo, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  Link, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import type { InstancedPayload, WorldSummary } from '../../../../shared/worldTypes';

/**
 * The visual types that correctly never resolve to a mesh, and are therefore
 * not a missing asset.
 *
 * A decal names a texture and a `.pfx` names a Daedalus instance; every retail
 * world counts thousands of both into `unresolvedByType`. Reporting them would
 * put a permanent warning on a world that is perfectly fine, which is how a
 * warning stops being read.
 */
const EXPECTED_UNRESOLVED: ReadonlySet<string> = new Set(['DECAL', 'PARTICLE_EFFECT']);

/**
 * The status bar's counts (level-editor.md §17): VOBs, triangles, draw calls
 * and — once the visuals payload has arrived — placed VOBs. One line of
 * tabular figures at the bar's right edge; they used to be four chips in the
 * toolbar, where they were the widest group and the first to wrap.
 *
 * It also carries the missing-asset report (#273). The scene already counted
 * what did not resolve and the layers already draw around it; nothing said so
 * to the user, and for a custom-asset map — a mod whose meshes are not mounted
 * — that list *is* the diagnosis, the thing the Spacer report says you go and
 * read zSpy for. So: a count in the bar, and the names one click away.
 */
export interface WorldStatusStatsProps {
  summary: WorldSummary;
  visuals: InstancedPayload | null;
}

const WorldStatusStats: React.FC<WorldStatusStatsProps> = ({ summary, visuals }) => {
  const [reportOpen, setReportOpen] = useState(false);

  const missing = useMemo(
    () => (visuals?.stats.unresolved ?? []).filter((entry) => !EXPECTED_UNRESOLVED.has(entry.type)),
    [visuals],
  );

  return (
    <>
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
        {missing.length > 0 && (
          <>
            {' · '}
            <Link
              component="button"
              variant="caption"
              color="warning.main"
              underline="hover"
              onClick={() => setReportOpen(true)}
              data-testid="world-unresolved-open"
            >
              {/* Distinct visuals, not VOBs: it is the number of things to go
                  and find, which is what a person can act on. */}
              {`${missing.length.toLocaleString()} unresolved`}
            </Link>
          </>
        )}
      </Typography>

      <Dialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Visuals that did not resolve</DialogTitle>
        <DialogContent>
          <DialogContentText variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            The world loaded, and these visuals were not found in the mounted asset
            sources — so every VOB using one is invisible. Decals and particle
            effects are not listed: they name a texture and a script instance
            rather than a mesh, so they never resolve to one.
          </DialogContentText>
          <Table size="small" data-testid="world-unresolved-report">
            <TableHead>
              <TableRow>
                <TableCell>Visual</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">VOBs</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {missing.map((entry) => (
                <TableRow key={entry.name}>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{entry.name}</TableCell>
                  <TableCell>{entry.type}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {entry.count.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReportOpen(false)} data-testid="world-unresolved-close">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default WorldStatusStats;
