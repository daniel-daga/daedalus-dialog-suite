import React from 'react';
import { Box, Button, Chip, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
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
  'duplicate-spawn': 'NPC spawned twice',
  'portal-material-malformed': 'Malformed portal name',
  'portal-material-unknown-sector': 'Portal names unknown sector',
  'portal-unpaired': 'Portal unpaired',
  'portal-non-planar': 'Portal not flat',
  'portal-reversed': 'Portal reversed'
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
 * the VOB index nor a name in the waynet, and is listed without a jump —
 * §16.20 slice 3 landed the portal findings that way on purpose (Daniel,
 * 2026-09-02): framing a polygon is not designed, and not built.
 */
const isNavigable = (problem: Problem, worldOpen: boolean): boolean => (
  problem.locus.kind !== 'world'
    ? true
    : worldOpen && worldFocusOf(problem.locus) !== null
);

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
  onSelect: (problem: Problem) => void;
  /** Whether a world is open, which is half of what makes a world row clickable. */
  worldOpen?: boolean;
  /**
   * Adds the named waypoint to the open world — the `waypoint-not-in-world`
   * row's own second action (`addableWaypoint`). Separate from `onSelect`,
   * which still goes to the script: the name may belong to another world
   * (level-editor.md §16.8), so navigating there stays the row's primary
   * click and this is an explicit opt-in beside it.
   */
  onAddToWorld?: (name: string) => void;
}

/**
 * Presentational list of project-wide lint problems. Each row is navigable via
 * `onSelect`; severity is shown as a color-coded chip.
 */
const ProblemsList: React.FC<ProblemsListProps> = ({
  problems, onSelect, worldOpen = false, onAddToWorld,
}) => (
  <List dense disablePadding data-testid="problems-list" sx={{ height: '100%', overflowY: 'auto' }}>
    {problems.map((problem, index) => {
      const waypoint = onAddToWorld ? addableWaypoint(problem, worldOpen) : null;
      return (
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
                {waypoint !== null && (
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ ml: 'auto' }}
                    onClick={(event) => {
                      // The row underneath navigates to the script; this must not.
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
          No problems found.
        </Typography>
      </Box>
    )}
  </List>
);

export default ProblemsList;
