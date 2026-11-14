import React from 'react';
import { Box, Button, Chip, IconButton, Typography } from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { activityLabel, formatMinute, type NpcRoutine, type VariantSwitch } from '../npc/npcRoutines';
import { coverageOf } from '../routines/routineSchedule';
import { routineColor, segmentsOf } from '../routines/routineDraft';
import type { RoutineSite } from '../../shared/types';

/**
 * The NPC editor's routines (npc-editor.md §3, §6): one card per routine —
 * the declared start routine and each state variant — with its day drawn as a
 * 24-hour bar and its activities under named columns. Read-only: writing a
 * routine is the routine editor's, and the start routine is a form value the
 * card only marks and offers. Reads the project index as of the last load or
 * reindex.
 */

export interface NpcRoutinesSectionProps {
  routines: NpcRoutine[];
  /** The form's `daily_routine`, which may differ from the saved one. */
  startRoutine?: string;
  /** Make this routine the start routine (a form edit, saved with the form). */
  onSetStart?: (routine: string) => void;
  /** The field that can name a start routine no card lists, or clear it.
   *  Shown when no listed routine is the start routine, else on request. */
  startField?: React.ReactNode;
  /** The calls that switch the NPC to a state variant (`variantSwitches`). */
  switchesOf?: (state: string) => VariantSwitch[];
  /** A TA wrapper's declared spelling, for the index's uppercased name. */
  activityName?: (state: string) => string;
  /** Go to a TA entry's waypoint in the World surface (#285). */
  onShowWaypoint?: (waypoint: string) => void;
  /** Read the routine source file at an indexed TA call (#285). */
  onShowSource?: (routine: string, filePath: string, line: number) => void;
  /** Why a waypoint cannot be shown — the insert-NPC jump's answers. */
  waypointReason?: (waypoint: string) => string | null;
  /** Why neither map jump may leave the editor now, e.g. unsaved changes. */
  blockedReason?: string | null;
  /** Open the routine editor on this routine (npc-editor.md §6). */
  onEditRoutine?: (routine: string) => void;
  /** Open the routine editor to create the NPC's first routine (#316). */
  onCreateRoutine?: () => void;
  /** Open this routine in the World surface's routine mode instead — which
   *  opens a world for it when none is, so it is never off for want of one. */
  onEditRoutineInWorld?: (routine: string) => void;
}

const DAY = 24 * 60;
const percent = (minute: number) => `${(minute / DAY) * 100}%`;
const windowText = (window: { startMinute: number; endMinute: number }) =>
  `${formatMinute(window.startMinute)}–${formatMinute(window.endMinute)}`;

/** Script order, which is how the routine editor numbers and colours a
 *  routine's activities — so a colour means the same activity in both. */
function colourIndices(entries: readonly RoutineSite[]): Map<RoutineSite, number> {
  return new Map([...entries].sort((a, b) => a.line - b.line).map((site, index) => [site, index]));
}

/** The routine editor's timeline, read-only: the activities as coloured
 *  windows, and a gap no activity covers in red (maintainer, 2026-09-28). */
const RoutineDayBar: React.FC<{ entries: readonly RoutineSite[]; colours: Map<RoutineSite, number> }> = (
  { entries, colours },
) => {
  const { gaps, overlaps } = coverageOf(entries, entries[0].routine);
  return (
    <Box sx={{ mt: 0.75, mb: 0.5 }}>
      <Box data-testid="npc-routine-day" sx={{ position: 'relative', height: 14, borderRadius: 0.5, bgcolor: 'action.hover', overflow: 'hidden' }}>
        {entries.flatMap((entry) => segmentsOf(entry).map(([a, b], j) => (
          <Box
            key={`${entry.line}-${entry.startMinute}-${j}`}
            title={`${windowText(entry)} ${entry.waypoint}`}
            sx={{
              position: 'absolute', left: percent(a), width: percent(b - a), top: 0, bottom: 0,
              bgcolor: routineColor(colours.get(entry) ?? 0), opacity: 0.85,
              borderRight: '1px solid', borderColor: 'background.paper',
            }}
          />
        )))}
        {gaps.flatMap((gap, i) => segmentsOf(gap).map(([a, b], j) => (
          <Box
            key={`gap-${i}-${j}`}
            title={`Gap ${windowText(gap)}`}
            sx={{ position: 'absolute', left: percent(a), width: percent(b - a), top: 0, bottom: 0, bgcolor: 'error.main' }}
          />
        )))}
        {overlaps.flatMap((overlap, i) => segmentsOf(overlap).map(([a, b], j) => (
          <Box
            key={`overlap-${i}-${j}`}
            title={`Overlap ${windowText(overlap)}`}
            sx={{ position: 'absolute', left: percent(a), width: percent(b - a), bottom: 0, height: 4, bgcolor: 'warning.main' }}
          />
        )))}
      </Box>
      <Box sx={{ position: 'relative', height: 12, fontSize: 10, color: 'text.secondary' }}>
        {[0, 6, 12, 18].map((hour) => (
          <Box key={hour} sx={{ position: 'absolute', left: percent(hour * 60) }}>{formatMinute(hour * 60)}</Box>
        ))}
      </Box>
    </Box>
  );
};

