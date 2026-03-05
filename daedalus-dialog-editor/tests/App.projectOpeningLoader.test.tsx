import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../src/renderer/App';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mockSetMode = jest.fn();

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
  isIngestedFilesOpen: false,
  setIngestedFilesOpen: jest.fn()
};

jest.mock('../src/renderer/store/editorStore', () => ({
  useEditorStore: () => mockEditorState
}));

jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: () => mockProjectState
}));

jest.mock('../src/renderer/hooks/useAutoSave', () => ({
  useAutoSave: () => ({
    isAutoSaving: false,
    lastAutoSaveTime: null
  })
}));

jest.mock('../src/renderer/themeContext', () => ({
  useThemeMode: () => ({
    mode: 'dark',
    setMode: mockSetMode
  })
}));

jest.mock('../src/renderer/components/MainLayout', () => () => (
  <div data-testid="main-layout">MainLayout</div>
));

jest.mock('../src/renderer/components/IngestedFilesDialog', () => ({
  IngestedFilesDialog: () => null
}));

describe('App project opening loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorState.activeFile = null;
    mockEditorState.openFiles = new Map();
    mockProjectState.openProject = jest.fn().mockResolvedValue(undefined);
    mockProjectState.projectPath = null;
    mockProjectState.projectName = null;
    mockProjectState.isIngesting = false;
    mockProjectState.allDialogFiles = [];
    mockProjectState.parsedFiles = new Map();

    (window as any).editorAPI = {
      ...((window as any).editorAPI || {}),
      openProjectFolderDialog: jest.fn().mockResolvedValue('C:/project'),
      openFileDialog: jest.fn().mockResolvedValue(null),
      getRecentProjects: jest.fn().mockReturnValue(new Promise(() => {})),
    };
  });

  test('shows blocking loader during project opening indexing phase', async () => {
    const deferred = createDeferred<void>();
    mockProjectState.openProject = jest.fn().mockReturnValue(deferred.promise);

    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Project' })[0]);

    await waitFor(() => {
      expect(screen.getByTestId('project-opening-overlay')).toBeInTheDocument();
    });
    expect(screen.getByText('Opening project...')).toBeInTheDocument();

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });
  });

  test('shows determinate ingestion progress from parsedFiles and allDialogFiles', () => {
    mockProjectState.projectPath = 'C:/project';
    mockProjectState.isIngesting = true;
    mockProjectState.allDialogFiles = ['a.d', 'b.d', 'c.d', 'd.d'];
    mockProjectState.parsedFiles = new Map([
      ['a.d', {}],
      ['b.d', {}]
    ]);

    render(<App />);

    expect(screen.getByTestId('project-opening-overlay')).toBeInTheDocument();
    expect(screen.getByText('2 / 4 files')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  test('hides loader when ingestion completes', () => {
    mockProjectState.projectPath = 'C:/project';
    mockProjectState.isIngesting = true;
    mockProjectState.allDialogFiles = ['a.d', 'b.d'];
    mockProjectState.parsedFiles = new Map([['a.d', {}]]);

    const { rerender } = render(<App />);
    expect(screen.getByTestId('project-opening-overlay')).toBeInTheDocument();

    mockProjectState.isIngesting = false;
    mockProjectState.parsedFiles = new Map([
      ['a.d', {}],
      ['b.d', {}]
    ]);
    rerender(<App />);

    expect(screen.getByTestId('project-opening-overlay')).not.toBeVisible();
  });

  test('keeps MainLayout mounted behind overlay during project reload', async () => {
    const deferred = createDeferred<void>();
    mockProjectState.projectPath = 'C:/project';
    mockProjectState.openProject = jest.fn().mockReturnValue(deferred.promise);

    render(<App />);
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));

    await waitFor(() => {
      expect(screen.getByTestId('project-opening-overlay')).toBeInTheDocument();
    });
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });
  });
});


