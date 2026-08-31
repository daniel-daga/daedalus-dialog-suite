import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * User-created VOB folders (VOB folders slice) — the "Add to Folder" context
 * menu flow and the Folders tab, through the real `WorldSurface` the same way
 * `WorldSurface.contextMenu.test.tsx` exercises the rest of that menu. Only
 * the viewport is stubbed.
 */

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((_props: unknown, ref: React.Ref<{
      raycastDown: () => null; frameVob: () => void; framePoint: () => void;
    }>) => {
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: () => null, frameVob: () => undefined, framePoint: () => undefined,
      }));
      return <div data-testid="world-viewport-stub" />;
    }),
  };
});

const api = makeWorldEditorApi();

async function openWorld() {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  await screen.findByTestId('world-viewport-stub');
  return summary;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  api.getVobProps.mockResolvedValue({ class: 'zCVob', presetName: '', visualCamAlign: 0, bias: 0 } as never);
  api.getVobFolders.mockResolvedValue({ folders: [] } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('VOB folders', () => {
  it('reads the sidecar for the opened world on open', async () => {
    await openWorld();
    expect(api.getVobFolders).toHaveBeenCalledWith('C:/Gothic/NewWorld.zen');
  });

  it('creates a folder from the Folders tab and saves the sidecar', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-panel-folders'));

    fireEvent.change(screen.getByTestId('world-folder-new-name'), { target: { value: 'Quest NPCs' } });
    fireEvent.click(screen.getByTestId('world-folder-create'));

    await waitFor(() => expect(screen.getByText('Quest NPCs')).toBeInTheDocument());
    expect(api.saveVobFolders).toHaveBeenCalledWith(
      'C:/Gothic/NewWorld.zen',
      { folders: [expect.objectContaining({ name: 'Quest NPCs', vobPaths: [] })] },
    );
  });

  it('adds the selection to an existing folder from the VOB context menu', async () => {
    await openWorld();
    // Seed one folder the same way the Folders tab would have.
    fireEvent.click(screen.getByTestId('world-panel-folders'));
    fireEvent.change(screen.getByTestId('world-folder-new-name'), { target: { value: 'Quest NPCs' } });
    fireEvent.click(screen.getByTestId('world-folder-create'));
    await waitFor(() => expect(api.saveVobFolders).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('world-panel-scene'));

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    fireEvent.click(await screen.findByTestId('world-context-add-to-folder'));
    const item = await screen.findByTestId(/^world-context-folder-[0-9a-f-]{36}$/);
    fireEvent.click(item);

    await waitFor(() => expect(api.saveVobFolders).toHaveBeenCalledTimes(2));
    const [, savedFolders] = api.saveVobFolders.mock.calls[1];
    expect((savedFolders as { folders: Array<{ vobPaths: string[] }> }).folders[0].vobPaths).toEqual(['1']);
  });

  it('creates a folder with the selection directly from "New folder…" in the submenu', async () => {
    await openWorld();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    fireEvent.click(await screen.findByTestId('world-context-add-to-folder'));
    fireEvent.click(await screen.findByTestId('world-context-folder-new'));
    fireEvent.change(screen.getByTestId('world-context-folder-new-name'), { target: { value: 'From menu' } });
    fireEvent.keyDown(screen.getByTestId('world-context-folder-new-name'), { key: 'Enter' });

    await waitFor(() => expect(api.saveVobFolders).toHaveBeenCalledTimes(1));
    const [, savedFolders] = api.saveVobFolders.mock.calls[0];
    expect(savedFolders).toEqual({ folders: [expect.objectContaining({ name: 'From menu', vobPaths: ['1'] })] });
  });

  it('disables "Add to Folder" with nothing selected', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(null); });

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    // Right-clicking a row selects it first (existing behavior), so clear the
    // selection the menu would otherwise see and reopen over empty space is
    // not available here — instead this asserts the item reflects an actual
    // empty selection via the store directly.
    await act(async () => { useWorldStore.getState().selectVob(null); });
    expect(screen.getByTestId('world-context-add-to-folder')).toHaveAttribute('aria-disabled', 'true');
  });

  it('removing a member from the Folders tab persists the change', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-panel-folders'));
    fireEvent.change(screen.getByTestId('world-folder-new-name'), { target: { value: 'A' } });
    fireEvent.click(screen.getByTestId('world-folder-create'));
    await waitFor(() => expect(api.saveVobFolders).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('world-panel-scene'));
    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    fireEvent.click(await screen.findByTestId('world-context-add-to-folder'));
    const folderItem = await screen.findByTestId(/^world-context-folder-[0-9a-f-]{36}$/);
    fireEvent.click(folderItem);
    await waitFor(() => expect(api.saveVobFolders).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId('world-panel-folders'));
    const folderId = screen.getByText('A').closest('[data-testid^="world-folder-"]')
      ?.getAttribute('data-testid')?.replace('world-folder-', '');
    fireEvent.click(screen.getByTestId(`world-folder-toggle-${folderId}`));
    fireEvent.click(screen.getByTestId(`world-folder-member-remove-${folderId}-1`));

    await waitFor(() => expect(api.saveVobFolders).toHaveBeenCalledTimes(3));
    const [, savedFolders] = api.saveVobFolders.mock.calls[2];
    expect((savedFolders as { folders: Array<{ vobPaths: string[] }> }).folders[0].vobPaths).toEqual([]);
  });
});
