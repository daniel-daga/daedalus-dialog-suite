import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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

interface RowData {
  rows: VobRow[];
  reader: VobReader;
  expanded: ReadonlySet<number>;
  selected: ReadonlySet<number>;
  onSelect: (vob: number, additive: boolean) => void;
  onToggle: (vob: number) => void;
  /** Absent on a read-only tree, and then no row is draggable at all — a row
   *  that looks draggable and drops nowhere is worse than one that does not. */
  onDragVob?: (vob: number) => void;
  onDropOn?: (vob: number) => void;
  /** Whether the drag in flight may land on this row. Drives `preventDefault`
   *  on dragover, which is what decides whether the browser offers a drop
   *  cursor at all — so an impossible target says so before the mouse is let
   *  go, and the drop event never fires for it. */
  canDropOn: (vob: number) => boolean;
}

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { rows, reader, expanded, selected, onSelect, onToggle } = data;
  const { onDragVob, onDropOn, canDropOn } = data;
  const { vob, depth, hasChildren } = rows[index];

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
      onClick={(event) => onSelect(vob, event.ctrlKey || event.metaKey)}
      draggable={onDragVob !== undefined}
      onDragStart={onDragVob === undefined ? undefined : () => onDragVob(vob)}
      onDragOver={(event) => { if (canDropOn(vob)) event.preventDefault(); }}
      onDrop={onDropOn === undefined ? undefined : (event) => { event.preventDefault(); onDropOn(vob); }}
      style={style}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
        pl: `${4 + depth * INDENT}px`, pr: 1, whiteSpace: 'nowrap',
        bgcolor: isSelected ? 'action.selected' : undefined,
        '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
      }}
    >
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
    </Box>
  );
}, areEqual);
Row.displayName = 'WorldSceneTreeRow';

export interface WorldSceneTreeProps {
  summary: WorldSummary;
  /** Indices into the `VobIndex` — names are not unique and rows move. The last
   *  is the one the viewport and the property grid follow. */
  selection: readonly number[];
  /** `additive` is a Ctrl/Cmd click: add this VOB to the selection rather than
   *  replacing it, which is how a multi-select batch is built. */
  onSelect: (vob: number, additive: boolean) => void;
  /**
   * Move `vob` into `toParent` at `slot` — absent on a read-only tree, and then
   * nothing in it is draggable.
   *
   * A drop **onto** a row rather than between rows, because the gesture has to
   * be unambiguous without an insertion indicator, and "becomes a child of what
   * you dropped it on" is the one reading that needs no extra UI. The slot is
   * therefore always the end of that parent's children, which is all a drop with
   * no position in it can honestly mean.
   */
  onReparent?: (vob: number, toParent: number, slot: number) => void;
}

const WorldSceneTree: React.FC<WorldSceneTreeProps> = ({
  summary, selection, onSelect, onReparent,
}) => {
  const { tree, reader } = useMemo(() => vobModelOf(summary), [summary]);
  const selected = useMemo(() => new Set(selection), [selection]);
  // Only the primary is followed. Expanding and scrolling to every VOB of a
  // large selection would fight the user for the scroll position on every
  // Ctrl+click.
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

  // A VOB dropped into its own subtree is unreachable from the roots: not
  // enumerated, not counted, not written. The op refuses it and so does the
  // binding — this is the layer that must not offer it in the first place.
  const canDropOn = useCallback((target: number) => (
    dragging !== null && target !== dragging && !tree.ancestors(target).includes(dragging)
  ), [dragging, tree]);

  const onDropOn = useCallback((target: number) => {
    const vob = dragging;
    setDragging(null);
    // Checked again rather than trusted: `canDropOn` gates the browser's drop
    // cursor, and a drop can still be delivered by anything that dispatches the
    // event itself.
    if (vob === null || onReparent === undefined || !canDropOn(target)) return;
    onReparent(vob, target, tree.children(target).length);
  }, [dragging, onReparent, tree, canDropOn]);

  const itemData = useMemo<RowData>(
    () => ({
      rows,
      reader,
      expanded,
      selected,
      onSelect,
      onToggle,
      canDropOn,
      onDragVob: onReparent === undefined ? undefined : setDragging,
      onDropOn: onReparent === undefined ? undefined : onDropOn,
    }),
    [rows, reader, expanded, selected, onSelect, onToggle, canDropOn, onReparent, onDropOn],
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
