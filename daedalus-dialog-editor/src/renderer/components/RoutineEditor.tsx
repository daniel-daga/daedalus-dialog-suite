import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  ToggleButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useProjectStore } from '../store/projectStore';
import { npcRoutines, formatMinute } from '../npc/npcRoutines';
import { coverageOf, type RoutineWindow } from '../routines/routineSchedule';
import type { RoutineEntry } from '../routines/routineEntries';
import { moveBoundary, removeEntry, setState, setWaypoint, splitEntry } from '../routines/routineDraft';
import type { RoutineSite } from '../../shared/types';
import { loadRoutine, routineFileOf, saveRoutine } from './routineSave';

/**
 * The routine editor (npc-editor.md §6): an NPC's routines at the top, the
 * selected routine's activities below, and a 24-hour timeline between them.
 * Edits go to a draft with its own undo; Save writes the routine function and
 * re-indexes its file. The panel needs no world — the World surface adds the
 * waypoint list and the viewport pick through its props.
 */

const DAY = 24 * 60;
/** A dragged boundary snaps to the quarter hour; the fields take any minute. */
const SNAP = 15;

function parseTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return (hour * 60 + minute) % DAY;
}

/** A window on the bar's linear day, split in two where it wraps midnight. */
function segmentsOf(entry: RoutineEntry): Array<[number, number]> {
  const { startMinute: start, endMinute: end } = entry;
  if (start === end) return [[0, DAY]];
  return start < end ? [[start, end]] : [[start, DAY], [0, end]];
}

const asSites = (entries: readonly RoutineEntry[]): RoutineSite[] => entries.map((entry) => ({
  routine: 'DRAFT', startMinute: entry.startMinute, endMinute: entry.endMinute,
  waypoint: entry.waypoint, filePath: '', line: 0,
}));

const NO_ENTRIES: RoutineEntry[] = [];

const COLORS = ['#5b8def', '#e0a33a', '#4caf7d', '#c265d6', '#e0605a', '#3fb5c4'];

const windowLabel = (window: RoutineWindow) => `${formatMinute(window.startMinute)}–${formatMinute(window.endMinute)}`;

/** A time field that commits on blur or Enter and shows the value again when
 *  what was typed is not a time. */
