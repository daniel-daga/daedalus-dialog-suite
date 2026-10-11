import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../src/renderer/App';

const mockEditorState = {
  openFile: jest.fn(),
  activeFile: null as string | null,
  openFiles: new Map<string, { isDirty: boolean }>(),
  resetEditorSession: jest.fn()
};

const mockProjectState = {
  openProject: jest.fn<Promise<void>, [string]>(),
  projectPath: null as string | null,
  projectName: null as string | null,
  isIngesting: false,
  allDialogFiles: [] as string[],
  parsedFiles: new Map<string, unknown>(),
  metadataFailures: [] as Array<{ filePath: string; error: string }>,
  isIngestedFilesOpen: false,
  setIngestedFilesOpen: jest.fn()
};

jest.mock('../src/renderer/store/storeSync', () => ({
  initStoreSync: jest.fn(() => jest.fn())
}));

jest.mock('../src/renderer/store/editorStore', () => {
  const useEditorStore = () => mockEditorState;
  useEditorStore.getState = () => mockEditorState;
  return { useEditorStore };
});

jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: (selector?: (state: any) => any) => selector ? selector(mockProjectState) : mockProjectState
}));

jest.mock('../src/renderer/hooks/useAutoSave', () => ({
  useAutoSave: () => ({ isAutoSaving: false, lastAutoSaveTime: null })
}));

jest.mock('../src/renderer/themeContext', () => ({
  useThemeMode: () => ({ mode: 'dark', setMode: jest.fn() })
}));

jest.mock('../src/renderer/components/MainLayout', () => () => (
  <div data-testid="main-layout">MainLayout</div>
));

jest.mock('../src/renderer/components/IngestedFilesDialog', () => ({
  IngestedFilesDialog: () => null
}));

// Chrome that sits *outside* the MainLayout boundary. Before the outer
// boundary existed a throw here took the whole window down with a blank page
// (production review §2, error-boundary gap).
jest.mock('../src/renderer/components/ExternalChangeConflictDialog', () => () => {
  throw new Error('conflict dialog exploded');
});

describe('App error boundary coverage', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    (window as any).editorAPI = {
      ...((window as any).editorAPI || {}),
      openProjectFolderDialog: jest.fn().mockResolvedValue(null),
      openFileDialog: jest.fn().mockResolvedValue(null),
      getRecentProjects: jest.fn().mockReturnValue(new Promise(() => {})),
      logRendererError: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('a crash in the app chrome shows the fallback instead of a blank window', () => {
    render(<App />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect((window as any).editorAPI.logRendererError).toHaveBeenCalled();
  });
});
