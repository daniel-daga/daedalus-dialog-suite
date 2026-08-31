import React from 'react';
import { Button, MenuItem, Slider, Stack, TextField, Typography } from '@mui/material';
import { MINUTES_PER_DAY } from '../../../routines/routineSchedule';
import { MAX_EXPOSURE, MIN_EXPOSURE } from '../../../world/WorldScene';

/** Minutes since midnight as `HH:MM` — the routine index's own unit
 *  (level-editor.md §16.19). Moved with the one readout that uses it. */
function formatDayMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * The World bar's "overlays" group (level-editor-ui-improvements.md slice
 * 5): Waynet, Spawns, the time-of-day slider and its quest-state lens,
 * waypoint names, brightness, and per-class hide. Moved verbatim out of
 * `WorldSurface.tsx` — every testid and enablement rule is unchanged, only
 * the state and handlers now arrive as props. Combined-state rules (the
 * time toggle clearing the state lens; the snap step's gizmo-mode branch
 * lives in `WorldEditControls`) stay in `WorldSurface`, passed down as a
 * single callback rather than reassembled here.
 */
export interface WorldOverlayControlsProps {
  hasWorld: boolean;
  showWaynet: boolean;
  onToggleWaynet: () => void;
  showSpawns: boolean;
  onToggleSpawns: () => void;
  spawnTime: number | null;
  onToggleTime: () => void;
  onSpawnTimeChange: (minute: number) => void;
  spawnState: string | null;
  onSpawnStateChange: (state: string | null) => void;
  stateNames: readonly string[];
  spawnStateReach: { resolved: number; total: number };
  showWaypointNames: boolean;
  onToggleWaypointNames: () => void;
  exposure: number;
  onExposureChange: (value: number) => void;
  hiddenClasses: readonly string[];
  onHiddenClassesChange: (classes: readonly string[]) => void;
  classOptions: readonly string[];
}