const TimeField: React.FC<{ label: string; minute: number; onCommit: (minute: number) => void }> = (
  { label, minute, onCommit },
) => {
  const [draft, setDraft] = useState(formatMinute(minute));
  useEffect(() => { setDraft(formatMinute(minute)); }, [minute]);
  const commit = () => {
    const parsed = parseTime(draft);
    if (parsed === null || parsed === minute) setDraft(formatMinute(minute));
    else onCommit(parsed);
  };
  return (
    <TextField
      label={label}
      size="small"
      value={draft}
      sx={{ width: 84 }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
    />
  );
};

/** A free-text waypoint, for when no world says which ones exist. */
const WaypointText: React.FC<{ value: string; onCommit: (waypoint: string) => void }> = ({ value, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed === value) setDraft(value);
    else onCommit(trimmed);
  };
  return (
    <TextField
      label="Waypoint"
      size="small"
      value={draft}
      sx={{ flex: 1, minWidth: 160 }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
    />
  );
};

interface TimelineProps {
  entries: readonly RoutineEntry[];
  selected: number | null;
  onSelect: (index: number) => void;
  /** A drag in progress: `edge` of entry `index` to `minute`. */
  onDrag: (index: number, edge: 'start' | 'end', minute: number, detach: boolean) => void;
  onDragEnd: () => void;
  gaps: RoutineWindow[];
  overlaps: RoutineWindow[];
}

const RoutineTimeline: React.FC<TimelineProps> = ({ entries, selected, onSelect, onDrag, onDragEnd, gaps, overlaps }) => {
  const bar = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ index: number; edge: 'start' | 'end' } | null>(null);

  const minuteAt = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return (Math.round((ratio * DAY) / SNAP) * SNAP) % DAY;
  };

  // One handle per boundary: an entry's end, which moves whoever starts there
  // too; and the start of an entry nothing ends at, which is a boundary of its
  // own. Ends shared by two entries (an overlap) still draw once.
  const handles: Array<{ index: number; edge: 'start' | 'end'; minute: number; label: string }> = [];
  const seen = new Set<number>();
  entries.forEach((entry, index) => {
    if (!seen.has(entry.endMinute)) {
      seen.add(entry.endMinute);
      handles.push({ index, edge: 'end', minute: entry.endMinute, label: `Boundary at ${formatMinute(entry.endMinute)}` });
    }
  });
  entries.forEach((entry, index) => {
    if (!entries.some((other) => other.endMinute === entry.startMinute)) {
      handles.push({
        index, edge: 'start', minute: entry.startMinute,
        label: `Start of activity ${index + 1} at ${formatMinute(entry.startMinute)}`,
      });
    }
  });

  const percent = (minute: number) => `${(minute / DAY) * 100}%`;
  const marks = (windows: RoutineWindow[], color: string, label: string) => windows.flatMap((window, i) =>
    segmentsOf({ state: '', waypoint: '', ...window }).map(([a, b], j) => (
      <Box
        key={`${label}-${i}-${j}`}
        title={`${label} ${windowLabel(window)}`}
        sx={{ position: 'absolute', left: percent(a), width: percent(b - a), bottom: 0, height: 5, bgcolor: color }}
      />
    )));

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        ref={bar}
        data-testid="routine-timeline"
        sx={{ position: 'relative', height: 40, borderRadius: 1, bgcolor: 'action.hover', touchAction: 'none' }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          onDrag(drag.current.index, drag.current.edge, minuteAt(event.clientX), event.altKey);
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          onDragEnd();
        }}
      >
        {entries.flatMap((entry, index) => segmentsOf(entry).map(([a, b], j) => (
          <Box
            key={`${index}-${j}`}
            onClick={() => onSelect(index)}
            title={`${entry.state} ${formatMinute(entry.startMinute)}–${formatMinute(entry.endMinute)} ${entry.waypoint}`}
            sx={{
              position: 'absolute', left: percent(a), width: percent(b - a), top: 4, bottom: 8,
              bgcolor: COLORS[index % COLORS.length], opacity: selected === index ? 1 : 0.7,
              outline: selected === index ? '2px solid' : 'none', outlineColor: 'text.primary',
              overflow: 'hidden', fontSize: 10, color: '#fff', px: 0.5, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {index + 1}
          </Box>
        )))}
        {marks(gaps, 'warning.main', 'Gap')}
        {marks(overlaps, 'error.main', 'Overlap')}
        {handles.map((handle) => (
          <Box
            key={`${handle.edge}-${handle.index}`}
            role="slider"
            tabIndex={0}
            aria-label={handle.label}
            aria-valuemin={0}
            aria-valuemax={DAY - 1}
            aria-valuenow={handle.minute}
            aria-valuetext={formatMinute(handle.minute)}
            onPointerDown={(event) => {
              event.currentTarget.parentElement!.setPointerCapture(event.pointerId);
              drag.current = { index: handle.index, edge: handle.edge };
            }}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? SNAP : event.key === 'ArrowLeft' ? -SNAP : 0;
              if (step === 0) return;
              event.preventDefault();
              onDrag(handle.index, handle.edge, (handle.minute + step + DAY) % DAY, event.altKey);
              onDragEnd();
            }}
            sx={{
              position: 'absolute', left: `calc(${percent(handle.minute)} - 4px)`, top: 0, bottom: 0, width: 8,
              cursor: 'ew-resize', bgcolor: 'text.primary', opacity: 0.6, borderRadius: 0.5, zIndex: 1,
            }}
          />
        ))}
      </Box>
      <Box sx={{ position: 'relative', height: 14, fontSize: 10, color: 'text.secondary' }}>
        {[0, 6, 12, 18].map((hour) => (
          <Box key={hour} sx={{ position: 'absolute', left: percent(hour * 60) }}>{formatMinute(hour * 60)}</Box>
        ))}
      </Box>
    </Box>
  );
};

export interface RoutineEditorPanelProps {
  npc: string;
  /** The routine to open on; the declared daily routine when absent. */
  initialRoutine?: string;
  /** The waypoints a stop may use — the saved world's — or null for free
   *  text, when no world is open to say which exist. */
  waypoints?: readonly string[] | null;
  /** Hand the selected activity's waypoint to a pick elsewhere (the viewport);
   *  the callback it is given sets it. */
  onPickWaypoint?: (set: (waypoint: string) => void) => void;
  /** The draft as it changes, for a view that draws it. */
  onDraftChange?: (entries: readonly RoutineEntry[], selected: number | null) => void;
  /** Saved or cancelled. */
  onDone: () => void;
}

interface Draft {
  entries: RoutineEntry[];
  past: RoutineEntry[][];
  future: RoutineEntry[][];
}

