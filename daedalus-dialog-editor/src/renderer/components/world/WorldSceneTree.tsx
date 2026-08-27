import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { FixedSizeList as List, type ListChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { flattenVisible, type VobReader, type VobRow } from 'zen-world';
import type { WorldSummary } from '../../../shared/worldTypes';
import { vobModelOf } from '../../world/vobModel';

// The scene tree over a world's VOB hierarchy (level-editor.md §6).
//
// Everything structural comes from `zen-world/model` — the hierarchy is two
// columns of the `VobIndex` and reconstructing it is domain logic, not a
// rendering concern. What is left here is the two things that make a tree over
// 23,288 VOBs usable at all:
//
//   - it is virtualized, and collapsed by default. Expanding everything on open
//     would lay out 23,288 rows before anyone had asked for one.
//   - a selection arriving from the viewport expands the ancestors it is
//     hidden behind. A pick returns a VOB index and nothing else, and the row
//     for it is usually inside collapsed parents.
//
// Rows are read, never built: `createVobReader` makes its column views once, so
// scrolling does not allocate a typed array per row per column.

const ROW_HEIGHT = 28;
const INDENT = 14;
/** How much of a row belongs to the gap above or below it. A quarter: enough to
 *  hit deliberately, small enough that the row itself is still the easy target,
 *  since becoming a child is the commoner move. */
const EDGE_HEIGHT = 7;

/** Which side of a row a between-rows drop is pointing at. */
export type DropEdge = 'before' | 'after';

interface RowData {
  rows: VobRow[];
  reader: VobReader;
  expanded: ReadonlySet<number>;
  selected: ReadonlySet<number>;
  onSelect: (vob: number, additive: boolean) => void;
  onToggle: (vob: number) => void;
  /** Absent on a tree with no viewport beside it, and then no row carries a
   *  locator and a double-click does nothing. */
  onFocus?: (vob: number) => void;
  /** Absent on a read-only tree, and then no row is draggable at all — a row
   *  that looks draggable and drops nowhere is worse than one that does not. */
  onDragVob?: (vob: number) => void;
  /** A drag that ended anywhere — including outside the tree, where no drop is
   *  ever delivered. Without it an abandoned drag stays in flight and the next
   *  pass over a row's edge draws an insertion line for it. */
  onDragEnd: () => void;
  onDropOn?: (vob: number) => void;
  /** Whether the drag in flight may land on this row. Drives `preventDefault`
   *  on dragover, which is what decides whether the browser offers a drop
   *  cursor at all — so an impossible target says so before the mouse is let
   *  go, and the drop event never fires for it. */
  canDropOn: (vob: number) => boolean;
  /** The between-rows half of the same three: whether the gap is a legal
   *  landing, what to do when it is dropped on, and which gap the drag is over
   *  so exactly one line is drawn. */
  canDropBetween: (vob: number, edge: DropEdge) => boolean;
  onDropBetween?: (vob: number, edge: DropEdge) => void;
  hovering: { vob: number; edge: DropEdge } | null;
  onHoverEdge: (at: { vob: number; edge: DropEdge } | null) => void;
}

/**
 * The strip along a row's edge that means "between the rows", and the insertion
 * line it draws when a drag is over it.
 *
 * A strip of its own rather than a zone measured off the pointer's Y within the
 * row: the row is the drop target for "become this VOB's child", and splitting
 * one element's height between two meanings makes both of them a guess about
 * where the mouse was. Two elements, two handlers, and the boundary is where the
 * user can see it.
 */
const DropStrip: React.FC<{
  vob: number;
  edge: DropEdge;
  data: RowData;
}> = ({ vob, edge, data }) => {
  const { canDropBetween, onDropBetween, hovering, onHoverEdge } = data;
  const active = hovering !== null && hovering.vob === vob && hovering.edge === edge;

  return (
    <Box
      data-testid={`world-vob-drop-${edge}-${vob}`}
      data-active={active ? 'true' : undefined}
      onDragOver={(event) => {
        if (!canDropBetween(vob, edge)) return;
        event.preventDefault();
        event.stopPropagation();
        // Only on a change. `dragover` fires continuously while the pointer is
        // held still, and setting the same value on every one of them would
        // re-render a virtualized tree several times a second for no change.
        if (!active) onHoverEdge({ vob, edge });
      }}
      onDragLeave={() => { if (active) onHoverEdge(null); }}
      onDrop={onDropBetween === undefined ? undefined : (event) => {
        event.preventDefault();
        // Or the row underneath takes the same drop as "become my child".
        event.stopPropagation();
        onDropBetween(vob, edge);
      }}
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        [edge === 'before' ? 'top' : 'bottom']: 0,
        height: `${EDGE_HEIGHT}px`,
        zIndex: 2,
        [edge === 'before' ? 'borderTop' : 'borderBottom']: 2,
        borderColor: active ? 'primary.main' : 'transparent',
      }}
    />
  );
};

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { rows, reader, expanded, selected, onSelect, onToggle, onFocus } = data;
  const { onDragVob, onDropOn, canDropOn } = data;
  const { vob, depth, hasChildren } = rows[index];
  // Every gap is "before the row under the line", which is what makes a gap mean
  // exactly one thing at a change of depth. The last row is the exception it has
  // to be: there is no row below it, so it carries the only "after" there is.
  const isLast = index === rows.length - 1;

  // Most VOBs are unnamed — retail NewWorld's 23,288 carry 2,654 distinct
  // names — so the visual is the label when the name is empty. Falling straight
  // back to the class made the tree a column of the word "zCVob"; the class is
  // shown dimmed on every row regardless, so it is never the only thing worth
  // saying.
  const className = reader.className(vob);
  const label = reader.name(vob) || reader.visual(vob);
  const isSelected = selected.has(vob);

  return (
    <Box
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? expanded.has(vob) : undefined}
      data-testid={`world-vob-row-${vob}`}
      onClick={(event) => onSelect(vob, event.shiftKey || event.ctrlKey || event.metaKey)}
      onDoubleClick={onFocus === undefined ? undefined : () => onFocus(vob)}
      draggable={onDragVob !== undefined}
      onDragStart={onDragVob === undefined ? undefined : () => onDragVob(vob)}
      onDragEnd={onDragVob === undefined ? undefined : data.onDragEnd}
      onDragOver={(event) => { if (canDropOn(vob)) event.preventDefault(); }}
      onDrop={onDropOn === undefined ? undefined : (event) => { event.preventDefault(); onDropOn(vob); }}
      style={style}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
        pl: `${4 + depth * INDENT}px`, pr: 1, whiteSpace: 'nowrap',
        bgcolor: isSelected ? 'action.selected' : undefined,
        '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
        // Hidden rather than faded out: an invisible target that still takes
        // clicks is a row that sometimes jumps instead of selecting.
        '&:hover .world-vob-locate': { visibility: 'visible' },
      }}
    >
      {onDropOn !== undefined && <DropStrip vob={vob} edge="before" data={data} />}
      {onDropOn !== undefined && isLast && <DropStrip vob={vob} edge="after" data={data} />}
      <Box
        component="span"
        data-testid={hasChildren ? `world-vob-toggle-${vob}` : undefined}
        onClick={(event) => { event.stopPropagation(); if (hasChildren) onToggle(vob); }}
        sx={{ display: 'flex', width: 18, flexShrink: 0, color: 'text.secondary' }}
      >
        {hasChildren && (expanded.has(vob)
          ? <ExpandMoreIcon fontSize="small" />
          : <ChevronRightIcon fontSize="small" />)}
      </Box>
      {label
        ? <Typography variant="caption" noWrap>{label}</Typography>
        : null}
      <Typography variant="caption" color="text.secondary" noWrap sx={{ opacity: 0.75 }}>
        {className}
      </Typography>
      {/* The discoverable half of the jump — a double-click is not something
          anyone finds by looking. It stops the click rather than letting it
          reach the row: the row's handler is what adds and removes in a
          Shift-click batch, and a locator that also toggled membership would
          take a VOB out of the selection it was asked to fly to. */}
      {onFocus !== undefined && (
        <Box
          component="span"
          className="world-vob-locate"
          title="Jump the camera to this VOB"
          data-testid={`world-vob-locate-${vob}`}
          onClick={(event) => { event.stopPropagation(); onFocus(vob); }}
          sx={{
            display: 'flex', ml: 'auto', flexShrink: 0, pl: 0.5,
            visibility: 'hidden', color: 'text.secondary',
          }}
        >
          <MyLocationIcon sx={{ fontSize: 14 }} />
        </Box>
      )}
    </Box>
  );
}, areEqual);
Row.displayName = 'WorldSceneTreeRow';

