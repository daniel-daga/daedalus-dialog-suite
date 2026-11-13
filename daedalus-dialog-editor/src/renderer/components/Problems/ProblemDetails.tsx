import React from 'react';
import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import type { Problem } from '../../problems/domain/types';
import ScriptFileActions from '../ScriptFileActions';
import { RULE_LABEL, SEVERITY_LABEL, secondaryText } from './ProblemsList';

interface ProblemDetailsProps {
  problem: Problem;
  onReload: () => Promise<void>;
}

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
        </Paper>
        {problem.outputUnitLine && <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2">Script subtitle</Typography>
          <Typography variant="body2">{problem.outputUnitLine.name}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{problem.outputUnitLine.text}</Typography>
        </Paper>}
        {locus.kind === 'script' && <ScriptFileActions filePath={locus.filePath} onReload={onReload} />}
      </Stack>
    </Box>
  );
};

export default ProblemDetails;