export const RoutineEditorPanel: React.FC<RoutineEditorPanelProps> = (
  { npc, initialRoutine, waypoints = null, onPickWaypoint, onDraftChange, onDone },
) => {
  const siteIndex = useProjectStore((s) => s.routineSiteIndex);
  const npcIndex = useProjectStore((s) => s.routineNpcIndex);
  const stateIndex = useProjectStore((s) => s.routineStateIndex);
  const layouts = useProjectStore((s) => s.routineLayoutIndex);
  const exchangeSites = useProjectStore((s) => s.exchangeSiteIndex);

  const routines = useMemo(
    () => npcRoutines({ sites: siteIndex, routinesByNpc: npcIndex, statesByNpc: stateIndex }, npc),
    // The list is what the routines *are*; a save re-indexes entries, which
    // must not re-key the list under the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [npcIndex, stateIndex, npc],
  );
  const [routine, setRoutine] = useState<string | null>(
    () => routines.find((r) => r.routine.toUpperCase() === initialRoutine?.toUpperCase())?.routine
      ?? routines[0]?.routine ?? null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>('[]');
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dragStart = useRef<RoutineEntry[] | null>(null);

  const filePath = routine ? routineFileOf(routine, npc) : null;

  useEffect(() => {
    if (!routine) return;
    let cancelled = false;
    setDraft(null);
    setError(null);
    setSelected(null);
    (async () => {
      try {
        if (!filePath) throw new Error(`No file is known for ${routine}`);
        const entries = await loadRoutine(filePath, routine);
        if (cancelled) return;
        setDraft({ entries, past: [], future: [] });
        setBaseline(JSON.stringify(entries));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine]);

  const entries = draft?.entries ?? NO_ENTRIES;
  const dirty = draft !== null && JSON.stringify(draft.entries) !== baseline;

  useEffect(() => { onDraftChange?.(entries, selected); }, [entries, selected, onDraftChange]);

  const commit = useCallback((next: RoutineEntry[]) => {
    setDraft((current) => current && ({ entries: next, past: [...current.past, current.entries], future: [] }));
  }, []);
  const undo = () => setDraft((current) => current && current.past.length > 0 ? {
    entries: current.past[current.past.length - 1],
    past: current.past.slice(0, -1),
    future: [current.entries, ...current.future],
  } : current);
  const redo = () => setDraft((current) => current && current.future.length > 0 ? {
    entries: current.future[0],
    past: [...current.past, current.entries],
    future: current.future.slice(1),
  } : current);

  const stateOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const [key, layout] of Object.entries(layouts)) {
      const positions = [layout.startH, layout.startM, layout.stopH, layout.stopM, layout.waypoint];
      // Only a state an activity alone can fill: `TA` and `TA_MIN` also want
      // `self` and a `ZS_*` state.
      if (positions.some((p) => p === undefined) || new Set(positions).size !== 5 || Math.max(...(positions as number[])) !== 4) continue;
      names.set(key, layout.name ?? key);
    }
    for (const entry of entries) names.set(entry.state.toUpperCase(), entry.state);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [layouts, entries]);

  const coverage = useMemo(() => coverageOf(asSites(entries), 'DRAFT'), [entries]);

  const triggers = (label: string) => exchangeSites.filter((site) =>
    site.state === label.toUpperCase() && (site.target === npc.toUpperCase() || site.target === 'SELF'));

  const addActivity = () => {
    if (selected === null) return;
    const entry = entries[selected];
    const length = ((entry.endMinute - entry.startMinute + DAY) % DAY) || DAY;
    const middle = (entry.startMinute + Math.round(length / 2 / SNAP) * SNAP) % DAY;
    const next = splitEntry(entries, selected, middle);
    if (next.length === entries.length) return;
    commit(next);
    setSelected(selected + 1);
  };

  const handleSave = async () => {
    if (!draft || !routine || !filePath) return;
    setSaving(true);
    setError(null);
    try {
      await saveRoutine(filePath, routine, draft.entries);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey) || (event.target as HTMLElement).tagName === 'INPUT') return;
        if (event.key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
        if (event.key === 'y' || (event.key === 'z' && event.shiftKey)) { event.preventDefault(); redo(); }
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        {routines.length === 0 && (
          <Typography variant="caption" color="text.secondary">No routine in the project index.</Typography>
        )}
        {routines.map((r) => {
          const switched = r.label === 'Daily' ? null : triggers(r.label);
          return (
            <Box key={r.routine} title={dirty && r.routine !== routine ? 'Save or cancel this routine first' : undefined}>
              <ToggleButton
                value={r.routine}
                size="small"
                selected={r.routine === routine}
                disabled={dirty && r.routine !== routine}
                onChange={() => setRoutine(r.routine)}
                sx={{ textTransform: 'none', py: 0.25 }}
              >
                {`${r.label}: ${r.routine}`}
              </ToggleButton>
              {switched && (
                <Typography variant="caption" display="block" color="text.secondary" sx={{ fontSize: 10 }}>
                  {switched.length === 0
                    ? 'Nothing in the scripts switches to it by name'
                    : `Switched to at ${switched.slice(0, 2).map((site) => `${site.filePath.split(/[\\/]/).pop()}:${site.line}`).join(', ')}${switched.length > 2 ? ` +${switched.length - 2}` : ''}`}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {routine && !draft && !error && <CircularProgress size={24} />}

      {draft && (
        <>
          <RoutineTimeline
            entries={entries}
            selected={selected}
            onSelect={setSelected}
            gaps={coverage.gaps}
            overlaps={coverage.overlaps}
            onDrag={(index, edge, minute, detach) => {
              if (!dragStart.current) dragStart.current = entries;
              const next = moveBoundary(dragStart.current, index, edge, minute, { detach });
              setDraft((current) => current && { ...current, entries: next });
            }}
            onDragEnd={() => {
              const start = dragStart.current;
              dragStart.current = null;
              setDraft((current) => (current && start && JSON.stringify(start) !== JSON.stringify(current.entries)
                ? { entries: current.entries, past: [...current.past, start], future: [] }
                : current));
            }}
          />
          {(coverage.gaps.length > 0 || coverage.overlaps.length > 0) && (
            <Typography variant="caption" color="warning.main" sx={{ mb: 1 }}>
              {[
                ...coverage.gaps.map((w) => `Gap ${windowLabel(w)}`),
                ...coverage.overlaps.map((w) => `Overlap ${windowLabel(w)}`),
              ].join(' · ')}
            </Typography>
          )}

          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Button size="small" onClick={undo} disabled={draft.past.length === 0}>Undo</Button>
            <Button size="small" onClick={redo} disabled={draft.future.length === 0}>Redo</Button>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={addActivity} disabled={selected === null}>Add activity</Button>
          </Box>

          {entries.map((entry, index) => (
            <Box
              key={index}
              role="group"
              aria-label={`Activity ${index + 1}`}
              onClick={() => setSelected(index)}
              sx={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, p: 1, mb: 0.5, borderRadius: 1,
                borderLeft: 4, borderColor: COLORS[index % COLORS.length],
                bgcolor: selected === index ? 'action.selected' : 'transparent',
              }}
            >
              <Typography variant="caption" sx={{ width: 16 }}>{index + 1}</Typography>
              <Autocomplete
                size="small"
                options={stateOptions}
                value={entry.state}
                disableClearable
                isOptionEqualToValue={(option, value) => option.toUpperCase() === value.toUpperCase()}
                onChange={(_event, value) => { if (value) commit(setState(entries, index, value)); }}
                sx={{ width: 220 }}
                renderInput={(params) => <TextField {...params} label="Activity" />}
              />
              <TimeField label="Start" minute={entry.startMinute}
                onCommit={(minute) => commit(moveBoundary(entries, index, 'start', minute))} />
              <TimeField label="End" minute={entry.endMinute}
                onCommit={(minute) => commit(moveBoundary(entries, index, 'end', minute))} />
              {waypoints ? (
                <Autocomplete
                  size="small"
                  options={waypoints as string[]}
                  value={entry.waypoint}
                  disableClearable
                  isOptionEqualToValue={(option, value) => option.toUpperCase() === value.toUpperCase()}
                  onChange={(_event, value) => { if (value) commit(setWaypoint(entries, index, value)); }}
                  sx={{ flex: 1, minWidth: 160 }}
                  renderInput={(params) => <TextField {...params} label="Waypoint" />}
                />
              ) : (
                <WaypointText value={entry.waypoint} onCommit={(waypoint) => commit(setWaypoint(entries, index, waypoint))} />
              )}
              {onPickWaypoint && (
                <Button
                  size="small"
                  aria-label={`Pick the waypoint of activity ${index + 1} in the world`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected(index);
                    onPickWaypoint((waypoint) => setDraft((current) => current && ({
                      entries: setWaypoint(current.entries, index, waypoint),
                      past: [...current.past, current.entries],
                      future: [],
                    })));
                  }}
                >
                  Pick
                </Button>
              )}
              <IconButton
                size="small"
                aria-label="Remove activity"
                onClick={(event) => {
                  event.stopPropagation();
                  commit(removeEntry(entries, index));
                  setSelected(null);
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
        <Button onClick={onDone} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!dirty || saving}>Save</Button>
      </Box>
    </Box>
  );
};

/** The editor as a modal, for the NPC editor, where no world is needed. */
const RoutineEditorDialog: React.FC<{ npc: string; initialRoutine?: string; onClose: () => void }> = (
  { npc, initialRoutine, onClose },
) => (
  <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="routine-editor-title">
    <DialogTitle id="routine-editor-title">{`Routines of ${npc}`}</DialogTitle>
    <DialogContent dividers>
      <RoutineEditorPanel npc={npc} initialRoutine={initialRoutine} onDone={onClose} />
    </DialogContent>
  </Dialog>
);

export default RoutineEditorDialog;
