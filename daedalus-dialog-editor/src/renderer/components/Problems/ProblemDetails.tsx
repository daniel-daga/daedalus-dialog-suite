import React from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Public as WorldIcon } from '@mui/icons-material';
import type { Problem, WorldLocus } from '../../problems/domain/types';
import { useUISelectionStore } from '../../store/uiSelectionStore';
import { useWorldStore, worldFocusOf } from '../../store/worldStore';
import ScriptFileActions from '../ScriptFileActions';
import { RULE_LABEL, SEVERITY_LABEL, secondaryText } from './ProblemsList';

interface ProblemDetailsProps {
  problem: Problem;
  onReload: () => Promise<void>;
}

/**
 * Where a world finding is (#565). The addresses are the locus's own; the file
 * and a VOB's name come from the world that is open now, which is the only
 * world a finding can be about — the scan drops them when it closes.
 */
const WorldLocation: React.FC<{ locus: WorldLocus }> = ({ locus }) => {
  const worldPath = useWorldStore((s) => s.summary?.worldPath ?? null);
  const vobName = useWorldStore((s) => (
    locus.vob === undefined ? '' : s.summary?.vobIndex.names[locus.vob] ?? ''
  ));
  const placed = locus.waypoint !== undefined || locus.vob !== undefined || locus.polygon !== undefined;
  return <>
    {worldPath && <Typography variant="body2">World: {worldPath}</Typography>}
    {locus.waypoint !== undefined && <Typography variant="body2">Waypoint: {locus.waypoint}</Typography>}
    {locus.vob !== undefined && (
      <Typography variant="body2">VOB: {locus.vob}{vobName ? ` (${vobName})` : ''}</Typography>
    )}
    {locus.polygon !== undefined && <Typography variant="body2">Polygon: {locus.polygon}</Typography>}
    {!placed && (
      <Typography variant="body2" color="text.secondary">
        This finding names no place in the world; the message says what it is about.
      </Typography>
    )}
  </>;
};

/**
 * The one way out of Problems to a world finding (#565). A row click only
 * inspects (#560), so the jump is this explicit button: it leaves the request
 * in the world store for the World surface to take, and switches to it.
 * Nothing is offered for a locus the surface has nothing to frame for.
 */
const ShowInWorld: React.FC<{ locus: WorldLocus }> = ({ locus }) => {
  const worldOpen = useWorldStore((s) => s.status === 'ready');
  const focus = worldFocusOf(locus);
  if (focus === null) return null;
  return (
    <Box>
      <Button
        variant="contained" startIcon={<WorldIcon />} disabled={!worldOpen}
        onClick={() => {
          useWorldStore.getState().requestFocus(focus);
          useUISelectionStore.getState().setActiveView('world');
        }}
      >
        Show in World
      </Button>
      {!worldOpen && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Open the world in the World Editor to show this finding there.
        </Typography>
      )}
    </Box>
  );
};

const ProblemDetails: React.FC<ProblemDetailsProps> = ({ problem, onReload }) => {
  const { locus } = problem;
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      <Stack spacing={2} sx={{ maxWidth: 1000, mx: 'auto', overflowWrap: 'anywhere' }}>
        <Typography variant="h5" component="h1">{RULE_LABEL[problem.rule]}</Typography>
        <Alert severity={problem.severity === 'hint' ? 'info' : problem.severity}>
          {problem.message}
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2">Location</Typography>
          <Typography variant="body2">{SEVERITY_LABEL[problem.severity]} · {secondaryText(problem)}</Typography>
          {locus.kind === 'script' && <>
            <Typography variant="body2">{locus.filePath}</Typography>
            {locus.npc && <Typography variant="body2">NPC: {locus.npc}</Typography>}
            {locus.dialogName && <Typography variant="body2">Dialog: {locus.dialogName}</Typography>}
            {locus.functionName && <Typography variant="body2">Function: {locus.functionName}</Typography>}
            {locus.line !== undefined && <Typography variant="body2">Line {locus.line}</Typography>}
            {locus.waypoint && <Typography variant="body2">Waypoint: {locus.waypoint}</Typography>}
          </>}
          {locus.kind === 'world' && <WorldLocation locus={locus} />}
        </Paper>
        {problem.outputUnitLine && <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2">Script subtitle</Typography>
          <Typography variant="body2">{problem.outputUnitLine.name}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{problem.outputUnitLine.text}</Typography>
        </Paper>}
        {locus.kind === 'script' && <ScriptFileActions filePath={locus.filePath} onReload={onReload} />}
        {locus.kind === 'world' && <ShowInWorld locus={locus} />}
      </Stack>
    </Box>
  );
};

export default ProblemDetails;
