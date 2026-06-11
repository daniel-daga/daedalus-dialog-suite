/**
 * Visual constants for the quest graph.
 * All colours and layout dimensions live here so they can be updated in one place.
 */

// ── Edge colours ────────────────────────────────────────────────────────────

/** Orange dashed line – dialog choice / transition edge */
export const CHOICE_EDGE_COLOR = '#ff9800';

/** Amber line – structured condition prerequisite edge */
export const CONDITION_EDGE_COLOR = '#ffb74d';

/** Grey dashed line – NpcKnowsInfo prerequisite edge */
export const KNOWS_EDGE_COLOR = '#b1b1b7';

/** Blue animated dashed line – variable value prerequisite edge */
export const VARIABLE_EDGE_COLOR = '#2196f3';

/** Green dashed line – implicit external / world entry-trigger edge */
export const ENTRY_EDGE_COLOR = '#81c784';

// ── Node / layout dimensions ─────────────────────────────────────────────────

/** Width of every dialog / quest-state / condition node (pixels). */
export const NODE_WIDTH = 280;

/** Height of every dialog / quest-state / condition node (pixels). */
export const NODE_HEIGHT = 132;

/** Dagre graph options. */
export const DAGRE_LAYOUT = {
  rankdir: 'LR',
  align: 'UL',
  /** Minimum distance between adjacent ranks (columns in LR mode). */
  ranksep: 180,
  /** Minimum distance between sibling nodes in the same rank. */
  nodesep: 120,
  /** Minimum distance between adjacent edges. */
  edgesep: 60,
  /** Left/right graph margin. */
  marginx: 40,
  /** Top/bottom graph margin. */
  marginy: 40,
} as const;
