import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import ProblemsPanel from '../src/renderer/components/Problems/ProblemsPanel';
import { RULE_LABEL } from '../src/renderer/components/Problems/ProblemsList';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import type { SemanticModel } from '../src/shared/types';
import type { Problem, ProblemRuleId } from '../src/renderer/problems/domain/types';

const openFile = jest.fn();
const requestScan = jest.fn();
const problem = (rule: ProblemRuleId, locus: Problem['locus']): Problem => ({
  id: rule, rule, severity: 'warning', message: 'The full finding', locus,
});

beforeEach(() => {
  jest.clearAllMocks();
  useWorldStore.getState().reset();
  useEditorStore.setState({ openFile });
  useFileStore.setState({ activeFile: null, openFiles: new Map() });
  useProjectStore.setState({ parseGeneration: 0, isIngesting: false, projectPath: 'project' });
  useUISelectionStore.getState().setActiveView('problems');
  useProblemsStore.setState({ hasScanned: true, requestScan, isScanning: false });
});

afterEach(() => jest.restoreAllMocks());

it('ignores a late syntax-error response after another problem was selected', async () => {
  let finish!: (model: SemanticModel) => void;
  jest.spyOn(window.editorAPI, 'parseDialogFile').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  useProblemsStore.setState({ problems: [
    problem('parse-error', { kind: 'script', filePath: 'broken.d' }),
    problem('orphaned-function', { kind: 'script', filePath: 'other.d' }),
  ] });
  render(<ProblemsPanel />);
  await userEvent.click(screen.getByTestId('problem-row-0'));
  await userEvent.click(screen.getByRole('button', { name: 'Back to problems' }));
  await userEvent.click(screen.getByTestId('problem-row-1'));
  await act(async () => finish({ dialogs: {}, functions: {}, hasErrors: true, errors: [] }));
  expect(screen.getByRole('heading', { name: 'Orphaned function' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'broken.d' })).not.toBeInTheDocument();
});

it('reloads background findings without overwriting an open file or its unsaved model', async () => {
  const filePath = 'Story/Routines/Rtn.d';
  const model: SemanticModel = { dialogs: {}, functions: {}, hasErrors: false, errors: [] };
  const file = { filePath, semanticModel: model, isDirty: true, lastSaved: new Date() };
  useFileStore.setState({ activeFile: filePath, openFiles: new Map([[filePath, file]]) });
  const openFiles = useFileStore.getState().openFiles;
  useProblemsStore.setState({ problems: [problem('orphaned-function', { kind: 'script', filePath })] });
  jest.spyOn(useProjectStore.getState(), 'reindexFiles').mockResolvedValue(new Map([[filePath, model]]));
  const update = jest.spyOn(useProjectStore.getState(), 'updateFileModel');
  render(<ProblemsPanel />);
  await userEvent.click(screen.getByTestId('problem-row-0'));
  await userEvent.click(screen.getByRole('button', { name: 'Reload file' }));
  expect(update).not.toHaveBeenCalled();
  expect(useFileStore.getState().openFiles).toBe(openFiles);
  expect(useFileStore.getState().activeFile).toBe(filePath);
  expect(useUISelectionStore.getState().activeView).toBe('problems');
});

it.each(Object.keys(RULE_LABEL).filter((rule) => rule !== 'parse-error') as ProblemRuleId[])(
  'opens %s details without opening a file or leaving Problems', async (rule) => {
    useProblemsStore.setState({ problems: [problem(rule, {
      kind: 'script', filePath: 'Story/Routines/Rtn.d', functionName: 'Rtn_Start_Diego', line: 42,
    })] });
    render(<ProblemsPanel />);
    await userEvent.click(screen.getByTestId('problem-row-0'));
    expect(screen.getByRole('heading', { name: RULE_LABEL[rule] })).toBeInTheDocument();
    expect(screen.getByText('Story/Routines/Rtn.d')).toBeInTheDocument();
    expect(screen.getByText('Function: Rtn_Start_Diego')).toBeInTheDocument();
    expect(screen.getByText('Line 42')).toBeInTheDocument();
    expect(openFile).not.toHaveBeenCalled();
    expect(useUISelectionStore.getState().activeView).toBe('problems');
    await userEvent.click(screen.getByRole('button', { name: 'Back to problems' }));
    expect(screen.getByTestId('problem-row-0')).toBeVisible();
  },
);

it.each<Problem['locus']>([
  { kind: 'world' }, { kind: 'world', polygon: 1704 },
  { kind: 'world', waypoint: 'WP_MIDDLE' }, { kind: 'world', vob: 42 },
])('inspects world findings even without an open world: %j', async (locus) => {
  useProblemsStore.setState({ problems: [problem('portal-material-malformed', locus)] });
  render(<ProblemsPanel />);
  await userEvent.click(screen.getByTestId('problem-row-0'));
  expect(screen.getByRole('heading', { name: 'Malformed portal name' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('The full finding');
  expect(screen.queryByRole('button', { name: 'Edit externally' })).not.toBeInTheDocument();
  expect(useWorldStore.getState().focusRequest).toBeNull();
  expect(useUISelectionStore.getState().activeView).toBe('problems');
});

it('does not request a new scan just because the panel mounts again', () => {
  useProblemsStore.setState({ problems: [] });
  const first = render(<ProblemsPanel />);
  first.unmount();
  render(<ProblemsPanel />);
  expect(requestScan).not.toHaveBeenCalled();
});

it('keeps adding a missing waypoint an explicit action', async () => {
  useWorldStore.setState({ status: 'ready' });
  useProblemsStore.setState({ problems: [problem('waypoint-not-in-world', {
    kind: 'script', filePath: 'Rtn.d', waypoint: 'OW_PATH_42',
  })] });
  render(<ProblemsPanel />);
  await userEvent.click(screen.getByTestId('problem-row-0-add-to-world'));
  expect(useWorldStore.getState().focusRequest).toEqual({ kind: 'add-waypoint', name: 'OW_PATH_42' });
  expect(useUISelectionStore.getState().activeView).toBe('world');
  expect(openFile).not.toHaveBeenCalled();
});