/** Swatch, time, activity, waypoint, actions — one grid for the column names
 *  and every row, so they line up. */
const ROW_GRID = {
  display: 'grid',
  gridTemplateColumns: '4px 92px minmax(0, 1fr) minmax(0, 1.3fr) 56px',
  alignItems: 'center',
  columnGap: 1.5,
} as const;

const compactIcon = { p: 0.25, '& svg': { fontSize: 16 } } as const;

/** A disabled button still says why: the title sits on a wrapper, since a
 *  disabled button gets no pointer events. */
const WithReason: React.FC<{ reason: string | null; label: string; children: React.ReactNode }> = ({ reason, label, children }) => (
  <span title={reason ?? label} style={{ display: 'inline-flex' }}>{children}</span>
);

function switchText(switches: VariantSwitch[]): string {
  if (switches.length === 0) return 'Nothing in the scripts switches to it by name';
  const named = switches.slice(0, 2).map((sw) => `${sw.functionName}${sw.maybeOtherNpc ? ' (self)' : ''}`).join(', ');
  return `Switched to in ${named}${switches.length > 2 ? ` +${switches.length - 2}` : ''}`;
}

export const NpcRoutinesSection: React.FC<NpcRoutinesSectionProps> = ({
  routines, startRoutine = '', onSetStart, startField, switchesOf, activityName = (state) => state,
  onShowWaypoint, onShowSource, waypointReason, blockedReason = null,
  onEditRoutine, onCreateRoutine, onEditRoutineInWorld,
}) => {
  const isStart = (routine: string) => startRoutine !== '' && routine.toUpperCase() === startRoutine.toUpperCase();
  const startListed = routines.some((r) => isStart(r.routine));
  const [choosing, setChoosing] = React.useState(false);

  // One reason every waypoint jump shares is said once, in words; a per-
  // waypoint reason stays on its own button.
  const waypoints = routines.flatMap((r) => r.entries.map((entry) => entry.waypoint));
  const reasons = new Set(waypoints.map((wp) => waypointReason?.(wp) ?? null));
  const sharedReason = onShowWaypoint && waypoints.length > 0 && reasons.size === 1 ? [...reasons][0] : null;
  const note = blockedReason
    ? `Map jumps are paused: ${blockedReason}`
    : sharedReason ? `Waypoint jumps are unavailable: ${sharedReason}` : null;

  return (
    <Box component="section" aria-labelledby="npc-routines-heading" sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography id="npc-routines-heading" variant="subtitle2">Routines</Typography>
        <Box sx={{ flex: 1 }} />
        {startField && startListed && !choosing && (
          <Button size="small" sx={{ py: 0, fontSize: 12 }} aria-label="Choose another start routine" onClick={() => setChoosing(true)}>
            Other start routine…
          </Button>
        )}
      </Box>
      {note && (
        <Typography role="note" variant="caption" color="text.secondary" sx={{ display: 'block' }}>{note}</Typography>
      )}

      {routines.length === 0 && (
        <Box sx={{ mt: 0.5, p: 1, border: 1, borderColor: 'warning.main', borderRadius: 1 }}>
          <Typography variant="body2">
            No routine in the project index. Without a start routine the NPC does not spawn.
          </Typography>
          {onCreateRoutine && (
            <Button size="small" variant="outlined" sx={{ mt: 0.5 }} onClick={onCreateRoutine}>Create routine</Button>
          )}
        </Box>
      )}

      {routines.map(({ label, routine, entries }) => {
        const start = isStart(routine);
        const variant = label !== 'Daily';
        const switches = variant && switchesOf ? switchesOf(label) : null;
        const chapters = [...new Set((switches ?? []).map((sw) => sw.chapter).filter((c): c is number => c !== null))];
        const colours = colourIndices(entries);
        return (
          <Box
            key={routine}
            role="group"
            aria-label={`Routine ${routine}`}
            sx={{
              mt: 1, p: 1, borderRadius: 1, border: 1,
              borderColor: start ? 'primary.main' : 'divider',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{routine}</Typography>
              {start && <Chip size="small" color="primary" label="Start routine" sx={{ height: 20, fontSize: 11 }} />}
              {variant && <Chip size="small" variant="outlined" label={`State ${label}`} sx={{ height: 20, fontSize: 11 }} />}
              {chapters.length > 0 && (
                <Chip size="small" variant="outlined" label={`Chapter ${chapters.join(', ')}`} sx={{ height: 20, fontSize: 11 }} />
              )}
              <Box sx={{ flex: 1 }} />
              {!start && onSetStart && (
                <Button size="small" sx={{ py: 0 }} aria-label={`Set ${routine} as start routine`} onClick={() => onSetStart(routine)}>
                  Set as start
                </Button>
              )}
              {onEditRoutine && (
                <Button size="small" variant="outlined" sx={{ py: 0 }} aria-label={`Edit routine ${routine}`} onClick={() => onEditRoutine(routine)}>
                  Edit…
                </Button>
              )}
              {onEditRoutineInWorld && (
                <WithReason reason={blockedReason} label="Edit this routine in the World view">
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ py: 0 }}
                    aria-label={`Edit routine ${routine} in the world`}
                    disabled={blockedReason !== null}
                    onClick={() => onEditRoutineInWorld(routine)}
                  >
                    Edit on map
                  </Button>
                </WithReason>
              )}
            </Box>
            {switches && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{switchText(switches)}</Typography>
            )}

            {entries.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>No activities indexed</Typography>
            ) : (
              <>
                <RoutineDayBar entries={entries} colours={colours} />
                <Box sx={{ ...ROW_GRID, typography: 'caption', color: 'text.secondary' }}>
                  <span /><span>Time</span><span>Activity</span><span>Waypoint</span><span />
                </Box>
                <Box component="ul" aria-label={`Activities of ${routine}`} sx={{ m: 0, p: 0, listStyle: 'none' }}>
                  {entries.map((entry) => {
                    const state = entry.stateName ? activityName(entry.stateName) : '';
                    const reason = blockedReason ?? waypointReason?.(entry.waypoint) ?? null;
                    return (
                      <Box component="li" key={`${entry.line}-${entry.startMinute}-${entry.waypoint}`} sx={{ ...ROW_GRID, fontSize: 13, minHeight: 26 }}>
                        <Box sx={{ alignSelf: 'stretch', borderRadius: 0.5, bgcolor: routineColor(colours.get(entry) ?? 0) }} />
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{windowText(entry)}</span>
                        <Box component="span" title={state || undefined} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {state ? activityLabel(state) : '—'}
                        </Box>
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>
                          {entry.waypoint}
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                          {onShowWaypoint && (
                            <WithReason reason={reason} label="Show this waypoint in the World view">
                              <IconButton
                                size="small"
                                sx={compactIcon}
                                aria-label={`Show ${entry.waypoint} in the world`}
                                disabled={reason !== null}
                                onClick={() => onShowWaypoint(entry.waypoint)}
                              >
                                <PlaceOutlinedIcon />
                              </IconButton>
                            </WithReason>
                          )}
                          {onShowSource && (
                            <span title={`Open the script at line ${entry.line}`} style={{ display: 'inline-flex' }}>
                              <IconButton
                                size="small"
                                sx={compactIcon}
                                aria-label={`Show source for ${routine} at line ${entry.line}`}
                                onClick={() => onShowSource(routine, entry.filePath, entry.line)}
                              >
                                <CodeIcon />
                              </IconButton>
                            </span>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </>
            )}
          </Box>
        );
      })}

      {startField && (!startListed || choosing) && <Box sx={{ mt: 1, maxWidth: 320 }}>{startField}</Box>}
    </Box>
  );
};

export default NpcRoutinesSection;
