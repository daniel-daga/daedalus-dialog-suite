import React from 'react';
import { Box, List, ListItem, ListItemText, Typography } from '@mui/material';

/**
 * The right-panel counterpart of a selected waypoint (level-editor.md §16.8
 * W2) — a waypoint had no UI at all before this. It is read-only: what a
 * jump into the source file would need (the mount-lifetime fix in
 * refactoring-targets.md) is W4's job, not this one.
 *
 * `routines` is looked up by the caller from `projectStore`'s
 * `waypointSiteIndex`, keyed uppercase because Daedalus is case-insensitive;
 * the name shown is the waypoint's own casing from the waynet payload.
 */
const WaypointPanel: React.FC<{
  name: string;
  routines: Array<{ filePath: string; functionName: string }>;
}> = ({ name, routines }) => {
  const baseName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

  return (
    <Box sx={{ p: 1.5 }} data-testid="world-waypoint-panel">
      <Typography variant="subtitle2">{name}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1 }}>
        Waypoint
      </Typography>
      {routines.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No routine in this project names it.
        </Typography>
      ) : (
        <List dense disablePadding>
          {routines.map((routine, index) => (
            <ListItem key={`${routine.filePath}:${routine.functionName}:${index}`} disablePadding sx={{ py: 0.25 }}>
              <ListItemText
                primary={routine.functionName}
                secondary={baseName(routine.filePath)}
                primaryTypographyProps={{ variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};

export default WaypointPanel;
