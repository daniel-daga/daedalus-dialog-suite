import { useCallback, useMemo, useState } from 'react';
import type { WaynetPayload } from '../../../../shared/worldTypes';
import type { RoutineEntry } from '../../../routines/routineEntries';
import { useWorldStore, type RoutineRequest } from '../../../store/worldStore';
import type { RoutinePickTarget } from '../../RoutineEditor';

/**
 * Routine mode in the World surface (npc-editor.md §6): the NPC whose routines
 * the editor modal edits, the draft the viewport draws, and the waypoint pick
 * the modal hands to the viewport — during which the modal is hidden and the
 * bottom bar says what the next click does.
 *
 * The waynet is read for the routine but drawn only while a pick needs its
 * points as targets, then put back as it was: the whole waynet on screen reads
 * as every routine's stops (Daniel, 2026-09-30).
 *
 * A stop may only go on a waypoint the world file on disk has (Daniel,
 * 2026-09-28), so a pick is checked against `savedWaypoints`, and one added
 * since is refused with the reason rather than written into the script.
 */
export function useRoutineMode({ waynet, loadWaynet, showWaynetForPick }: {
  waynet: WaynetPayload | null;
  /** Read the waynet payload if it is not, without drawing it. */
  loadWaynet: () => void;
  /** Draw the waynet; returns what puts it back as it was. */
  showWaynetForPick: () => () => void;
}) {
  const [mode, setMode] = useState<RoutineRequest | null>(null);
  const [draft, setDraft] = useState<{ entries: readonly RoutineEntry[]; selected: number | null } | null>(null);
  const [pick, setPick] = useState<{
    set: (waypoint: string) => void; target: RoutinePickTarget; restore: () => void;
  } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const saved = useWorldStore((s) => s.savedWaypoints);

  const endPick = useCallback(() => {
    pick?.restore();
    setPick(null);
    setPickError(null);
  }, [pick]);

  const open = useCallback((npc: string, routine?: string) => {
    endPick();
    setDraft(null);
    setMode(routine === undefined ? { npc } : { npc, routine });
    loadWaynet();
  }, [endPick, loadWaynet]);

  const close = useCallback(() => {
    endPick();
    setMode(null);
    setDraft(null);
  }, [endPick]);

  const onDraftChange = useCallback((entries: readonly RoutineEntry[], selected: number | null) => {
    setDraft({ entries, selected });
  }, []);

  const onPickWaypoint = useCallback((set: (waypoint: string) => void, target: RoutinePickTarget) => {
    // A second Pick while one waits keeps the first one's way back.
    setPick({ set, target, restore: pick?.restore ?? showWaynetForPick() });
    setPickError(null);
  }, [pick, showWaynetForPick]);

  const cancelPick = endPick;

  /** A waypoint click, offered to a pending pick first; true when it took it. */
  const takeWaypointPick = useCallback((waypoint: number): boolean => {
    if (pick === null || waynet === null) return false;
    const name = waynet.names[waypoint];
    if (name === undefined) return false;
    if (!saved?.some((known) => known.toUpperCase() === name.toUpperCase())) {
      setPickError(`${name} is not in the saved world yet — save the world first.`);
      return true;
    }
    pick.set(name);
    endPick();
    return true;
  }, [pick, waynet, saved, endPick]);

  const waypoints = useMemo(() => (saved === null ? null : [...saved].sort()), [saved]);

  return {
    mode, open, close, draft, onDraftChange, waypoints,
    picking: pick !== null, pickTarget: pick?.target ?? null, pickError,
    onPickWaypoint, cancelPick, takeWaypointPick,
  };
}
