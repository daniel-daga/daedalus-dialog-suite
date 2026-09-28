import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WaynetPayload } from '../../../../shared/worldTypes';
import type { RoutineEntry } from '../../../routines/routineEntries';
import { useWorldStore, type RoutineRequest } from '../../../store/worldStore';

/**
 * Routine mode in the World surface (npc-editor.md §6): the NPC whose routines
 * the panel edits, the draft the viewport draws, the waypoint pick the panel
 * hands to the viewport, and the menu a spawn-marker click opens.
 *
 * A stop may only go on a waypoint the world file on disk has (Daniel,
 * 2026-09-28), so a pick is checked against `savedWaypoints`, and one added
 * since is refused with the reason rather than written into the script.
 */
export function useRoutineMode({ waynet, ensureWaynetShown }: {
  waynet: WaynetPayload | null;
  ensureWaynetShown: () => void;
}) {
  const [mode, setMode] = useState<RoutineRequest | null>(null);
  const [draft, setDraft] = useState<{ entries: readonly RoutineEntry[]; selected: number | null } | null>(null);
  const [pick, setPick] = useState<{ set: (waypoint: string) => void } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [npcMenu, setNpcMenu] = useState<{ npcs: readonly string[]; at: { left: number; top: number } } | null>(null);
  const saved = useWorldStore((s) => s.savedWaypoints);
  const request = useWorldStore((s) => s.routineRequest);

  const open = useCallback((npc: string, routine?: string) => {
    setNpcMenu(null);
    setDraft(null);
    setPick(null);
    setPickError(null);
    setMode(routine === undefined ? { npc } : { npc, routine });
    ensureWaynetShown();
  }, [ensureWaynetShown]);

  const close = useCallback(() => {
    setMode(null);
    setDraft(null);
    setPick(null);
    setPickError(null);
  }, []);

  useEffect(() => {
    if (request === null) return;
    useWorldStore.getState().routineRequestHandled();
    open(request.npc, request.routine);
  }, [request, open]);

  const onDraftChange = useCallback((entries: readonly RoutineEntry[], selected: number | null) => {
    setDraft({ entries, selected });
  }, []);

  const onPickWaypoint = useCallback((set: (waypoint: string) => void) => {
    setPick({ set });
    setPickError(null);
    ensureWaynetShown();
  }, [ensureWaynetShown]);

  const cancelPick = useCallback(() => {
    setPick(null);
    setPickError(null);
  }, []);

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
    setPick(null);
    setPickError(null);
    return true;
  }, [pick, waynet, saved]);

  const openNpcMenu = useCallback((npcs: readonly string[], at: { left: number; top: number }) => {
    setNpcMenu({ npcs, at });
  }, []);
  const closeNpcMenu = useCallback(() => setNpcMenu(null), []);

  const waypoints = useMemo(() => (saved === null ? null : [...saved].sort()), [saved]);

  return {
    mode, open, close, draft, onDraftChange, waypoints,
    picking: pick !== null, pickError, onPickWaypoint, cancelPick, takeWaypointPick,
    npcMenu, openNpcMenu, closeNpcMenu,
  };
}
