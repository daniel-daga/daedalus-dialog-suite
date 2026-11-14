import React, { useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  LinearProgress, MenuItem, TextField, Typography,
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import {
  SEARCHABLE_PANE_PATTERN,
  searchablePaneContentSx,
  searchablePaneFilterStripSx,
  searchablePaneHeaderSx,
  searchablePaneShellSx,
  searchablePaneTextFieldSx
} from '../common/searchablePaneStyles';
import { useProblemsStore } from '../../store/problemsStore';
import { useProjectStore } from '../../store/projectStore';
import { useFileStore } from '../../store/fileStore';
import { useUISelectionStore } from '../../store/uiSelectionStore';
import { useWorldStore } from '../../store/worldStore';
import type { Problem } from '../../problems/domain/types';
import { looksLikeAnotherLanguage } from '../../problems/domain/rules/outputUnitDrift';
import ProblemsList, { RULE_LABEL, SEVERITY_LABEL, secondaryText } from './ProblemsList';
import SyntaxErrorsDisplay from '../SyntaxErrorsDisplay';
import ProblemDetails from './ProblemDetails';
import type { ParseError } from '../../types/global';

/**
 * Project-wide findings, refreshed by storeSync as project/world inputs change.
 * Every finding is inspected here without replacing the active editor file.
 */
const ProblemsPanel: React.FC = () => {
  const problems = useProblemsStore((s) => s.problems);
  const hasScanned = useProblemsStore((s) => s.hasScanned);
  const isScanning = useProblemsStore((s) => s.isScanning);
  const scannedFileCount = useProblemsStore((s) => s.scannedFileCount);
  const totalFileCount = useProblemsStore((s) => s.totalFileCount);
  const runScan = useProblemsStore((s) => s.runScan);
  const isIngesting = useProjectStore((s) => s.isIngesting);
  // The scan reads the project's parsed files, so in single-file mode there is
  // nothing to scan — say so rather than reporting a clean scan (F18).
  const projectOpen = useProjectStore((s) => s.projectPath !== null);
  const worldOpen = useWorldStore((s) => s.status === 'ready');
  const [severity, setSeverity] = useState('');
  const [location, setLocation] = useState('');
  const [rule, setRule] = useState('');
  const [search, setSearch] = useState('');
  const [errorDetails, setErrorDetails] = useState<{ filePath: string; errors: ParseError[] } | null>(null);
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);
  const detailsRequest = useRef(0);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const filtersActive = severity !== '' || location !== '' || rule !== '' || search !== '';
  const scanning = projectOpen && (isScanning || isIngesting || !hasScanned);
  const locations = useMemo(() => {
    const paths = new Set(problems.flatMap((problem) => (
      problem.locus.kind === 'script' ? [problem.locus.filePath] : []
    )));
    // Keep the selection available when a rescan clears its last finding.
    if (location && location !== 'script' && location !== 'world') paths.add(location);
    return [...paths].sort();
  }, [problems, location]);
  const problemsBeforeKind = useMemo(() => {
    const query = search.trim().toLowerCase();
    return problems.filter((problem) => {
      if (severity && problem.severity !== severity) return false;
      if (location && (location === 'world' || location === 'script'
        ? problem.locus.kind !== location
        : problem.locus.kind !== 'script' || problem.locus.filePath !== location)) return false;
      const filePath = problem.locus.kind === 'script' ? problem.locus.filePath : '';
      return !query || `${problem.message} ${RULE_LABEL[problem.rule]} ${secondaryText(problem)} ${filePath}`
        .toLowerCase().includes(query);
    });
  }, [problems, severity, location, search]);
  const kindCounts = useMemo(() => {
    const counts = new Map<Problem['rule'], number>();
    for (const problem of problemsBeforeKind) {
      counts.set(problem.rule, (counts.get(problem.rule) ?? 0) + 1);
    }
    return counts;
  }, [problemsBeforeKind]);
  const filteredProblems = useMemo(() => (
    rule ? problemsBeforeKind.filter((problem) => problem.rule === rule) : problemsBeforeKind
  ), [problemsBeforeKind, rule]);
  const emptyMessage = !projectOpen
    ? 'Open a project to scan for problems.'
    : scanning
      ? 'Scanning…'
      : filtersActive && problems.length > 0
        ? 'No problems match your filters.'
        : 'No problems found.';

  const { errorCount, warningCount, hintCount } = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    let hints = 0;
    for (const problem of problems) {
      if (problem.severity === 'error') errors += 1;
      else if (problem.severity === 'hint') hints += 1;
      else warnings += 1;
    }
    return { errorCount: errors, warningCount: warnings, hintCount: hints };
  }, [problems]);

  const handleSelect = async (problem: Problem): Promise<void> => {
    const locus = problem.locus;
    const request = ++detailsRequest.current;
    setSelectedProblem(problem);
    setErrorDetails(null);
    setDetailsError(null);
    if (problem.rule === 'parse-error' && locus.kind === 'script') {
      try {
        // Inspect disk without opening or replacing the active editor file.
        const model = await window.editorAPI.parseDialogFile(locus.filePath);
        if (request === detailsRequest.current) setErrorDetails({ filePath: locus.filePath, errors: model.errors ?? [] });
      } catch (error) {
        if (request === detailsRequest.current) setDetailsError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const reloadDetails = async (): Promise<void> => {
    if (selectedProblem?.locus.kind !== 'script') return;
    const { filePath } = selectedProblem.locus;
    const request = ++detailsRequest.current;
    setDetailsError(null);
    const session = useProjectStore.getState().getProjectSession();
    const models = await useProjectStore.getState().reindexFiles([filePath]);
    if (session !== useProjectStore.getState().getProjectSession()) return;
    const model = models.get(filePath);
    if (!model) throw new Error('Could not reload the script file.');
    // Open files own their editor model, including unsaved edits; only refresh background models.
    if (!useFileStore.getState().openFiles.has(filePath)) {
      useProjectStore.getState().updateFileModel(filePath, model);
    }
    runScan();
    if (request !== detailsRequest.current) return;
    const updated = useProblemsStore.getState().problems.find((problem) => problem.id === selectedProblem.id);
    setErrorDetails(model.hasErrors ? { filePath, errors: model.errors ?? [] } : null);
    setSelectedProblem(model.hasErrors ? selectedProblem : updated ?? null);
  };

  // Explicit opt-in: the World surface waits for the terrain click to place it.
  const handleAddToWorld = (name: string): void => {
    useWorldStore.getState().requestFocus({ kind: 'add-waypoint', name });
    useUISelectionStore.getState().setActiveView('world');
  };

  const ingestionIncomplete = totalFileCount > scannedFileCount;

  // #264's fix half: the lines the OU findings say the database should hold,
  // one per voice id — a repeated id is one entry in the database.
  const outputUnitFile = useProjectStore((s) => s.outputUnits?.filePath ?? null);
  const outputUnitLines = useMemo(() => {
    const lines = new Map<string, { name: string; text: string }>();
    for (const problem of problems) {
      const line = problem.outputUnitLine;
      if (line && !lines.has(line.name.toUpperCase())) lines.set(line.name.toUpperCase(), line);
    }
    return [...lines.values()];
  }, [problems]);
  // #265: German scripts over an English OU make every line stale, and the
  // update would then overwrite the English. Said once, above the rows.
  const outputUnitAgreement = useProblemsStore((s) => s.outputUnitAgreement);
  const otherLanguage = outputUnitAgreement !== null && looksLikeAnotherLanguage(outputUnitAgreement);
  const otherLanguageText = otherLanguage
    ? `${outputUnitAgreement.stale} of ${outputUnitAgreement.compared} lines your scripts share with the OU database `
      + 'disagree — more than editing changes. The OU may be in another language than your scripts '
      + '(German MDK scripts over an English game, or the reverse).'
    : null;
  const [confirmingOuUpdate, setConfirmingOuUpdate] = useState(false);
  const [ouUpdating, setOuUpdating] = useState(false);
  const [ouUpdateError, setOuUpdateError] = useState<string | null>(null);

  const handleUpdateOutputUnits = async (): Promise<void> => {
    setOuUpdating(true);
    setOuUpdateError(null);
    try {
      const { outputUnits } = await window.editorAPI.updateOutputUnits(outputUnitLines);
      // What is on disk now is what the next scan compares against.
      useProjectStore.setState({ outputUnits });
      runScan();
      setConfirmingOuUpdate(false);
    } catch (error) {
      setOuUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setOuUpdating(false);
    }
  };

  return (
    <Box
      data-testid="problems-panel"
      data-ui-pattern={SEARCHABLE_PANE_PATTERN}
      sx={(theme) => ({ ...searchablePaneShellSx(theme), height: '100%' })}
    >
      {selectedProblem ? (
        <>
          <Box sx={searchablePaneHeaderSx}>
            <Button onClick={() => {
              detailsRequest.current += 1;
              setSelectedProblem(null); setErrorDetails(null); setDetailsError(null);
            }}>Back to problems</Button>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {detailsError && <Alert severity="error">{detailsError}</Alert>}
            {errorDetails ? <SyntaxErrorsDisplay
              filePath={errorDetails.filePath}
              errors={errorDetails.errors}
              onReload={reloadDetails}
            /> : <ProblemDetails problem={selectedProblem} onReload={reloadDetails} />}
          </Box>
        </>
      ) : null}
      <Box sx={{ display: selectedProblem ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={searchablePaneHeaderSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="subtitle2">Problems</Typography>
          {outputUnitLines.length > 0 && outputUnitFile && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => { setOuUpdateError(null); setConfirmingOuUpdate(true); }}
              data-testid="problems-update-ous"
            >
              {`Update OUs (${outputUnitLines.length} line${outputUnitLines.length === 1 ? '' : 's'})`}
            </Button>
          )}
          <Button
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => runScan()}
            disabled={scanning || !projectOpen}
            data-testid="problems-rescan"
          >
            Rescan
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" data-testid="problems-summary" role="status">
          {!projectOpen
            ? 'Problems are found by scanning a project — open a project to see them here.'
            : scanning
              ? (problems.length > 0 ? 'Scanning… Showing previous results.' : 'Scanning…')
              : `${errorCount} error${errorCount === 1 ? '' : 's'}, ${warningCount} warning${warningCount === 1 ? '' : 's'}`
                + (hintCount > 0 ? `, ${hintCount} hint${hintCount === 1 ? '' : 's'}` : '')}
          {ingestionIncomplete ? ` · ${scannedFileCount}/${totalFileCount} files scanned` : ''}
        </Typography>
      </Box>
      <Box sx={searchablePaneFilterStripSx}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <TextField
            size="small" label="Search problems" value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={(theme) => ({ ...searchablePaneTextFieldSx(theme), flex: '1 1 220px' })}
          />
          <TextField select size="small" label="Type" value={severity} onChange={(event) => setSeverity(event.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="">All types</MenuItem>
            {Object.entries(SEVERITY_LABEL).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Location" value={location} onChange={(event) => setLocation(event.target.value)} sx={{ width: 240, maxWidth: '100%' }}>
            <MenuItem value="">All locations</MenuItem>
            <MenuItem value="script">Scripts</MenuItem>
            <MenuItem value="world">World</MenuItem>
            {locations.map((filePath) => <MenuItem key={filePath} value={filePath}>{filePath}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Kind" value={rule} onChange={(event) => setRule(event.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">{`All kinds (${problemsBeforeKind.length})`}</MenuItem>
            {Object.entries(RULE_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>{`${label} (${kindCounts.get(value as Problem['rule']) ?? 0})`}</MenuItem>
            ))}
          </TextField>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary" data-testid="problems-filter-count">
            {`${filteredProblems.length} / ${problems.length} shown`}
          </Typography>
          <Button size="small" disabled={!filtersActive} onClick={() => {
            setSeverity(''); setLocation(''); setRule(''); setSearch('');
          }}>Reset filters</Button>
        </Box>
      </Box>
      {scanning && <LinearProgress aria-label="Scanning project" />}
      {otherLanguageText && (
        <Alert severity="warning" data-testid="problems-ou-language" sx={{ mx: 1, mb: 1 }}>
          {otherLanguageText}
        </Alert>
      )}
      <Box sx={searchablePaneContentSx} aria-busy={scanning}>
        <ProblemsList
          problems={filteredProblems}
          emptyMessage={emptyMessage}
          onSelect={handleSelect}
          worldOpen={worldOpen}
          onAddToWorld={handleAddToWorld}
        />
      </Box>
      </Box>
      <Dialog
        open={confirmingOuUpdate}
        onClose={() => !ouUpdating && setConfirmingOuUpdate(false)}
        aria-labelledby="problems-update-ous-title"
      >
        <DialogTitle id="problems-update-ous-title">Update the OU database</DialogTitle>
        <DialogContent>
          {ouUpdateError && <Alert severity="error" sx={{ mb: 1 }}>{ouUpdateError}</Alert>}
          {otherLanguageText && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {`${otherLanguageText} Updating would overwrite it with your scripts' text.`}
            </Alert>
          )}
          <DialogContentText variant="body2" sx={{ whiteSpace: 'pre-line' }}>
            {`Writes ${outputUnitLines.length} subtitle${outputUnitLines.length === 1 ? '' : 's'} from your scripts into\n${outputUnitFile}\n`
              + 'and its OU.CSL twin if there is one, which is what the game shows.\n\n'
              + 'Each file is copied to <name>.bak first. Lines no script of yours claims stay as they are.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingOuUpdate(false)} disabled={ouUpdating}>Cancel</Button>
          <Button
            variant="contained"
            color={otherLanguage ? 'warning' : 'primary'}
            onClick={() => void handleUpdateOutputUnits()}
            disabled={ouUpdating}
          >
            {otherLanguage ? 'Overwrite anyway' : 'Update'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProblemsPanel;
