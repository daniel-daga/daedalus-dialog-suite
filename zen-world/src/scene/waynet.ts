// The waynet as the binding emits it (level-editor.md §7), beside `VobIndex`
// for the same reason: it is a shape zenkit-node produces and the domain
// reasons about, so the editor is the wrong owner for it. `VobIndex` moved
// here first; this is the other half of the pair the split left behind.
//
// The ops here address a waypoint by its index into this point list — see
// `MoveWaypoint` and `RemoveWaypoint` in `../model/ops` — and take the columns
// raw rather than the payload, which is why nothing in `zen-world` named the
// type until now.

/**
 * The bits packed into {@link WaynetPayload.flags}, defined once beside the
 * field they describe. The overlay colours a point from them and the Problems
 * scan derives the free-point set from them; a private copy in either that
 * drifts from `getWaynet` is a silent misclassification, not a failure.
 */
export const WAYNET_FLAG_FREE_POINT = 0b01;
export const WAYNET_FLAG_UNDER_WATER = 0b10;

/**
 * The waynet as a drawable graph (zenkit-node's `getWaynet`). Stored order,
 * ZenGin space, edges as index pairs — an overlay builds a line buffer from
 * indices, and the single coordinate conversion stays at the scene root.
 */
export interface WaynetPayload {
  count: number;
  names: string[];
  positions: ArrayBuffer;
  directions: ArrayBuffer;
  waterDepths: ArrayBuffer;
  /** {@link WAYNET_FLAG_FREE_POINT} and {@link WAYNET_FLAG_UNDER_WATER}. */
  flags: ArrayBuffer;
  edgeCount: number;
  edges: ArrayBuffer;
  danglingEdges: number;
}