export interface WorldSceneTreeProps {
  summary: WorldSummary;
  /** Indices into the `VobIndex` — names are not unique and rows move. The last
   *  is the one the viewport and the property grid follow. */
  selection: readonly number[];
  /** `additive` is a Shift/Ctrl/Cmd click: add this VOB to the selection rather
   *  than replacing it, which is how a multi-select batch is built. */
  onSelect: (vob: number, additive: boolean) => void;
  /**
   * Jump the viewport's camera to this VOB and leave the orbit pivot on it — a
   * double-click on a row, or its locator.
   *
   * The other direction of the loop the effects above make: a pick in the
   * viewport scrolls the row into view, and this is how a row reaches the
   * viewport. Absent when there is no viewport beside the tree, and then no row
   * carries a locator.
   */
  onFocus?: (vob: number) => void;
  /**
   * Move `vob` into `toParent` at `slot` — `null` for a root. Absent on a
   * read-only tree, and then nothing in it is draggable.
   *
   * Two gestures reach it. A drop **onto** a row means "become this VOB's last
   * child": the one reading a drop with no position in it can honestly have.
   * A drop on the thin strip at a row's edge means **between** the rows, and
   * every gap is read as "immediately before the row under the line" — which is
   * what gives a gap one meaning where the depth changes, since the row below is
   * the only one whose own list the line is actually inside. The last visible
   * row carries the only "after" there is, because nothing is under it.
   *
   * `slot` is an index into the destination list **as it will be once the VOB
   * has been removed from where it was**, which is the convention `reparentVob`
   * takes and the only one that can express "move it two places later in its own
   * list".
   */
  onReparent?: (vob: number, toParent: number | null, slot: number) => void;
}

