/**
 * What a Problems click does when the symbol is in a file no semantic model
 * has been built for (world-editor-review-2026-08-29, first pass 7).
 *
 * The waypoint rule is the first whose sites come from the project index's
 * whole-project pass, so its `functionName` is routinely a routine in a file
 * the user never opened — `navigateToSymbol` searches the merged model and
 * finds nothing. Every problem carries the file that owns it, and that is what
 * the click falls back to.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import ProblemsPanel from '../src/renderer/components/Problems/ProblemsPanel';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import type { Problem } from '../src/renderer/problems/domain/types';

const navigateToDialog = jest.fn();
const navigateToSymbol = jest.fn();

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({ navigateToDialog, navigateToSymbol })
}));

const problem = (overrides: Partial<Problem> = {}): Problem => ({
  id: 'waypoint-not-in-world:Rtn.d:Rtn_Start_Diego:OW_PATH_42',
  rule: 'waypoint-not-in-world',
  severity: 'warning',
  message: 'Waypoint OW_PATH_42 is not in the open world',
  locus: { kind: 'script', filePath: 'Story/Routines/Rtn.d', functionName: 'Rtn_Start_Diego' },
  ...overrides
});

const openFile = jest.fn().mockResolvedValue(undefined);

describe('a Problems click that navigation cannot resolve', () => {
  beforeEach(() => {
    navigateToDialog.mockReset();
    navigateToSymbol.mockReset();
    openFile.mockClear();
    useEditorStore.setState({ openFile });
    useProjectStore.setState({ parseGeneration: 0, isIngesting: false });
    act(() => {
      useUISelectionStore.getState().resetUISelection();
      // The click happens from the Problems view: it is the whole main area,
      // so a fallback that does not switch the view shows the user nothing.
      useUISelectionStore.getState().setActiveView('problems');
      useProblemsStore.setState({ problems: [problem()], hasScanned: true, requestScan: jest.fn() });
    });
  });

  it('opens the file the problem names when the symbol is not in the merged model', async () => {
    navigateToSymbol.mockResolvedValue(false);
    render(<ProblemsPanel />);

    await userEvent.click(screen.getByText(/OW_PATH_42/));

    expect(navigateToSymbol).toHaveBeenCalledWith('Rtn_Start_Diego');
    expect(openFile).toHaveBeenCalledWith('Story/Routines/Rtn.d');
    expect(useUISelectionStore.getState().selectedFunctionName).toBe('Rtn_Start_Diego');
    expect(useUISelectionStore.getState().activeView).toBe('dialog');
  });

  it('leaves a resolved navigation alone — no second jump', async () => {
    navigateToSymbol.mockResolvedValue(true);
    render(<ProblemsPanel />);

    await userEvent.click(screen.getByText(/OW_PATH_42/));

    expect(openFile).not.toHaveBeenCalled();
  });
});
