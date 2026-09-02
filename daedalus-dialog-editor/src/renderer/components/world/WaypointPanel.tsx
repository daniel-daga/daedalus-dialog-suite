import React, { useEffect, useState } from 'react';
import {
  Box, Button, List, ListItem, ListItemText, Stack, TextField, Typography,
} from '@mui/material';

/**
 * The right-panel counterpart of a selected waypoint (level-editor.md §16.8
 * W2) — a waypoint had no UI at all before this. The site list is read-only:
 * a jump into the source file is W4's job, not this one — the mount-lifetime
 * fix it waited on landed (refactoring-targets.md §8). The *name* is not, since
 * §16.7's W1 — this panel is the only UI a waypoint has, so it is where the one
 * waynet edit that is not a gizmo drag lives.
 *
 * `routines` is looked up by the caller from `projectStore`'s
 * `waypointSiteIndex`, keyed uppercase because Daedalus is case-insensitive;
 * the name shown is the waypoint's own casing from the waynet payload.
 *
 * `spawns` is §16.19 slice 3: without it the panel lists sites and three NPCs
 * inserted here read like a routine passing through. The two indexes overlap —
 * `extractWaypointSites` visits `Wld_InsertNpc` too — so a site a spawn already
 * accounts for is dropped from the routine list rather than shown twice.
 *
 * The edges are §16.7's W3 and live here for W1's reason — this is the only UI
 * a waypoint has. A neighbour is named rather than picked in the viewport
 * because an edge needs a *second* selection and the surface has one; the name
 * is resolved by the caller, which is the side holding the point list.
 *
 * The delete is §16.7's W4 and is here for the same reason, but it is the one
 * control that does not commit: it *asks*, because the op is a barrier (§15)
 * and the surface owns the warning that has to come before it.
 */
