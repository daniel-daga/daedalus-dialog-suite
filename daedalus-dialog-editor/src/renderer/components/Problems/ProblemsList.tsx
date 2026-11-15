import React, { useState } from 'react';
import { Box, Button, Chip, List, ListItem, ListItemButton, ListItemText, TablePagination, Typography } from '@mui/material';
import { searchablePaneRowButtonSx } from '../common/searchablePaneStyles';
import type { Problem, ProblemRuleId } from '../../problems/domain/types';

export const RULE_LABEL: Record<ProblemRuleId, string> = {
  'parse-error': 'Syntax error',
  'npc-not-found': 'Missing NPC',
  'knowsinfo-dangling': 'Dangling KnowsInfo',
  'choice-no-clearchoices': 'No ClearChoices',
  'orphaned-function': 'Orphaned function',
  'function-overload': 'Function overload',
  'voice-id-duplicate': 'Duplicate voice ID',
  'voice-id-malformed': 'Malformed voice ID',
  'output-unit-stale': 'Subtitle not in the OUs',
  'output-unit-missing': 'Line not in the OUs',
  'waypoint-not-in-world': 'Waypoint not in world',
  'duplicate-spawn': 'NPC spawned twice',
  'portal-material-malformed': 'Malformed portal name',
  'portal-material-unknown-sector': 'Portal names unknown sector',
  'routine-overlap': 'Routine overlap',
  'routine-mob-missing': 'No mob nearby',
  'portal-unpaired': 'Portal unpaired',
  'portal-non-planar': 'Portal not flat',
  'portal-reversed': 'Portal reversed'
};

export const SEVERITY_LABEL: Record<Problem['severity'], string> = { error: 'Error', warning: 'Warning', hint: 'Hint' };

const baseName =(filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

export const secondaryText = ({ locus }: Problem): string => {
  if (locus.kind === 'world') {
    if (locus.waypoint) return `World · ${locus.waypoint}`;
    if (locus.vob !== undefined) return `World · VOB ${locus.vob}`;
    if (locus.polygon !== undefined) return `World · polygon ${locus.polygon}`;
    return 'World';
  }
  const parts = [baseName(locus.filePath)];
  // Both, where there are both: the declaration gives context,
  // and the line tells two findings inside it apart (`ScriptLocus.line`).
  // A syntax error has only the line; a model the editor built has only the
  // declaration.
  if (locus.dialogName) parts.push(locus.dialogName);
  else if (locus.functionName) parts.push(locus.functionName);
  if (locus.line !== undefined) parts.push(`line ${locus.line}`);
  return parts.join(' · ');
};

/**
 * The name an "Add to world" action would send to `AddWaypoint`, or null when
 * this row offers no such action: only `waypoint-not-in-world` names a place
 * the open world could gain, and only while there is one open to gain it in.
 */
const addableWaypoint = (problem: Problem, worldOpen: boolean): string | null => {
  if (problem.rule !== 'waypoint-not-in-world' || !worldOpen) return null;
  return problem.locus.kind === 'script' ? (problem.locus.waypoint ?? null) : null;
};

interface ProblemsListProps {
  problems: Problem[];
  emptyMessage?: string;
  onSelect: (problem: Problem) => void;
  /** Whether a world is open for the explicit Add to world action. */
  worldOpen?: boolean;
  /**
   * Adds the named waypoint to the open world — the `waypoint-not-in-world`
   * row's own second action (`addableWaypoint`). Separate from `onSelect`,
    * which opens details. Adding a waypoint stays an explicit opt-in.
   */
  onAddToWorld?: (name: string) => void;
}

/**
 * Presentational list of project-wide lint problems. Each row opens details via
 * `onSelect`; severity is shown as a color-coded chip.
 */
const ProblemsList: React.FC<ProblemsListProps> = ({
  problems, onSelect, worldOpen = false, onAddToWorld, emptyMessage = 'No problems found.',
}) => {
  const [pagination, setPagination] = useState({ problems, page: 0 });
  // Filters and rescans start at the first page; detail inspection does not change the input.
  const page = pagination.problems === problems ? pagination.page : 0;
  const pageSize = 50;
  return (
  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
  <List dense disablePadding data-testid="problems-list" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
    {problems.slice(page * pageSize, (page + 1) * pageSize).map((problem, offset) => {
      const index = page * pageSize + offset;
      const waypoint = onAddToWorld ? addableWaypoint(problem, worldOpen) : null;
      return (
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
                  label={SEVERITY_LABEL[problem.severity]}
                  color={problem.severity === 'hint' ? 'info' : problem.severity}
                  variant="outlined"
                />
                <Chip size="small" label={RULE_LABEL[problem.rule]} variant="outlined" />
                {waypoint !== null && (
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ ml: 'auto' }}
                    onClick={(event) => {
                       // Keep the explicit action separate from opening details.
                      event.stopPropagation();
                      onAddToWorld?.(waypoint);
                    }}
                    data-testid={`problem-row-${index}-add-to-world`}
                  >
                    Add to world
                  </Button>
                )}
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
      );
    })}
    {problems.length === 0 && (
      <Box sx={{ px: 2, py: 3 }}>
        <Typography variant="body2" color="text.secondary" data-testid="problems-empty">
          {emptyMessage}
        </Typography>
      </Box>
    )}
  </List>
  {problems.length > pageSize && <TablePagination
    component="div" count={problems.length} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[]}
    showFirstButton showLastButton
    onPageChange={(_, nextPage) => setPagination({ problems, page: nextPage })}
  />}
  </Box>
  );
};

export default ProblemsList;
