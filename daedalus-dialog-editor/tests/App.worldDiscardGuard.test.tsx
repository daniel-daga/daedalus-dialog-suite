/**
 * #379: the project discard guard read only the script files, so a dirty
 * world with clean scripts let Close Project (and switch/reload) through with
 * no prompt — unmounting the editor while the world store stayed dirty and the
 * main process kept the world open.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../src/renderer/App';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useWorldStore } from '../src/renderer/store/worldStore';

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

const closeWorld = jest.fn().mockResolvedValue(undefined);
const openProjectFolderDialog = jest.fn();

const dirtyWorld = (): void => {
  useWorldStore.setState({
    status: 'ready',
    summary: { worldPath: '/proj/WORLD.ZEN' } as never,
    hasUnsavedEdits: true,
  });
};

describe('project transitions with a dirty world', () => {
  beforeEach(() => {
    closeWorld.mockClear();
    openProjectFolderDialog.mockReset();
    useWorldStore.getState().reset();
    useEditorStore.setState({ activeFile: null, openFiles: new Map() } as never);
    useProjectStore.setState({ projectPath: '/proj', projectName: 'proj' } as never);
    (window as unknown as { editorAPI: Record<string, unknown> }).editorAPI = {
      ...(window as unknown as { editorAPI?: Record<string, unknown> }).editorAPI,
      getRecentProjects: jest.fn().mockReturnValue(new Promise(() => {})),
      getAppVersion: jest.fn().mockReturnValue(new Promise(() => {})),
      onCloseRequested: jest.fn().mockReturnValue(() => {}),
      closeWorld,
      openProjectFolderDialog,
    };
  });

  it('Close Project asks first, and Cancel keeps the project and the world', () => {
    dirtyWorld();
    render(<App />);

    fireEvent.click(screen.getByTestId('close-project-button'));

    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toHaveTextContent('close the project');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(useProjectStore.getState().projectPath).toBe('/proj');
    expect(useWorldStore.getState().hasUnsavedEdits).toBe(true);
    expect(closeWorld).not.toHaveBeenCalled();
  });

  it('discarding closes the world in the main process and empties the world store', () => {
    dirtyWorld();
    render(<App />);

    fireEvent.click(screen.getByTestId('close-project-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));

    expect(useProjectStore.getState().projectPath).toBeNull();
    expect(screen.queryByTestId('main-layout')).not.toBeInTheDocument();
    expect(closeWorld).toHaveBeenCalledTimes(1);
    expect(useWorldStore.getState()).toMatchObject({ status: 'idle', summary: null, hasUnsavedEdits: false });
  });

  it('a clean open world is closed too, without a prompt', () => {
    useWorldStore.setState({ status: 'ready', summary: { worldPath: '/proj/WORLD.ZEN' } as never });
    render(<App />);

    fireEvent.click(screen.getByTestId('close-project-button'));

    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();
    expect(closeWorld).toHaveBeenCalledTimes(1);
    expect(useWorldStore.getState().summary).toBeNull();
  });

  it('switching projects asks first', async () => {
    dirtyWorld();
    openProjectFolderDialog.mockResolvedValue('/other');
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Project' }));
    });

    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toHaveTextContent('switch projects');
    expect(closeWorld).not.toHaveBeenCalled();
  });

  it('reloading the project asks first', () => {
    dirtyWorld();
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toHaveTextContent('reload the project');
  });
});
