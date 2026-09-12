import { useCallback, useMemo } from 'react';
import {
  addWaypoint,
  connectWaypoints,
  deleteWaypoint,
  disconnectWaypoints,
  moveWaypoint,
  renameWaypoint,
  type WorldOp,
  type ZenPosition,
} from 'zen-world';
import type { WaynetPayload } from '../../../../shared/worldTypes';
import type { SpawnSite } from '../../../../shared/types';

export interface WaynetEditingInput {
  /** The drawn waynet, or null while the overlay has never been switched on. */
  waynet: WaynetPayload | null;
  selectedWaypoint: number | null;
  spawnSiteIndex: SpawnSite[];
  /** The project index's waypoint keys — uppercased, as Daedalus is. */
  waypointSiteIndex: Record<string, unknown>;
  commitOps: (ops: WorldOp[]) => Promise<boolean>;
}

export interface WaynetEditing {
  moveWaypointTo: (waypoint: number, from: ZenPosition, to: ZenPosition) => void;
  renameWaypointTo: (waypoint: number, to: string) => void;
  addWaypointAt: (name: string, point: [number, number, number]) => void;
  joinWaypointTo: (to: number) => void;
  unjoinWaypointFrom: (to: number) => void;
  removeWaypoint: (waypoint: number) => void;
  waypointEdges: Array<{ waypoint: number; name: string }>;
  waypointSpawns: SpawnSite[];
  resolveWaypointToJoin: (typed: string) => number | null;
  suggestedWaypointName: () => string;
  knownWaypointNames: string[];
}

/**
 * Every waynet edit the surface can make, and the data derived from the
 * selected waypoint that the panel draws.
 *
 * It reaches the world only through `commitOps`, which is what lets the whole
 * concern be tested without the surface: the ops are values, and what each
 * builder puts in one is the thing worth asserting.
 */