const WorldSceneTree: React.FC<WorldSceneTreeProps> = ({
  summary, selection, onSelect, onFocus, onReparent,
}) => {
  const { tree, reader } = useMemo(() => vobModelOf(summary), [summary]);
  const selected = useMemo(() => new Set(selection), [selection]);
  // Only the primary is followed. Expanding and scrolling to every VOB of a
  // large selection would fight the user for the scroll position on every
  // additive click.
  const selectedVob = selection.length === 0 ? null : selection[selection.length - 1];
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set<number>());
  const rows = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  const listRef = useRef<List>(null);

  // A VOB picked in the viewport is usually inside collapsed parents.
  useEffect(() => {
    if (selectedVob === null) return;
    const ancestors = tree.ancestors(selectedVob);
    if (ancestors.length === 0) return;
    setExpanded((current) => {
      if (ancestors.every((vob) => current.has(vob))) return current;
      const next = new Set(current);
      for (const vob of ancestors) next.add(vob);
      return next;
    });
  }, [selectedVob, tree]);

  // Scrolled to after the expansion above, so the row exists by the time this
  // runs — `rows` is a dependency precisely because it changes when it does.
  useEffect(() => {
    if (selectedVob === null) return;
    const at = rows.findIndex((row) => row.vob === selectedVob);
    if (at >= 0) listRef.current?.scrollToItem(at, 'smart');
  }, [rows, selectedVob]);

  const onToggle = useCallback((vob: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(vob)) next.add(vob);
      return next;
    });
  }, []);

  const [dragging, setDragging] = useState<number | null>(null);
  /** The one gap the insertion line is drawn in, while a drag is over it. */
  const [hovering, setHovering] = useState<{ vob: number; edge: DropEdge } | null>(null);

  // A VOB dropped into its own subtree is unreachable from the roots: not
  // enumerated, not counted, not written. The op refuses it and so does the
  // binding — this is the layer that must not offer it in the first place.
  const canDropOn = useCallback((target: number) => (
    dragging !== null && target !== dragging && !tree.ancestors(target).includes(dragging)
  ), [dragging, tree]);

  const onDropOn = useCallback((target: number) => {
    const vob = dragging;
    setDragging(null);
    setHovering(null);
    // Checked again rather than trusted: `canDropOn` gates the browser's drop
    // cursor, and a drop can still be delivered by anything that dispatches the
    // event itself.
    if (vob === null || onReparent === undefined || !canDropOn(target)) return;
    onReparent(vob, target, tree.children(target).length);
  }, [dragging, onReparent, tree, canDropOn]);

  const onDragEnd = useCallback(() => {
    setDragging(null);
    setHovering(null);
  }, []);

  /** The list a VOB sits in, and the list a drop beside it would go into. */
  const listOf = useCallback((vob: number) => {
    const parent = tree.parent(vob);
    return {
      parent: parent < 0 ? null : parent,
      siblings: parent < 0 ? tree.roots : tree.children(parent),
    };
  }, [tree]);

  /**
   * Where a drop on `vob`'s `edge` would put the VOB being dragged, or null when
   * it would not put it anywhere.
   *
   * The slot is an index into the destination list **after the removal**, which
   * is what `reparentVob` takes: the removal vacates a slot before the insert
   * happens, so a destination later in the VOB's own list has already shifted
   * down one by the time it is used. Off by one here is a VOB that lands on the
   * wrong side of its neighbour — a move, not a failure, so nothing reports it.
   */
  const landingAt = useCallback((target: number, edge: DropEdge) => {
    if (dragging === null) return null;

    const { parent, siblings } = listOf(target);
    // The destination's *parent* is what must not be inside the dragged
    // subtree — a root has none, and is always reachable.
    if (parent !== null
      && (parent === dragging || tree.ancestors(parent).includes(dragging))) return null;

    let slot = siblings.indexOf(target) + (edge === 'after' ? 1 : 0);
    const from = listOf(dragging);
    if (from.parent === parent) {
      const was = from.siblings.indexOf(dragging);
      if (was < slot) slot -= 1;
      // The VOB is already there. A no-op is still an op — a batch, an entry in
      // the history and a full re-read of the index — so it is refused as a
      // landing rather than sent. This is also what refuses a row's own edges
      // without a guard of their own: both of them compute the slot the VOB is
      // in already.
      if (was === slot) return null;
    }
    return { parent, slot };
  }, [dragging, listOf, tree]);

  const canDropBetween = useCallback(
    (target: number, edge: DropEdge) => landingAt(target, edge) !== null,
    [landingAt],
  );

  const onDropBetween = useCallback((target: number, edge: DropEdge) => {
    const vob = dragging;
    const landing = landingAt(target, edge);
    setDragging(null);
    setHovering(null);
    // Checked through `landingAt` again for the same reason `onDropOn` re-checks:
    // dragover gates the browser's drop cursor, not anything that dispatches the
    // event itself.
    if (vob === null || onReparent === undefined || landing === null) return;
    onReparent(vob, landing.parent, landing.slot);
  }, [dragging, landingAt, onReparent]);

  const itemData = useMemo<RowData>(
    () => ({
      rows,
      reader,
      expanded,
      selected,
      onSelect,
      onToggle,
      onFocus,
      canDropOn,
      canDropBetween,
      hovering,
      onHoverEdge: setHovering,
      onDragEnd,
      onDragVob: onReparent === undefined ? undefined : setDragging,
      onDropOn: onReparent === undefined ? undefined : onDropOn,
      onDropBetween: onReparent === undefined ? undefined : onDropBetween,
    }),
    [rows, reader, expanded, selected, onSelect, onToggle, onFocus, canDropOn, onReparent,
      onDropOn, canDropBetween, onDropBetween, hovering, onDragEnd],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" data-testid="world-tree-count">
          {summary.stats.vobCount.toLocaleString()} VOBs
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }} role="tree" aria-label="World scene tree">
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              height={height}
              width={width}
              itemCount={rows.length}
              itemSize={ROW_HEIGHT}
              itemData={itemData}
              overscanCount={8}
            >
              {Row}
            </List>
          )}
        </AutoSizer>
      </Box>
    </Box>
  );
};

export default WorldSceneTree;