const WorldOverlayControls: React.FC<WorldOverlayControlsProps> = ({
  hasWorld, showWaynet, onToggleWaynet, showSpawns, onToggleSpawns,
  spawnTime, onToggleTime, onSpawnTimeChange, spawnState, onSpawnStateChange,
  stateNames, spawnStateReach, showWaypointNames, onToggleWaypointNames,
  exposure, onExposureChange, hiddenClasses, onHiddenClassesChange, classOptions,
}) => (
  <>
    {hasWorld && (
      <Button
        size="small"
        variant={showWaynet ? 'contained' : 'outlined'}
        onClick={onToggleWaynet}
        data-testid="world-waynet-toggle"
      >
        Waynet
      </Button>
    )}
    {/* The project's spawns, drawn where the script puts them. Offered
        beside the waynet because it is the same kind of layer, and
        deliberately not hidden when the index is empty: an empty index
        means no script project is open, which is a different fact from
        "nobody is spawned in this world" and is not one a missing button
        could tell anybody. */}
    {hasWorld && (
      <Button
        size="small"
        variant={showSpawns ? 'contained' : 'outlined'}
        onClick={onToggleSpawns}
        data-testid="world-spawns-toggle"
      >
        Spawns
      </Button>
    )}
    {/* The time of day the spawn layer answers for (§16.19 slice 5), and it
        hangs off that layer rather than standing beside it because it has
        nothing else to change. Off by default: the static spawns are where
        `Wld_InsertNpc` puts an NPC and they are a fact on their own, so the
        slider is an extra question and not a better default. What it draws
        is two-coloured on purpose — the routines do not cover every NPC at
        every minute, and the dim markers are the ones the scripts leave
        unplaced rather than NPCs who are not there. */}
    {hasWorld && showSpawns && (
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          size="small"
          variant={spawnTime === null ? 'outlined' : 'contained'}
          onClick={onToggleTime}
          data-testid="world-time-toggle"
        >
          Time
        </Button>
        {spawnTime !== null && (
          <>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ fontVariantNumeric: 'tabular-nums' }}
              data-testid="world-time-readout"
            >
              {formatDayMinute(spawnTime)}
            </Typography>
            <Slider
              size="small"
              min={0}
              max={MINUTES_PER_DAY - 1}
              step={5}
              value={spawnTime}
              onChange={(_event, next) => onSpawnTimeChange(next as number)}
              aria-label="Time of day"
              data-testid="world-time"
              sx={{ width: 120 }}
            />
            {/* The quest state the day is drawn through. Offered with the
                slider rather than beside it because a state without a
                minute answers nothing the static layer does not, and
                offered even with nothing in it for the Spawns button's
                reason: a missing control cannot tell anybody the
                difference between no project open and no states in this
                one. */}
            <TextField
              select
              size="small"
              value={spawnState ?? ''}
              onChange={(event) => onSpawnStateChange(event.target.value || null)}
              aria-label="Quest state"
              data-testid="world-state"
              sx={{ width: 130 }}
            >
              {/* Not "Chapter 1": a `daily_routine` is whatever the instance
                  declares, which for some NPCs is already a late-game
                  routine, so a chapter number would be a claim the index
                  cannot back. */}
              <MenuItem value="">Declared</MenuItem>
              {stateNames.map((name) => (
                <MenuItem key={name} value={name}>{name}</MenuItem>
              ))}
            </TextField>
            {spawnState !== null && (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                data-testid="world-state-reach"
              >
                {spawnStateReach.resolved} of {spawnStateReach.total} NPCs
              </Typography>
            )}
          </>
        )}
      </Stack>
    )}
    {/* Waypoint names. Offered whenever something is drawing waypoints —
        the waynet itself, or the spawn markers, which stand on them —
        because it labels what is drawn rather than the whole net: with
        only the spawns on, a name over an unmarked waypoint would point at
        nothing. Only the nearest few are drawn whatever is on; a retail
        world has ~3,000 waypoints and a name on each is neither legible
        nor affordable. With the spawn layer on, a marked point says who is
        standing on it rather than what it is called — the marker is
        already the point (slice 14). */}
    {hasWorld && (showWaynet || showSpawns) && (
      <Button
        size="small"
        variant={showWaypointNames ? 'contained' : 'outlined'}
        onClick={onToggleWaypointNames}
        data-testid="world-names-toggle"
      >
        Names
      </Button>
    )}
    {/* Brightness, beside the other view toggles and deliberately not near
        anything that edits: ZenGin's lighting is baked into the vertex
        colours, so an interior is dark in the file and there is no light
        in this scene to turn up. This lifts the picture and nothing else —
        no op, no dirty world, nothing saved. */}
    {hasWorld && (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: 170 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          Brightness
        </Typography>
        <Slider
          size="small"
          min={MIN_EXPOSURE}
          max={MAX_EXPOSURE}
          step={0.1}
          value={exposure}
          onChange={(_event, next) => onExposureChange(next as number)}
          aria-label="Brightness"
          data-testid="world-exposure"
        />
      </Stack>
    )}
    {/* Spacer's per-class show/hide, beside the other view controls because
        that is what it is: the world still holds every VOB, the scene tree
        still lists them, and one of them switched off here is only not
        drawn — and, since the pick pass reads the same flag, not clickable
        either. Named for what it does rather than for what is on: the
        empty list is the ordinary state and "nothing hidden" should read
        as the empty one. */}
    {hasWorld && (
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" noWrap>
          Hide
        </Typography>
        <TextField
          select
          size="small"
          value={hiddenClasses as string[]}
          onChange={(event) => onHiddenClassesChange(
            typeof event.target.value === 'string'
              ? [event.target.value]
              : (event.target.value as unknown as string[]),
          )}
          aria-label="Hidden VOB classes"
          data-testid="world-hidden-classes"
          SelectProps={{
            multiple: true,
            displayEmpty: true,
            renderValue: (picked) => ((picked as string[]).length === 0
              ? 'Nothing'
              : `${(picked as string[]).length} classes`),
          }}
          sx={{ width: 110, '& .MuiInputBase-input': { py: 0.5, fontSize: 12 } }}
        >
          {classOptions.map((cls) => (
            <MenuItem key={cls} value={cls} sx={{ fontSize: 12 }}>{cls}</MenuItem>
          ))}
        </TextField>
      </Stack>
    )}
  </>
);

export default WorldOverlayControls;
