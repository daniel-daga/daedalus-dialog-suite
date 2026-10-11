/**
 * The app-bar undo/redo **buttons** are the button-shaped hole beside
 * `MainLayout.worldUndo.test.tsx`'s already-guarded Ctrl+Z: they call
 * `undo(activeFile)`/`redo(activeFile)` directly, unconditionally, so left
 * alone they would still drive the *dialog* history while the World view is
 * on screen — silently undoing an edit in a file the user cannot see, in a
 * view whose own history lives in the main process
 * (level-editor.md §17).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../src/renderer/App';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

jest.mock('../src/renderer/store/storeSync', () => ({
  initStoreSync: jest.fn(),
}));
jest.mock('../src/renderer/components/MainLayout', () => ({
  __esModule: true,
  default: () => <div data-testid="main-layout" />,
}));
jest.mock('../src/renderer/themeContext', () => ({
  useThemeMode: () => ({ mode: 'dark', setMode: jest.fn() }),
}));

const ACTIVE = '/proj/dialogs.d';

describe('the app-bar undo/redo buttons', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectPath: '/proj' } as never);
    useEditorStore.setState({ activeFile: ACTIVE } as never);
    // A non-empty past/future, so the ordinary (non-World) case is enabled —
    // the guard under test is `worldViewActive`, not `canUndo`/`canRedo`.
    useHistoryStore.setState({
      editHistory: new Map([[ACTIVE, { past: [{}], future: [{}] }]]),
    } as never);

    (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI = {
      ...(window as unknown as { editorAPI?: Record<string, unknown> }).editorAPI,
      // Never-resolving: keeps the async mount effects (recent projects, app
      // version) from committing between mount and the assertions below.
      getRecentProjects: jest.fn().mockReturnValue(new Promise(() => {})),
      getAppVersion: jest.fn().mockReturnValue(new Promise(() => {})),
    };
  });

  it('are enabled in the dialog view', () => {
    useUISelectionStore.setState({ activeView: 'dialog' } as never);
    render(<App />);

    expect(screen.getByTestId('appbar-undo-button')).toBeEnabled();
    expect(screen.getByTestId('appbar-redo-button')).toBeEnabled();
  });

  it('are disabled in the World view, even with dialog history to undo', () => {
    useUISelectionStore.setState({ activeView: 'world' } as never);
    render(<App />);

    expect(screen.getByTestId('appbar-undo-button')).toBeDisabled();
    expect(screen.getByTestId('appbar-redo-button')).toBeDisabled();
  });
});
