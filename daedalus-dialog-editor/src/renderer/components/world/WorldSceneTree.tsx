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
  selectedVob: number | null;
  onSelect: (vob: number) => void;
  onToggle: (vob: number) => void;
}

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { rows, reader, expanded, selectedVob, onSelect, onToggle } = data;
  const { vob, depth, hasChildren } = rows[index];

  // Most VOBs are unnamed — retail NewWorld's 23,288 carry 2,654 distinct
  // names — so the visual is the label when the name is empty. Falling straight
  // back to the class made the tree a column of the word "zCVob"; the class is
  // shown dimmed on every row regardless, so it is never the only thing worth
  // saying.
  const className = reader.className(vob);
  const label = reader.name(vob) || reader.visual(vob);
  const isSelected = vob === selectedVob;

  return (
    <Box
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? expanded.has(vob) : undefined}
      data-testid={`world-vob-row-${vob}`}
      onClick={() => onSelect(vob)}
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
  /** An index into the `VobIndex` — names are not unique and rows move. */
  selectedVob: number | null;
  onSelect: (vob: number) => void;
}

const WorldSceneTree: React.FC<WorldSceneTreeProps> = ({ summary, selectedVob, onSelect }) => {
  const { tree, reader } = useMemo(() => vobModelOf(summary), [summary]);
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

  const itemData = useMemo<RowData>(
    () => ({ rows, reader, expanded, selectedVob, onSelect, onToggle }),
    [rows, reader, expanded, selectedVob, onSelect, onToggle],
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
