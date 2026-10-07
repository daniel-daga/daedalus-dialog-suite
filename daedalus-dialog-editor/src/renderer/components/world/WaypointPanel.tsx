import React, { useEffect, useState } from 'react';
import {
  Box, Button, List, ListItem, ListItemButton, ListItemText, Stack, TextField, Typography,
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
 * Who stands here is also where a routine is edited from inside the world
 * (npc-editor.md §6, Daniel 2026-09-29): a spawn marker's click selects this
 * waypoint, so every NPC spawned here or with a routine stopping here carries
 * one "Edit routines" button — one per NPC, not per row of either index. A spawn's NPC has its routine drawn while this
 * waypoint is selected (Daniel, 2026-09-30); when several share it, their rows
 * choose whose.
 *
 * The delete is §16.7's W4 and is here for the same reason, but it is the one
 * control that does not commit: it *asks*, because the op is a barrier (§15)
 * and the surface owns the warning that has to come before it.
 */
const WaypointPanel: React.FC<{
  name: string;
  /** `npc` is who runs the routine, where the function is one the index
   *  knows as an NPC's daily routine or state variant. */
  routines: Array<{ filePath: string; functionName: string; npc?: string | null }>;
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
  /** Open routine mode on this NPC, on `routine` if given. */
  onEditRoutines?: (npc: string, routine?: string) => void;
  /** The NPCs spawned here whose daily routine can be drawn, uppercase. */
  routineNpcs?: readonly string[];
  /** Whose routine is drawn on the map now, if anyone's. */
  shownRoutineNpc?: string | null;
  /** Draw this NPC's routine instead, when several share the spawn. */
  onShowRoutineNpc?: (npc: string) => void;
}> = ({
  name, routines, spawns, onRename, neighbours, resolveWaypoint, onConnect, onDisconnect,
  onDelete, onInsertNpc, onEditRoutines, routineNpcs = [], shownRoutineNpc = null, onShowRoutineNpc,
}) => {
  const editButton = (npc: string, routine?: string) => onEditRoutines && (
    <Button
      size="small"
      sx={{ minWidth: 0, fontSize: 11, flexShrink: 0 }}
      aria-label={`Edit routines of ${npc}`}
      onClick={() => onEditRoutines(npc, routine)}
    >
      Routines
    </Button>
  );
  // A row's button sits in the flow beside its text rather than in MUI's
  // `secondaryAction`, which is absolutely positioned and, under `disablePadding`,
  // reserves no room — the text ran under the button. Script names are one long
  // token, so they break anywhere rather than push the button out.
  const rowSx = { py: 0.25, gap: 1 } as const;
  const primaryProps = { variant: 'body2', sx: { overflowWrap: 'anywhere' } } as const;
  const secondaryProps = {
    variant: 'caption', color: 'text.secondary', sx: { overflowWrap: 'anywhere' },
  } as const;
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

  // One row and one "Routines" button per NPC (Daniel, 2026-10-07): a spawned
  // NPC's own routine stopping here joins its spawn row, and an NPC only passing
  // through gets one row for all its routines that stop here. A site no NPC owns
  // stays a row of its own.
  type SpawnRow = { instance: string; spawnedIn: string[]; stops: string[] };
  const spawnRows = new Map<string, SpawnRow>();
  for (const spawn of spawns) {
    const npc = spawn.instance.toUpperCase();
    const row = spawnRows.get(npc) ?? { instance: spawn.instance, spawnedIn: [], stops: [] };
    const where = `${spawn.functionName} — ${baseName(spawn.filePath)}`;
    if (!row.spawnedIn.includes(where)) row.spawnedIn.push(where);
    spawnRows.set(npc, row);
  }
  type SiteRow = { npc: string | null; functionNames: string[]; files: string[] };
  const siteRows: SiteRow[] = [];
  const siteRowOf = new Map<string, SiteRow>();
  for (const site of otherSites) {
    const file = baseName(site.filePath);
    if (!site.npc) {
      siteRows.push({ npc: null, functionNames: [site.functionName], files: [file] });
      continue;
    }
    const npc = site.npc.toUpperCase();
    const spawned = spawnRows.get(npc);
    if (spawned) {
      if (!spawned.stops.includes(site.functionName)) spawned.stops.push(site.functionName);
      continue;
    }
    let row = siteRowOf.get(npc);
    if (!row) {
      row = { npc: site.npc, functionNames: [], files: [] };
      siteRowOf.set(npc, row);
      siteRows.push(row);
    }
    if (!row.functionNames.includes(site.functionName)) row.functionNames.push(site.functionName);
    if (!row.files.includes(file)) row.files.push(file);
  }

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
        // The caption below says "Waypoint" and nothing associates it with this
        // box, so the field itself carries the name (§5.4 item 23 of the
        // 2026-09-04 review). `aria-label` rather than a floating MUI label:
        // the caption is already doing the visible half.
        inputProps={{
          'data-testid': 'world-waypoint-name-input',
          'aria-label': 'Waypoint name',
          spellCheck: false,
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1 }}>
        Waypoint
      </Typography>
      {spawnRows.size > 0 && (
        <List dense disablePadding data-testid="world-waypoint-spawns">
          {[...spawnRows].map(([npc, row]) => {
            const stops = row.stops.length > 0 ? ` · stops here in ${row.stops.join(', ')}` : '';
            const text = (
              <ListItemText
                primary={row.instance}
                secondary={`spawned in ${row.spawnedIn.join('; ')}${stops}`}
                primaryTypographyProps={primaryProps}
                secondaryTypographyProps={secondaryProps}
              />
            );
            const shown = shownRoutineNpc === npc;
            return (
              <ListItem key={npc} disablePadding sx={rowSx}>
                {onShowRoutineNpc && routineNpcs.length > 1 && routineNpcs.includes(npc) ? (
                  <ListItemButton
                    dense
                    selected={shown}
                    aria-pressed={shown}
                    aria-label={`Show the routine of ${row.instance}`}
                    onClick={() => onShowRoutineNpc(npc)}
                    sx={{ px: 0.5, minWidth: 0 }}
                  >
                    {text}
                  </ListItemButton>
                ) : text}
                {editButton(row.instance, row.stops[0])}
              </ListItem>
            );
          })}
        </List>
      )}
      {siteRows.length === 0 && spawns.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No script in this project names it.
        </Typography>
      ) : (
        <List dense disablePadding data-testid="world-waypoint-sites">
          {siteRows.map((row, index) => (
            <ListItem key={`${row.npc ?? ''}:${row.functionNames[0]}:${index}`} disablePadding sx={rowSx}>
              <ListItemText
                primary={row.functionNames.join(', ')}
                secondary={row.npc ? `${row.npc} — ${row.files.join(', ')}` : row.files[0]}
                primaryTypographyProps={primaryProps}
                secondaryTypographyProps={secondaryProps}
              />
              {row.npc && editButton(row.npc, row.functionNames[0])}
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
            <ListItem key={neighbour.waypoint} disablePadding sx={rowSx}>
              <ListItemText primary={neighbour.name} primaryTypographyProps={primaryProps} />
              <Button
                size="small"
                sx={{ flexShrink: 0 }}
                onClick={() => onDisconnect(neighbour.waypoint)}
                data-testid={`world-waypoint-disconnect-${neighbour.waypoint}`}
              >
                Disconnect
              </Button>
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
          // A label rather than the placeholder it replaces: a placeholder is
          // gone the moment anything is typed, which is exactly when the user
          // is most likely to want to know what the box is.
          label="Connect to"
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
