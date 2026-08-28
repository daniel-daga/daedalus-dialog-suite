import React, { useEffect, useState } from 'react';
import { Box, List, ListItem, ListItemText, TextField, Typography } from '@mui/material';

/**
 * The right-panel counterpart of a selected waypoint (level-editor.md §16.8
 * W2) — a waypoint had no UI at all before this. The routine list is read-only:
 * what a jump into the source file would need (the mount-lifetime fix in
 * refactoring-targets.md) is W4's job, not this one. The *name* is not, since
 * §16.7's W1 — this panel is the only UI a waypoint has, so it is where the one
 * waynet edit that is not a gizmo drag lives.
 *
 * `routines` is looked up by the caller from `projectStore`'s
 * `waypointSiteIndex`, keyed uppercase because Daedalus is case-insensitive;
 * the name shown is the waypoint's own casing from the waynet payload.
 */
const WaypointPanel: React.FC<{
  name: string;
  routines: Array<{ filePath: string; functionName: string }>;
  onRename: (to: string) => void;
}> = ({ name, routines, onRename }) => {
  const baseName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

  // The field shows what the waynet payload says, and goes back to it the moment
  // the edit is handed on. A rename the world refuses never reaches the payload,
  // so the name it was refused for is exactly what must not stay on screen — and
  // a rename it takes comes back through this prop.
  const [draft, setDraft] = useState(name);
  useEffect(() => { setDraft(name); }, [name]);

  const commit = (): void => {
    const renamed = draft.trim();
    setDraft(name);
    // An unchanged name is not an edit, and an empty one is not a name: the
    // index+name pair every waynet op is guarded by would have nothing to check.
    if (renamed !== '' && renamed !== name) onRename(renamed);
  };

  return (
    <Box sx={{ p: 1.5 }} data-testid="world-waypoint-panel">
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') setDraft(name);
        }}
        size="small"
        fullWidth
        variant="standard"
        inputProps={{ 'data-testid': 'world-waypoint-name-input', spellCheck: false }}
      />
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
