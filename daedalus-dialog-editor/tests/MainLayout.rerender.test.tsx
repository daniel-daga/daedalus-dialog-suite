import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MainLayout from '../src/renderer/components/MainLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useFileStore, type FileState } from '../src/renderer/store/fileStore';

// MainLayout renders ThreeColumnLayout (and, on other views, lazy QuestEditor /
// VariableManager); stub the heavy always-mounted children so this probe
// measures MainLayout's own commit count, not its subtree. The ThreeColumnLayout
// stub counts renders so the memo tests can observe MainLayout re-rendering.
let mockTclRenders = 0;
jest.mock('../src/renderer/components/ThreeColumnLayout', () => ({
  __esModule: true,
  default: () => {
    mockTclRenders += 1;
    return null;
  },
}));

const emptyModel = {
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, hasErrors: false, errors: []
};

/**
 * §2.2 selector hygiene: MainLayout was narrowed from whole-store destructures
 * (`useProjectStore()`) to per-field selectors (`projectPath`,
 * `mergedSemanticModel`, `loadQuestData`). Flipping an unrelated project field
 * (`isIngesting`) must therefore no longer re-render it; a selected field
 * (`projectPath`) still does. Fails against the pre-fix whole-store subscription.
 */
describe('MainLayout re-render granularity', () => {
  beforeEach(() => {
    useUISelectionStore.setState({ activeView: 'dialog' } as never);
    useProjectStore.setState({
      projectPath: '/proj',
      mergedSemanticModel: { ...emptyModel },
      isIngesting: false,
      isLoading: false
    } as never);
  });

  it('does not re-render when an unrelated project field (isIngesting) flips', () => {
    let commits = 0;
    render(
      <React.Profiler id="main" onRender={() => { commits += 1; }}>
        <MainLayout filePath={null} />
      </React.Profiler>
    );
    const afterMount = commits;

    act(() => { useProjectStore.setState({ isIngesting: true } as never); });
    expect(commits).toBe(afterMount);

    // A field MainLayout does select (projectPath) still re-renders it.
    act(() => { useProjectStore.setState({ projectPath: '/other' } as never); });
    expect(commits).toBeGreaterThan(afterMount);
  });

  it('does not re-render when the merged model identity churns in dialog view', () => {
    // §3b: the dialog view never consumes the merged model (it is only threaded
    // to the quest/variable panels), so a merge that hands out a fresh top-level
    // identity must not reach MainLayout while the dialog view is active.
    let commits = 0;
    render(
      <React.Profiler id="main-dialog" onRender={() => { commits += 1; }}>
        <MainLayout filePath={null} />
      </React.Profiler>
    );
    const afterMount = commits;

    act(() => { useProjectStore.setState({ mergedSemanticModel: { ...emptyModel } } as never); });
    expect(commits).toBe(afterMount);
  });
});

/**
 * §3 P1: MainLayout is memo-wrapped and its fileStore subscription is per-file,
 * so neither a parent re-render with the same `filePath` prop nor an edit flush
 * on a DIFFERENT open file may re-render it (each edit flush gives `openFiles`
 * a fresh Map identity in the immer store).
 */
describe('MainLayout memo + per-file fileStore subscription', () => {
  const makeFileState = (filePath: string): FileState => ({
    filePath,
    semanticModel: { ...emptyModel } as never,
    isDirty: false,
    lastSaved: new Date(),
  });

  beforeEach(() => {
    mockTclRenders = 0;
    useUISelectionStore.setState({ activeView: 'dialog' } as never);
    useProjectStore.setState({
      projectPath: '/proj',
      mergedSemanticModel: { ...emptyModel },
      isIngesting: false,
      isLoading: false
    } as never);
    useFileStore.setState({
      openFiles: new Map([
        ['/proj/a.d', makeFileState('/proj/a.d')],
        ['/proj/b.d', makeFileState('/proj/b.d')],
      ]),
      activeFile: '/proj/a.d',
    } as never);
  });

  it('does not re-render when the parent re-renders with the same filePath prop', () => {
    const Parent: React.FC = () => {
      const [, bump] = React.useState(0);
      return (
        <>
          <button data-testid="bump" onClick={() => bump((n) => n + 1)} />
          <MainLayout filePath="/proj/a.d" />
        </>
      );
    };

    render(<Parent />);
    const beforeBump = mockTclRenders;

    fireEvent.click(screen.getByTestId('bump'));
    expect(mockTclRenders).toBe(beforeBump);
  });

  it('does not re-render when a different open file changes, but does for its own file', () => {
    render(<MainLayout filePath="/proj/a.d" />);
    const afterMount = mockTclRenders;

    // Edit flush on ANOTHER file: new Map identity, /proj/a.d entry untouched.
    act(() => {
      useFileStore.setState((s) => {
        s.openFiles.get('/proj/b.d')!.isDirty = true;
      });
    });
    expect(mockTclRenders).toBe(afterMount);

    // A change to the file MainLayout displays still reaches it.
    act(() => {
      useFileStore.setState((s) => {
        s.openFiles.get('/proj/a.d')!.isDirty = true;
      });
    });
    expect(mockTclRenders).toBeGreaterThan(afterMount);
  });
});