const WaypointPanel: React.FC<{
  name: string;
  routines: Array<{ filePath: string; functionName: string }>;
  /** The statically resolvable spawns at this waypoint. Instance names are
   *  uppercase: that is what the index holds, and the script has no other. */
  spawns: Array<{ instance: string; filePath: string; functionName: string }>;
  onRename: (to: string) => void;
  /** The other end of every edge this waypoint is in. */
  neighbours: Array<{ waypoint: number; name: string }>;
  /** The waypoint a typed name would join to, or null when there is none to
   *  join — the selection itself and one it is already joined to both answer
   *  null, so the button is dead rather than the edit refused. */
  resolveWaypoint: (typed: string) => number | null;
  onConnect: (waypoint: number) => void;
  onDisconnect: (waypoint: number) => void;
  /** Asks to delete this waypoint. Not a commit: the op is a barrier, and the
   *  warning that has to precede it is the surface's. */
  onDelete: () => void;
  /** Asks to spawn an NPC here (§16.19 slice 16 D) — the existing-waypoint
   *  variant of the terrain bar's "Insert NPC here…", so no waypoint op. */
  onInsertNpc: () => void;
}> = ({
  name, routines, spawns, onRename, neighbours, resolveWaypoint, onConnect, onDisconnect,
  onDelete, onInsertNpc,
}) => {
  const baseName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

  // The field shows what the waynet payload says, and goes back to it the moment
  // the edit is handed on. A rename the world refuses never reaches the payload,
  // so the name it was refused for is exactly what must not stay on screen — and
  // a rename it takes comes back through this prop.
  const [draft, setDraft] = useState(name);
  useEffect(() => { setDraft(name); }, [name]);

  // The name being typed into the connect field, and what it resolves to.
  // Cleared when the selection changes: a name typed against one waypoint's
  // neighbour list means nothing against another's.
  const [joinDraft, setJoinDraft] = useState('');
  useEffect(() => { setJoinDraft(''); }, [name]);
  const joinTarget = resolveWaypoint(joinDraft);

  const commit = (): void => {
    const renamed = draft.trim();
    setDraft(name);
    // An unchanged name is not an edit, and an empty one is not a name: the
    // index+name pair every waynet op is guarded by would have nothing to check.
    if (renamed !== '' && renamed !== name) onRename(renamed);
  };

  // The field empties on a join the surface accepted, and the neighbour list it
  // hands back is what says the edge is there — the same shape the name field
  // has, where the payload is the answer and this component never assumes one.
  // One routine row per spawn is the same call seen through the other index, so
  // each spawn cancels exactly one site in its own file and function — a count,
  // not a filter: a function may genuinely name the waypoint as well as spawn
  // into it, and that mention is still worth listing.
  const spawnedIn = new Map<string, number>();
  for (const spawn of spawns) {
    const key = `${spawn.filePath}:${spawn.functionName}`;
    spawnedIn.set(key, (spawnedIn.get(key) || 0) + 1);
  }
  const otherSites = routines.filter((routine) => {
    const key = `${routine.filePath}:${routine.functionName}`;
    const left = spawnedIn.get(key) || 0;
    if (left === 0) return true;
    spawnedIn.set(key, left - 1);
    return false;
  });

  const join = (waypoint: number): void => {
    setJoinDraft('');
    onConnect(waypoint);
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
      {spawns.length > 0 && (
        <List dense disablePadding data-testid="world-waypoint-spawns">
          {spawns.map((spawn, index) => (
            <ListItem key={`${spawn.filePath}:${spawn.functionName}:${spawn.instance}:${index}`} disablePadding sx={{ py: 0.25 }}>
              <ListItemText
                primary={spawn.instance}
                secondary={`spawned in ${spawn.functionName} — ${baseName(spawn.filePath)}`}
                primaryTypographyProps={{ variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
              />
            </ListItem>
          ))}
        </List>
      )}
      {otherSites.length === 0 && spawns.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No script in this project names it.
        </Typography>
      ) : (
        <List dense disablePadding data-testid="world-waypoint-sites">
          {otherSites.map((routine, index) => (
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
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Edges
      </Typography>
      {neighbours.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          In no edge.
        </Typography>
      ) : (
        <List dense disablePadding data-testid="world-waypoint-edges">
          {neighbours.map((neighbour) => (
            <ListItem
              key={neighbour.waypoint}
              disablePadding
              sx={{ py: 0.25 }}
              secondaryAction={(
                <Button
                  size="small"
                  onClick={() => onDisconnect(neighbour.waypoint)}
                  data-testid={`world-waypoint-disconnect-${neighbour.waypoint}`}
                >
                  Disconnect
                </Button>
              )}
            >
              <ListItemText
                primary={neighbour.name}
                primaryTypographyProps={{ variant: 'body2' }}
              />
            </ListItem>
          ))}
        </List>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="flex-end">
        <TextField
          value={joinDraft}
          onChange={(event) => setJoinDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && joinTarget !== null) join(joinTarget);
          }}
          placeholder="Connect to…"
          size="small"
          fullWidth
          variant="standard"
          inputProps={{ 'data-testid': 'world-waypoint-join-name', spellCheck: false }}
        />
        <Button
          size="small"
          disabled={joinTarget === null}
          onClick={() => joinTarget !== null && join(joinTarget)}
          data-testid="world-waypoint-connect"
        >
          Connect
        </Button>
      </Stack>
      <Button
        size="small"
        variant="outlined"
        fullWidth
        sx={{ mt: 2 }}
        onClick={onInsertNpc}
        data-testid="world-waypoint-insert-npc"
      >
        Insert NPC at this waypoint…
      </Button>
      <Button
        size="small"
        color="error"
        variant="outlined"
        fullWidth
        sx={{ mt: 1 }}
        onClick={onDelete}
        data-testid="world-waypoint-delete"
      >
        Delete waypoint
      </Button>
    </Box>
  );
};

export default WaypointPanel;
