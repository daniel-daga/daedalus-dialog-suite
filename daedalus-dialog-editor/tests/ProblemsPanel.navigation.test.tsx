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
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import ProblemsPanel from '../src/renderer/components/Problems/ProblemsPanel';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useWorldStore } from '../src/renderer/store/worldStore';
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

/**
 * A world finding has no file, no dialog and no function — the panel's whole
 * script navigation model (§16.20 slice 2). What it has instead is an address
 * into the open world, and clicking it switches to the World surface and asks
 * it to jump there.
 */
describe('a Problems click on a world finding', () => {
  const worldProblem = (locus: Problem['locus']): Problem => problem({
    id: 'portal-material-malformed:1704',
    rule: 'waypoint-not-in-world',
    message: 'Portal material P:_ names no sector on either side',
    locus,
  });

  beforeEach(() => {
    act(() => {
      useWorldStore.getState().reset();
      useUISelectionStore.getState().setActiveView('problems');
    });
  });

  it('jumps the World surface to the waypoint and switches to it', async () => {
    act(() => {
      useWorldStore.setState({ status: 'ready' });
      useProblemsStore.setState({
        problems: [worldProblem({ kind: 'world', waypoint: 'WP_MIDDLE' })],
        hasScanned: true,
        requestScan: jest.fn(),
      });
    });
    render(<ProblemsPanel />);

    await userEvent.click(screen.getByText(/names no sector/));

    expect(useWorldStore.getState().focusRequest)
      .toEqual({ kind: 'waypoint', name: 'WP_MIDDLE' });
    expect(useUISelectionStore.getState().activeView).toBe('world');
    expect(openFile).not.toHaveBeenCalled();
  });

  it('jumps to a VOB the same way', async () => {
    act(() => {
      useWorldStore.setState({ status: 'ready' });
      useProblemsStore.setState({
        problems: [worldProblem({ kind: 'world', vob: 42 })],
        hasScanned: true,
        requestScan: jest.fn(),
      });
    });
    render(<ProblemsPanel />);

    await userEvent.click(screen.getByText(/names no sector/));

    expect(useWorldStore.getState().focusRequest).toEqual({ kind: 'vob', vob: 42 });
    expect(useUISelectionStore.getState().activeView).toBe('world');
  });

  it('asks for a second jump to the same place — the camera has moved since', async () => {
    act(() => {
      useWorldStore.setState({ status: 'ready' });
      useProblemsStore.setState({
        problems: [worldProblem({ kind: 'world', vob: 42 })],
        hasScanned: true,
        requestScan: jest.fn(),
      });
    });
    render(<ProblemsPanel />);

    await userEvent.click(screen.getByText(/names no sector/));
    const first = useWorldStore.getState().focusRequest;
    act(() => { useWorldStore.getState().focusHandled(); });

    await userEvent.click(screen.getByText(/names no sector/));

    expect(useWorldStore.getState().focusRequest).toEqual(first);
    expect(useWorldStore.getState().focusRequest).not.toBe(first);
  });

  it('is shown and not clickable while no world is open', async () => {
    // The editor holds one world at a time, and the finding may belong to
    // another — so the row stays, and it goes nowhere.
    act(() => {
      useProblemsStore.setState({
        problems: [worldProblem({ kind: 'world', waypoint: 'WP_MIDDLE' })],
        hasScanned: true,
        requestScan: jest.fn(),
      });
    });
    render(<ProblemsPanel />);

    expect(screen.getByText(/names no sector/)).toBeInTheDocument();
    expect(screen.getByTestId('problem-row-0')).toHaveAttribute('aria-disabled', 'true');

    // Past the pointer-events guard on purpose: what is asserted is that the
    // click leads nowhere, not that the DOM refused to deliver it.
    await userEvent
      .setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
      .click(screen.getByText(/names no sector/));

    expect(useWorldStore.getState().focusRequest).toBeNull();
    expect(useUISelectionStore.getState().activeView).toBe('problems');
  });

  it('leaves a locus it cannot address alone', async () => {
    // A polygon locus is slice 3's, and framing one needs the mesh: until then
    // it is listed and not clickable rather than silently doing nothing.
    act(() => {
      useWorldStore.setState({ status: 'ready' });
      useProblemsStore.setState({
        problems: [worldProblem({ kind: 'world', polygon: 1704 })],
        hasScanned: true,
        requestScan: jest.fn(),
      });
    });
    render(<ProblemsPanel />);

    expect(screen.getByTestId('problem-row-0')).toHaveAttribute('aria-disabled', 'true');

    await userEvent
      .setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
      .click(screen.getByText(/names no sector/));

    expect(useWorldStore.getState().focusRequest).toBeNull();
    expect(useUISelectionStore.getState().activeView).toBe('problems');
  });
});
