import React from 'react';
import { Box, Chip, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
import { searchablePaneRowButtonSx } from '../common/searchablePaneStyles';
import type { Problem, ProblemRuleId } from '../../problems/domain/types';

const RULE_LABEL: Record<ProblemRuleId, string> = {
  'npc-not-found': 'Missing NPC',
  'knowsinfo-dangling': 'Dangling KnowsInfo',
  'choice-no-clearchoices': 'No ClearChoices',
  'orphaned-function': 'Orphaned function',
  'voice-id-duplicate': 'Duplicate voice ID',
  'voice-id-malformed': 'Malformed voice ID',
  'waypoint-not-in-world': 'Waypoint not in world',
  'duplicate-spawn': 'NPC spawned twice'
};

const baseName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

const secondaryText = (problem: Problem): string => {
  const parts = [baseName(problem.filePath)];
  if (problem.dialogName) parts.push(problem.dialogName);
  else if (problem.functionName) parts.push(problem.functionName);
  return parts.join(' · ');
};

interface ProblemsListProps {
  problems: Problem[];
  onSelect: (problem: Problem) => void;
}

/**
 * Presentational list of project-wide lint problems. Each row is navigable via
 * `onSelect`; severity is shown as a color-coded chip.
 */
const ProblemsList: React.FC<ProblemsListProps> = ({ problems, onSelect }) => (
  <List dense disablePadding data-testid="problems-list" sx={{ height: '100%', overflowY: 'auto' }}>
    {problems.map((problem, index) => (
      <ListItem key={problem.id} disablePadding>
        <ListItemButton
          sx={searchablePaneRowButtonSx}
          onClick={() => onSelect(problem)}
          data-testid={`problem-row-${index}`}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: '100%', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                size="small"
                label={problem.severity === 'error' ? 'Error' : 'Warning'}
                color={problem.severity === 'error' ? 'error' : 'warning'}
                variant="outlined"
              />
              <Chip size="small" label={RULE_LABEL[problem.rule]} variant="outlined" />
            </Box>
            <ListItemText
              primary={problem.message}
              secondary={secondaryText(problem)}
              primaryTypographyProps={{ variant: 'body2' }}
              secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
              sx={{ m: 0 }}
            />
          </Box>
        </ListItemButton>
      </ListItem>
    ))}
    {problems.length === 0 && (
      <Box sx={{ px: 2, py: 3 }}>
        <Typography variant="body2" color="text.secondary" data-testid="problems-empty">
          No problems found.
        </Typography>
      </Box>
    )}
  </List>
);

export default ProblemsList;
