/**
 * §3 P1: App must not subscribe to the whole `openFiles` Map.
 *
 * Every edit flush produces a new Map identity in the immer fileStore, so a
 * whole-Map subscription re-renders App (and the entire tree under it) on every
 * keystroke flush — even when the changed entry belongs to an INACTIVE file.
 *
 * These probes render the real App against the real fileStore (heavy children
 * and the theme provider are stubbed) and count commits with React.Profiler,
 * mirroring tests/IngestedFilesDialog.rerender.test.tsx:
 *   - a change to an inactive file's entry (new Map identity, active entry and
 *     conflict set untouched) must NOT re-render App or MainLayout;
 *   - a change to the ACTIVE file's entry still propagates (save button state);
 *   - a background conflict on an inactive file still surfaces the app-bar chip
 *     and clicking it activates that file.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../src/renderer/App';
import { useFileStore, type FileState } from '../src/renderer/store/fileStore';
import { useProjectStore } from '../src/renderer/store/projectStore';

// Cross-store sync would forward model changes into projectStore (whose
// `parsedFiles.size` App selects), which is not what these probes measure.
jest.mock('../src/renderer/store/storeSync', () => ({
  initStoreSync: jest.fn(),
}));

// Count MainLayout renders through a lightweight stub — the probe for "the
// entire tree under App re-renders".
let mockMainLayoutRenders = 0;
jest.mock('../src/renderer/components/MainLayout', () => ({
  __esModule: true,
  default: () => {
    mockMainLayoutRenders += 1;
    return <div data-testid="main-layout" />;
  },
}));

jest.mock('../src/renderer/themeContext', () => ({
  useThemeMode: () => ({ mode: 'dark', setMode: jest.fn() }),
}));

const emptyModel = {
  dialogs: {},
  functions: {},
  hasErrors: false,
  errors: [],
};

const makeFileState = (filePath: string): FileState => ({
  filePath,
  semanticModel: { ...emptyModel } as never,
  isDirty: false,
  lastSaved: new Date(),
});

const ACTIVE = '/proj/DIA_Active.d';
const INACTIVE = '/proj/DIA_Inactive.d';
const OTHER = '/proj/DIA_Other.d';

describe('App fileStore subscription granularity', () => {
  beforeEach(() => {
    mockMainLayoutRenders = 0;
    useFileStore.setState({
      openFiles: new Map([
        [ACTIVE, makeFileState(ACTIVE)],
        [INACTIVE, makeFileState(INACTIVE)],
        [OTHER, makeFileState(OTHER)],
      ]),
      activeFile: ACTIVE,
      // Keep the auto-save scheduler quiet — these probes measure subscriptions.
      autoSaveEnabled: false,
    } as never);
    useProjectStore.setState({
      projectPath: null,
      projectName: null,
      isIngesting: false,
      allDialogFiles: [],
      parsedFiles: new Map(),
      metadataFailures: [],
      isIngestedFilesOpen: false,
    } as never);

    (window as any).editorAPI = {
      ...((window as any).editorAPI || {}),
      // Never-resolving: keeps the async mount effects (recent projects, app
      // version) from committing between the mount snapshot and the probes.
      getRecentProjects: jest.fn().mockReturnValue(new Promise(() => {})),
      getAppVersion: jest.fn().mockReturnValue(new Promise(() => {})),
    };
  });

  const renderApp = () => {
    let commits = 0;
    render(
      <React.Profiler id="app" onRender={() => { commits += 1; }}>
        <App />
      </React.Profiler>
    );
    return { getCommits: () => commits };
  };

  test('a change to an inactive file does not re-render App or MainLayout', () => {
    const { getCommits } = renderApp();
    const afterMount = getCommits();
    const layoutAfterMount = mockMainLayoutRenders;
    const mapBefore = useFileStore.getState().openFiles;
    const activeStateBefore = mapBefore.get(ACTIVE);

    act(() => {
      useFileStore.setState((s) => {
        s.openFiles.get(INACTIVE)!.isDirty = true;
      });
    });

    // Sanity: the scenario is real — the Map identity changed, the active
    // file's entry did not (immer structural sharing).
    expect(useFileStore.getState().openFiles).not.toBe(mapBefore);
    expect(useFileStore.getState().openFiles.get(ACTIVE)).toBe(activeStateBefore);

    expect(getCommits()).toBe(afterMount);
    expect(mockMainLayoutRenders).toBe(layoutAfterMount);
  });

  test('a change to the active file still propagates to the save button', () => {
    const { getCommits } = renderApp();
    const afterMount = getCommits();
    expect(screen.getByTestId('appbar-save-button')).toBeDisabled();

    act(() => {
      useFileStore.setState((s) => {
        s.openFiles.get(ACTIVE)!.isDirty = true;
      });
    });

    expect(getCommits()).toBeGreaterThan(afterMount);
    expect(screen.getByTestId('appbar-save-button')).toBeEnabled();
  });

  test('a conflict on an inactive file surfaces the chip; clicking activates the file', async () => {
    renderApp();
    expect(screen.queryByTestId('background-conflict-chip')).not.toBeInTheDocument();

    act(() => {
      useFileStore.getState().markExternalConflict(INACTIVE);
    });

    const chip = screen.getByTestId('background-conflict-chip');
    expect(chip).toHaveTextContent('Conflicts: 1');

    fireEvent.click(chip);
    expect(useFileStore.getState().activeFile).toBe(INACTIVE);

    // Settle the conflict dialog's async diff-loading effect.
    await act(async () => {});
  });

  test('with a background conflict showing, an unrelated inactive change still does not re-render', async () => {
    const { getCommits } = renderApp();

    act(() => {
      useFileStore.getState().markExternalConflict(INACTIVE);
    });
    expect(screen.getByTestId('background-conflict-chip')).toHaveTextContent('Conflicts: 1');
    await act(async () => {});
    const afterConflict = getCommits();

    act(() => {
      useFileStore.setState((s) => {
        s.openFiles.get(OTHER)!.isDirty = true;
      });
    });

    // The conflict set (by path) is unchanged, so the shallow-compared selector
    // must keep App quiet even though the Map identity changed again.
    expect(getCommits()).toBe(afterConflict);
    expect(screen.getByTestId('background-conflict-chip')).toHaveTextContent('Conflicts: 1');
  });
});