export function useWaynetEditing({
  waynet,
  selectedWaypoint,
  spawnSiteIndex,
  waypointSiteIndex,
  commitOps,
}: WaynetEditingInput): WaynetEditing {
  /**
   * A finished waypoint drag — the waynet's counterpart of a gizmo move.
   *
   * One waypoint, so this takes a destination where a VOB drag takes a delta:
   * there is no selection whose spacing has to survive.
   *
   * `from` comes from the viewport rather than being read here, and that is the
   * one asymmetry with every other op in this surface. A VOB drag reads `from`
   * out of the columnar index, which the live preview never wrote — it writes
   * instance matrices instead, and the two are separate. The waynet has one
   * array for both, so by the time the drag ends the preview has already put
   * `to` where `from` used to be. The viewport recorded it at the press; it is
   * put back here so that `moveWaypoint` — and with it the range check and the
   * name the op is guarded by — reads the position the waypoint actually had.
   */
  const moveWaypointTo = useCallback((
    waypoint: number, from: ZenPosition, to: ZenPosition,
  ) => {
    if (waynet === null) return;
    const positions = new Float32Array(waynet.positions);
    positions.set(from, waypoint * 3);
    void commitOps([moveWaypoint(positions, waynet.names, waypoint, to)]);
  }, [commitOps, waynet]);

  /**
   * A waypoint renamed in the panel (§16.7, W1) — the one waynet edit that is
   * not a drag, and the only edit in this surface that does not come from the
   * viewport at all.
   *
   * `from` is read out of the payload rather than taken from the panel, for the
   * reason every op reads its own origin: it is the guard the bare index is
   * addressed by, and the panel's copy is whatever the user has been typing
   * over.
   */
  const renameWaypointTo = useCallback((waypoint: number, to: string) => {
    if (waynet === null) return;
    void commitOps([renameWaypoint(waynet.names, waypoint, to)]);
  }, [commitOps, waynet]);

  /**
   * A free waypoint appended at the terrain point (§16.7, W2).
   *
   * The terrain point rather than the camera, for the same reason a placed VOB
   * takes it: it is the one position in the surface the user has actually
   * chosen, and it already arrives in ZenGin centimetres.
   *
   * It is an *append*, so it renumbers nothing and every index the overlay is
   * holding — the selected waypoint above all — still names what it named
   * before. The waypoint is free and in no edge, which is what makes
   * `WayNet::save` write it at all; joining it to the net is W3.
   */
  const addWaypointAt = useCallback((name: string, point: [number, number, number]) => {
    if (waynet === null) return;
    void commitOps([addWaypoint(waynet.names, name, point)]);
  }, [commitOps, waynet]);

  /**
   * The selected waypoint's edges, as the other end of each (§16.7, W3).
   *
   * Derived from the payload the overlay is already drawing rather than asked
   * for: `edges` is the same flat pair buffer the lines are built from, and a
   * waynet is thousands of points — walking it once per selection is cheaper
   * than a round trip and cannot disagree with what is on screen.
   */
  const waypointEdges = useMemo(() => {
    if (waynet === null || selectedWaypoint === null) return [];
    const pairs = new Uint32Array(waynet.edges);
    const neighbours: Array<{ waypoint: number; name: string }> = [];
    for (let pair = 0; pair < pairs.length; pair += 2) {
      const [left, right] = [pairs[pair], pairs[pair + 1]];
      if (left !== selectedWaypoint && right !== selectedWaypoint) continue;
      const other = left === selectedWaypoint ? right : left;
      neighbours.push({ waypoint: other, name: waynet.names[other] });
    }
    return neighbours;
  }, [waynet, selectedWaypoint]);

  /**
   * The spawns at the selected waypoint (§16.19 slice 3). The index is flat and
   * uppercase, so this is a scan keyed the same way every other by-name
   * waypoint lookup here is — the payload's own casing is display only.
   */
  const waypointSpawns = useMemo(() => {
    if (waynet === null || selectedWaypoint === null) return [];
    const point = waynet.names[selectedWaypoint].toUpperCase();
    return spawnSiteIndex.filter((site) => site.spawnPoint === point);
  }, [waynet, selectedWaypoint, spawnSiteIndex]);

  /**
   * The waypoint a typed name would join the selection to, or null when there
   * is none to join.
   *
   * Case-insensitively, because every other by-name lookup a waypoint has is —
   * the routine index above all, which is keyed uppercase since Daedalus is.
   * The first match wins: nothing in the format promises a waypoint name is
   * unique, which is why the *op* carries the index and checks the name rather
   * than the other way round.
   *
   * Null for the selection itself and for a waypoint it is already joined to,
   * so the button is dead rather than the round trip refused — both are
   * refusals the binding makes as well, and this side is holding the list.
   */
  const resolveWaypointToJoin = useCallback((typed: string): number | null => {
    if (waynet === null || selectedWaypoint === null) return null;
    const wanted = typed.trim().toUpperCase();
    if (wanted === '') return null;
    const at = waynet.names.findIndex((name) => name.toUpperCase() === wanted);
    if (at === -1 || at === selectedWaypoint) return null;
    return waypointEdges.some((edge) => edge.waypoint === at) ? null : at;
  }, [selectedWaypoint, waynet, waypointEdges]);

  /**
   * The two directions of an edge, from the panel (§16.7, W3).
   *
   * Both endpoints are index+name pairs the factory reads out of the payload,
   * the same address a move and a rename stand on — an edge inserts, deletes
   * and reorders no waypoint, so no index moves under it.
   */
  const joinWaypointTo = useCallback((to: number) => {
    if (waynet === null || selectedWaypoint === null) return;
    void commitOps([connectWaypoints(waynet.names, selectedWaypoint, to)]);
  }, [commitOps, selectedWaypoint, waynet]);

  const unjoinWaypointFrom = useCallback((to: number) => {
    if (waynet === null || selectedWaypoint === null) return;
    void commitOps([disconnectWaypoints(waynet.names, selectedWaypoint, to)]);
  }, [commitOps, selectedWaypoint, waynet]);

  /**
   * Delete a waypoint (§16.7, W4) — **the waynet's one uninvertible edit.**
   *
   * It renumbers every waypoint after it, which is what no other waynet op does
   * and what the index+name pair every one of them is addressed by could not
   * survive. §15 settled it the way it settled the VOB delete: the history
   * clears rather than replaying entries against an enumeration that has moved,
   * and the user is told first — the dialog below, the second and last confirm
   * in this surface.
   */
  const removeWaypoint = useCallback((waypoint: number) => {
    if (waynet === null) return;
    void commitOps([deleteWaypoint(waynet.names, waypoint)]);
  }, [commitOps, waynet]);

  /** The name the dialog opens with: `FP_` because a waypoint this authors is a
   *  free point, and the first index nothing is called yet, so the suggestion is
   *  never one the payload already refuses. */
  const suggestedWaypointName = useCallback(() => {
    const names = waynet === null ? [] : waynet.names;
    let at = names.length;
    while (names.includes(`FP_NEW_${at}`)) at += 1;
    return `FP_NEW_${at}`;
  }, [waynet]);

  /**
   * Every waypoint name a script in the project actually calls for, sorted —
   * the add-waypoint dialog's autocomplete list. `waypointSiteIndex`'s keys
   * are the project index's own uppercased names (Daedalus is
   * case-insensitive), which is the casing every retail name already has, so
   * nothing here re-derives a display casing of its own.
   */
  const knownWaypointNames = useMemo(
    () => Object.keys(waypointSiteIndex).sort(),
    [waypointSiteIndex],
  );

  return {
    moveWaypointTo,
    renameWaypointTo,
    addWaypointAt,
    joinWaypointTo,
    unjoinWaypointFrom,
    removeWaypoint,
    waypointEdges,
    waypointSpawns,
    resolveWaypointToJoin,
    suggestedWaypointName,
    knownWaypointNames,
  };
}
