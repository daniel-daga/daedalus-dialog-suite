import React from 'react';
import { Box, Chip, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
import { searchablePaneRowButtonSx } from '../common/searchablePaneStyles';
import type { Problem, ProblemRuleId } from '../../problems/domain/types';
import { worldFocusOf } from '../../store/worldStore';

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

const secondaryText = ({ locus }: Problem): string => {
  if (locus.kind === 'world') {
    if (locus.waypoint) return `World · ${locus.waypoint}`;
    if (locus.vob !== undefined) return `World · VOB ${locus.vob}`;
    if (locus.polygon !== undefined) return `World · polygon ${locus.polygon}`;
    return 'World';
  }
  const parts = [baseName(locus.filePath)];
  if (locus.dialogName) parts.push(locus.dialogName);
  else if (locus.functionName) parts.push(locus.functionName);
  return parts.join(' · ');
};

/**
 * Whether clicking the row leads anywhere. A script problem always does. A
 * world problem needs the world open — the editor holds one at a time — and an
 * address the World surface can jump to; a polygon locus has neither a row in
 * the VOB index nor a name in the waynet, and is listed without a jump until
 * §16.20 slice 3 gives it one.
 */
const isNavigable = (problem: Problem, worldOpen: boolean): boolean => (
  problem.locus.kind !== 'world'
    ? true
    : worldOpen && worldFocusOf(problem.locus) !== null
);

interface ProblemsListProps {
  problems: Problem[];
  onSelect: (problem: Problem) => void;
  /** Whether a world is open, which is half of what makes a world row clickable. */
  worldOpen?: boolean;
}

/**
 * Presentational list of project-wide lint problems. Each row is navigable via
 * `onSelect`; severity is shown as a color-coded chip.
 */
const ProblemsList: React.FC<ProblemsListProps> = ({ problems, onSelect, worldOpen = false }) => (
  <List dense disablePadding data-testid="problems-list" sx={{ height: '100%', overflowY: 'auto' }}>
    {problems.map((problem, index) => (
      <ListItem key={problem.id} disablePadding>
        <ListItemButton
          sx={searchablePaneRowButtonSx}
          onClick={() => onSelect(problem)}
          disabled={!isNavigable(problem, worldOpen)}
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
