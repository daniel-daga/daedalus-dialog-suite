import React from 'react';
import {
  InputAdornment, ListSubheader, MenuItem, Slider, Stack, TextField, ToggleButton, Tooltip, Typography,
} from '@mui/material';
import Brightness6Icon from '@mui/icons-material/Brightness6';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import CropFreeIcon from '@mui/icons-material/CropFree';
import GroupsIcon from '@mui/icons-material/Groups';
import LabelIcon from '@mui/icons-material/Label';
import RouteIcon from '@mui/icons-material/Route';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { MINUTES_PER_DAY, type StateOption } from '../../../routines/routineSchedule';
import { MAX_EXPOSURE, MIN_EXPOSURE } from '../../../world/WorldScene';
import type { OutlineMode } from '../../../world/VobOutline';

/** Minutes since midnight as `HH:MM` — the routine index's own unit
 *  (level-editor.md §16.19). Moved with the one readout that uses it. */
function formatDayMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * The World bar's "view" group (level-editor.md §17): Waynet, Spawns, Names,
 * the time-of-day slider and its quest-state lens, the VOB outlines,
 * brightness, and per-class hide. Nothing here edits the world.
 *
 * Every toggle is mounted whatever the state of the layer it depends on,
 * and disabled — with the tooltip saying which layer to turn on — when that
 * layer is off. Names and Time used to mount only once their layer was on,
 * which made the row grow and shift on every toggle and left nothing on
 * screen to say the control existed. The one thing that still appears is
 * the time slider with its lens, inside this group, which is why the group
 * is pinned to the bar's right edge: it grows into its own slack.
 *
 * Combined-state rules (the time toggle clearing the state lens) stay in
 * `WorldSurface`, passed down as a single callback rather than reassembled
 * here.
 */
export interface WorldViewControlsProps {
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
  stateOptions: { shared: readonly StateOption[]; singletons: readonly StateOption[] };
  spawnStateReach: { resolved: number; total: number };
  showWaypointNames: boolean;
  onToggleWaypointNames: () => void;
  outlineMode: OutlineMode;
  onCycleOutlineMode: () => void;
  exposure: number;
  onExposureChange: (value: number) => void;
  hiddenClasses: readonly string[];
  onHiddenClassesChange: (classes: readonly string[]) => void;
  classOptions: readonly string[];
}

/** The cycle, and the word each state puts on the button. */
export const OUTLINE_MODE_ORDER: readonly OutlineMode[] = ['all', 'selected', 'off'];
const OUTLINE_MODE_LABEL: Record<OutlineMode, string> = {
  all: 'All', selected: 'Selected', off: 'Off',
};
const OUTLINE_MODE_ICON: Record<OutlineMode, React.ReactElement> = {
  all: <SelectAllIcon fontSize="small" />,
  selected: <CenterFocusStrongIcon fontSize="small" />,
  off: <CropFreeIcon fontSize="small" />,
};

const toggleSx = { py: 0.25, px: 1 };

