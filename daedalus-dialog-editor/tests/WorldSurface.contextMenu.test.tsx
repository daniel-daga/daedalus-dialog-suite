import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The right-click menu over a VOB (level-editor.md §17)
 * — the app's first context menu. Reached from the scene tree row, which is
 * real here (only the viewport is stubbed, as in every other World surface
 * suite): the menu itself, and the surface's wiring around it (select-first,
 * the existing delete confirm, the clipboard-driven Paste).
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
  // Open world lists the project's worlds (level-editor.md §16.31); these
  // suites want a named file, which is what Browse… still is.
  fireEvent.click(await screen.findByTestId('world-picker-browse'));
  await screen.findByTestId('world-viewport-stub');
  return summary;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  api.getVobProps.mockResolvedValue({ class: 'zCVob', presetName: '', visualCamAlign: 0, bias: 0 } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('the VOB context menu', () => {
  it('opens over a right-clicked row with every item', async () => {
    await openWorld();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });

    expect(await screen.findByTestId('world-context-menu')).toBeInTheDocument();
    for (const item of [
      'frame', 'duplicate', 'copy', 'paste', 'delete', 'drop', 'align', 'hide-class',
    ]) {
      expect(screen.getByTestId(`world-context-${item}`)).toBeInTheDocument();
    }
  });

  it('shows the shortcut a menu item has, and agrees with the tree on the verb', async () => {
    // §5.4 item 19 of `docs/plans/level-editor-review-2026-09-04.md`. Three
    // surfaces called the same command three things — "Frame" in the menu,
    // "Jump the camera to this VOB" on the tree's locator, and only the grid's
    // said which key does it — and the menu named no shortcut at all.
    await openWorld();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });

    await screen.findByTestId('world-context-menu');
    expect(screen.getByTestId('world-context-frame')).toHaveTextContent('Frame');
    expect(screen.getByTestId('world-context-frame')).toHaveTextContent('.');
    expect(screen.getByTestId('world-context-copy')).toHaveTextContent('Ctrl+C');
    expect(screen.getByTestId('world-context-paste')).toHaveTextContent('Ctrl+V');
    expect(screen.getByTestId('world-context-delete')).toHaveTextContent('Del');
    // Duplicate had the one blank slot in this list, because it was bound to
    // nothing (#253). Ctrl+D now, as every level editor binds it.
    expect(screen.getByTestId('world-context-duplicate')).toHaveTextContent('Ctrl+D');
  });

  it('selects the row first when it was outside the selection', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(0); });

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });

    expect(useWorldStore.getState().selection).toEqual([1]);
  });

  it('leaves a multi-selection standing when the row right-clicked is already in it', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVobs([0, 1]); });

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });

    expect(useWorldStore.getState().selection).toEqual([0, 1]);
  });

  // #293: select the twenty bushes, right-click the one that is to hold them.
  describe('Make children of this VOB', () => {
    async function openThree(parents: number[] = [-1, -1, -1]) {
      const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30], [40, 50, 60]], 'zCVob', parents) };
      api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
      api.openWorld.mockResolvedValueOnce(summary as never);
      api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
      api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);
      api.refreshWorldIndex.mockResolvedValue(summary as never);
      render(<WorldSurface />);
      fireEvent.click(screen.getByTestId('world-open'));
      fireEvent.click(await screen.findByTestId('world-picker-browse'));
      await screen.findByTestId('world-viewport-stub');
    }

    it('puts the rest of the selection under the right-clicked VOB, as one batch, and selects it', async () => {
      await openThree();
      await act(async () => { useWorldStore.getState().selectVobs([0, 1, 2]); });
      await act(async () => {
        fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
      });

      const item = await screen.findByTestId('world-context-make-children');
      expect(item).toHaveTextContent('Make the other 2 VOBs children of this one');
      await act(async () => { fireEvent.click(item); });

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
      expect(api.applyWorldOps).toHaveBeenCalledWith([
        // Vob 0 leaves the roots ahead of vob 1, which is root 0 by the time
        // vob 2 follows it in.
        { op: 'ReparentVob', vob: 0, from: { path: '0', parentPath: null, slot: 0 }, to: { path: '0/0', parentPath: '1', slot: 0 } },
        { op: 'ReparentVob', vob: 2, from: { path: '1', parentPath: null, slot: 1 }, to: { path: '0/1', parentPath: '0', slot: 1 } },
      ]);
      // The new parent, found by where it ended up: moving it drags them all.
      await waitFor(() => expect(useWorldStore.getState().selection).toEqual([0]));
    });

    it('is not offered for a lone VOB, nor under a VOB the rest of the selection already holds', async () => {
      await openThree([-1, 0, -1]);
      await act(async () => { useWorldStore.getState().selectVob(0); });
      await act(async () => {
        fireEvent.contextMenu(screen.getByTestId('world-vob-row-0'), { clientX: 50, clientY: 60 });
      });
      await screen.findByTestId('world-context-menu');
      expect(screen.queryByTestId('world-context-make-children')).not.toBeInTheDocument();
      fireEvent.keyDown(screen.getByTestId('world-context-menu'), { key: 'Escape' });

      // Vob 1 is vob 0's child: putting 0 under 1 would put it inside itself.
      fireEvent.click(screen.getByTestId('world-vob-toggle-0'));
      await act(async () => { useWorldStore.getState().selectVobs([0, 1]); });
      await act(async () => {
        fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
      });
      await screen.findByTestId('world-context-menu');
      expect(screen.queryByTestId('world-context-make-children')).not.toBeInTheDocument();
    });
  });

  it('opens the existing delete confirm from the Delete item, rather than deleting directly', async () => {
    await openWorld();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    fireEvent.click(await screen.findByTestId('world-context-delete'));

    expect(screen.getByTestId('world-delete-warning')).toBeVisible();
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('actually hides the right-clicked VOB\'s class, not just offering to', async () => {
    // The menu closes *before* its action runs (`run()` is onClose() then
    // action()), and `hideVobClass` reads `contextMenu.vob` — so this pins
    // that the handler still sees the VOB it was opened for rather than the
    // null the close just set. Observable through the toolbar's own Hide
    // control, which is the list this writes into.
    await openWorld();
    expect(screen.getByTestId('world-hidden-classes')).toHaveTextContent('Nothing');

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    fireEvent.click(await screen.findByTestId('world-context-hide-class'));

    // The fixture's VOBs are all zCVob, so hiding VOB 1's class is one entry.
    await waitFor(() => expect(screen.getByTestId('world-hidden-classes')).toHaveTextContent('1 classes'));
  });

  it('disables Paste with an empty clipboard, and enables it once something is copied', async () => {
    await openWorld();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    expect(await screen.findByTestId('world-context-paste')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByTestId('world-context-copy'));
    await waitFor(() => expect(screen.queryByTestId('world-context-menu')).not.toBeInTheDocument());

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('world-vob-row-1'), { clientX: 50, clientY: 60 });
    });
    expect(await screen.findByTestId('world-context-paste')).not.toHaveAttribute('aria-disabled', 'true');
  });
});
