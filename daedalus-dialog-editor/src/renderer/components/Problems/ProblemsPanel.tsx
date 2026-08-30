import React, { useEffect, useMemo } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import {
  SEARCHABLE_PANE_PATTERN,
  searchablePaneContentSx,
  searchablePaneHeaderSx,
  searchablePaneShellSx
} from '../common/searchablePaneStyles';
import { useProblemsStore } from '../../store/problemsStore';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useUISelectionStore } from '../../store/uiSelectionStore';
import { useWorldStore, worldFocusOf } from '../../store/worldStore';
import { useNavigation } from '../../hooks/useNavigation';
import type { Problem } from '../../problems/domain/types';
import ProblemsList from './ProblemsList';

/**
 * Project-wide Problems panel. Runs the lint rules over the parsed project files
 * (re-scanning as background ingestion advances) and renders a navigable list.
 * Clicking a problem jumps to the offending dialog or function.
 */
const ProblemsPanel: React.FC = () => {
  const problems = useProblemsStore((s) => s.problems);
  const hasScanned = useProblemsStore((s) => s.hasScanned);
  const scannedFileCount = useProblemsStore((s) => s.scannedFileCount);
  const totalFileCount = useProblemsStore((s) => s.totalFileCount);
  const runScan = useProblemsStore((s) => s.runScan);
  const requestScan = useProblemsStore((s) => s.requestScan);
  // parsedFiles are ingested in the background; re-scan whenever they change.
  // The store schedules the actual scan: deferred to a single scan while
  // ingestion runs, debounced otherwise. The isIngesting dependency makes the
  // effect fire on the completion flip even without a parseGeneration bump.
  const parseGeneration = useProjectStore((s) => s.parseGeneration);
  const isIngesting = useProjectStore((s) => s.isIngesting);
  const { navigateToDialog, navigateToSymbol } = useNavigation();
  // A world finding is only navigable while the world it addresses is the one
  // that is open — the editor holds one at a time, and the finding may belong
  // to another.
  const worldOpen = useWorldStore((s) => s.status === 'ready');

  useEffect(() => {
    requestScan();
  }, [requestScan, parseGeneration, isIngesting]);

  const { errorCount, warningCount } = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const problem of problems) {
      if (problem.severity === 'error') errors += 1;
      else warnings += 1;
    }
    return { errorCount: errors, warningCount: warnings };
  }, [problems]);

  const handleSelect = async (problem: Problem): Promise<void> => {
    const locus = problem.locus;
    // A world locus has no file to open: it is an address into the open world,
    // and the jump is the World surface's to make (§16.20 slice 2). The row is
    // disabled when this would find nothing, so both guards are belt and
    // braces for a click that arrives as the world is closing.
    if (locus.kind === 'world') {
      const focus = worldFocusOf(locus);
      if (focus === null || useWorldStore.getState().status !== 'ready') return;
      useWorldStore.getState().requestFocus(focus);
      useUISelectionStore.getState().setActiveView('world');
      return;
    }

    const navigated = locus.dialogName
      ? await navigateToDialog(locus.dialogName, locus.functionName)
      : locus.functionName
        ? await navigateToSymbol(locus.functionName)
        : false;
    if (navigated) return;

    // Both navigators search the merged semantic model, which only covers the
    // files that have been opened. The waypoint rule's sites come from the
    // project index's whole-project pass, so a warning in a routines file
    // nobody opened resolves to nothing — and Problems is the whole main area,
    // so a click that goes nowhere also says nothing. Fall back to the one
    // thing every script problem carries: the file that owns the declaration.
    await useEditorStore.getState().openFile(locus.filePath);
    const { setSelectedFunctionName, setActiveView } = useUISelectionStore.getState();
    if (locus.functionName) setSelectedFunctionName(locus.functionName);
    setActiveView('dialog');
  };

  /**
   * The "Add to world" action on a `waypoint-not-in-world` row. Not a
   * navigation at all — it arms the World surface with the name and switches
   * to it, the same way a world locus's own jump does, but there is no
   * position to jump to yet: the surface waits for the terrain click that
   * `world-add-waypoint` already takes (§16.8's W2).
   */
  const handleAddToWorld = (name: string): void => {
    useWorldStore.getState().requestFocus({ kind: 'add-waypoint', name });
    useUISelectionStore.getState().setActiveView('world');
  };

  const ingestionIncomplete = totalFileCount > scannedFileCount;

  return (
    <Box
      data-testid="problems-panel"
      data-ui-pattern={SEARCHABLE_PANE_PATTERN}
      sx={(theme) => ({ ...searchablePaneShellSx(theme), height: '100%' })}
    >
      <Box sx={searchablePaneHeaderSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="subtitle2">Problems</Typography>
          <Button
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => runScan()}
            data-testid="problems-rescan"
          >
            Rescan
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" data-testid="problems-summary">
          {hasScanned
            ? `${errorCount} error${errorCount === 1 ? '' : 's'}, ${warningCount} warning${warningCount === 1 ? '' : 's'}`
            : 'Scanning…'}
          {ingestionIncomplete ? ` · ${scannedFileCount}/${totalFileCount} files scanned` : ''}
        </Typography>
      </Box>
      <Box sx={searchablePaneContentSx}>
        <ProblemsList
          problems={problems}
          onSelect={handleSelect}
          worldOpen={worldOpen}
          onAddToWorld={handleAddToWorld}
        />
      </Box>
    </Box>
  );
};

export default ProblemsPanel;