const WorldViewControls: React.FC<WorldViewControlsProps> = ({
  hasWorld, showWaynet, onToggleWaynet, showSpawns, onToggleSpawns,
  spawnTime, onToggleTime, onSpawnTimeChange, spawnState, onSpawnStateChange,
  stateOptions, spawnStateReach, showWaypointNames, onToggleWaypointNames,
  outlineMode, onCycleOutlineMode,
  exposure, onExposureChange, hiddenClasses, onHiddenClassesChange, classOptions,
}) => (
  <>
    <Tooltip title="Waynet — draw the waypoints and their edges">
      <span>
        <ToggleButton
          size="small"
          value="waynet"
          selected={showWaynet}
          disabled={!hasWorld}
          onChange={onToggleWaynet}
          data-testid="world-waynet-toggle"
          aria-label="Waynet"
          sx={toggleSx}
        >
          <RouteIcon fontSize="small" />
        </ToggleButton>
      </span>
    </Tooltip>
    {/* The project's spawns, drawn where the script puts them. Offered
        beside the waynet because it is the same kind of layer, and
        deliberately not disabled when the index is empty: an empty index
        means no script project is open, which is a different fact from
        "nobody is spawned in this world" and is not one a dead button could
        tell anybody. */}
    <Tooltip title="Spawns — draw where the project's scripts put each NPC">
      <span>
        <ToggleButton
          size="small"
          value="spawns"
          selected={showSpawns}
          disabled={!hasWorld}
          onChange={onToggleSpawns}
          data-testid="world-spawns-toggle"
          aria-label="Spawns"
          sx={toggleSx}
        >
          <GroupsIcon fontSize="small" />
        </ToggleButton>
      </span>
    </Tooltip>
    {/* Waypoint names. Live whenever something is drawing waypoints — the
        waynet itself, or the spawn markers, which stand on them — because it
        labels what is drawn rather than the whole net: with only the spawns
        on, a name over an unmarked waypoint would point at nothing. Only the
        nearest few are drawn whatever is on; a retail world has ~3,000
        waypoints and a name on each is neither legible nor affordable. */}
    <Tooltip
      title={hasWorld && !(showWaynet || showSpawns)
        ? 'Names — turn Waynet or Spawns on first'
        : 'Names — label the nearest waypoints'}
    >
      <span>
        <ToggleButton
          size="small"
          value="names"
          selected={showWaypointNames}
          disabled={!hasWorld || !(showWaynet || showSpawns)}
          onChange={onToggleWaypointNames}
          data-testid="world-names-toggle"
          aria-label="Names"
          sx={toggleSx}
        >
          <LabelIcon fontSize="small" />
        </ToggleButton>
      </span>
    </Tooltip>
    {/* The time of day the spawn layer answers for (§16.19 slice 5); it
        hangs off that layer because it has nothing else to change. Off by
        default: the static spawns are where `Wld_InsertNpc` puts an NPC and
        they are a fact on their own, so the slider is an extra question and
        not a better default. What it draws is two-coloured on purpose — the
        routines do not cover every NPC at every minute, and the dim markers
        are the ones the scripts leave unplaced rather than NPCs who are not
        there. */}
    <Tooltip
      title={hasWorld && !showSpawns
        ? 'Time of day — turn Spawns on first'
        : 'Time of day — move each NPC to where its routine has it'}
    >
      <span>
        <ToggleButton
          size="small"
          value="time"
          selected={spawnTime !== null}
          disabled={!hasWorld || !showSpawns}
          onChange={onToggleTime}
          data-testid="world-time-toggle"
          aria-label="Time of day"
          sx={toggleSx}
        >
          <ScheduleIcon fontSize="small" />
        </ToggleButton>
      </span>
    </Tooltip>
    {spawnTime !== null && (
      <Stack direction="row" spacing={1} alignItems="center">
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
            slider rather than beside it because a state without a minute
            answers nothing the static layer does not, and offered even with
            nothing in it for the Spawns button's reason: a missing control
            cannot tell anybody the difference between no project open and
            no states in this one. */}
        <TextField
          select
          size="small"
          value={spawnState ?? ''}
          onChange={(event) => onSpawnStateChange(event.target.value || null)}
          aria-label="Quest state"
          data-testid="world-state"
          sx={{ width: 130, '& .MuiInputBase-input': { py: 0.5, fontSize: 12 } }}
        >
          {/* Not "Chapter 1": a `daily_routine` is whatever the instance
              declares, which for some NPCs is already a late-game routine,
              so a chapter number would be a claim the index cannot back. */}
          <MenuItem value="">Declared</MenuItem>
          {/* Shared names first by reach, singletons behind a divider
              (§16.19 slice 11's verdict), each with its reach: the readout
              beside the select only speaks after a choice. */}
          {stateOptions.shared.map(({ name, reach }) => (
            <MenuItem key={name} value={name}>{name} ({reach})</MenuItem>
          ))}
          {stateOptions.shared.length > 0 && stateOptions.singletons.length > 0 && (
            <ListSubheader>Only one NPC</ListSubheader>
          )}
          {stateOptions.singletons.map(({ name, reach }) => (
            <MenuItem key={name} value={name}>{name} ({reach})</MenuItem>
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
      </Stack>
    )}
    {/* The VOB outlines (#229). Three states rather than a toggle, because
        the ask had two halves: a scene without the white frames at all, and
        the line as a selection mark only. `All` is what the pass has always
        drawn and stays the default, so nobody's picture changes until they
        ask. One button cycling them, not three, because they are one
        setting — the icon and the accessible name carry the state, since a
        two-variant button cannot say which of three it is in.

        `WorldScene`'s orange body tint marks the selection in every mode,
        which is what makes `Off` safe: the selection is still visible with
        no line on screen. */}
    <Tooltip title={`Outlines: ${OUTLINE_MODE_LABEL[outlineMode]} — click for ${
      OUTLINE_MODE_LABEL[OUTLINE_MODE_ORDER[(OUTLINE_MODE_ORDER.indexOf(outlineMode) + 1) % OUTLINE_MODE_ORDER.length]]
    }`}
    >
      <span>
        <ToggleButton
          size="small"
          value="outlines"
          selected={outlineMode !== 'off'}
          disabled={!hasWorld}
          onChange={onCycleOutlineMode}
          data-testid="world-outlines-toggle"
          aria-label={`Outlines: ${OUTLINE_MODE_LABEL[outlineMode]}`}
          sx={toggleSx}
        >
          {OUTLINE_MODE_ICON[outlineMode]}
        </ToggleButton>
      </span>
    </Tooltip>
    {/* Brightness, beside the other view toggles and deliberately not near
        anything that edits: ZenGin's lighting is baked into the vertex
        colours, so an interior is dark in the file and there is no light
        in this scene to turn up. This lifts the picture and nothing else —
        no op, no dirty world, nothing saved. The icon is the label; the
        word "Brightness" was truncated at every width it was tried at. */}
    <Tooltip title="Brightness — lifts the picture only; nothing is saved">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: 120, pl: 0.5 }}>
        <Brightness6Icon sx={{ fontSize: 16, color: hasWorld ? 'text.secondary' : 'text.disabled' }} />
        <Slider
          size="small"
          disabled={!hasWorld}
          min={MIN_EXPOSURE}
          max={MAX_EXPOSURE}
          step={0.1}
          value={exposure}
          onChange={(_event, next) => onExposureChange(next as number)}
          aria-label="Brightness"
          data-testid="world-exposure"
        />
      </Stack>
    </Tooltip>
    {/* Spacer's per-class show/hide, beside the other view controls because
        that is what it is: the world still holds every VOB, the scene tree
        still lists them, and one of them switched off here is only not
        drawn — and, since the pick pass reads the same flag, not clickable
        either. Named for what it does rather than for what is on: the
        empty list is the ordinary state and "nothing hidden" should read
        as the empty one. */}
    <Tooltip title="Hide VOB classes">
      <TextField
        select
        size="small"
        disabled={!hasWorld}
        value={hiddenClasses as string[]}
        onChange={(event) => onHiddenClassesChange(
          typeof event.target.value === 'string'
            ? [event.target.value]
            : (event.target.value as unknown as string[]),
        )}
        aria-label="Hidden VOB classes"
        data-testid="world-hidden-classes"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0.5 }}>
              <VisibilityOffIcon sx={{ fontSize: 16 }} />
            </InputAdornment>
          ),
        }}
        SelectProps={{
          multiple: true,
          displayEmpty: true,
          renderValue: (picked) => ((picked as string[]).length === 0
            ? 'Nothing'
            : `${(picked as string[]).length} classes`),
        }}
        sx={{ width: 126, '& .MuiInputBase-input': { py: 0.5, fontSize: 12 } }}
      >
        {classOptions.map((cls) => (
          <MenuItem key={cls} value={cls} sx={{ fontSize: 12 }}>{cls}</MenuItem>
        ))}
      </TextField>
    </Tooltip>
  </>
);

export default WorldViewControls;
