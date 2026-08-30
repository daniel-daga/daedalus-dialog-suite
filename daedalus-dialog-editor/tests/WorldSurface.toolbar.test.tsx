import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createVobReader } from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { MOVE, SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The World bar's undo/redo buttons (level-editor-ui-improvements.md slice
 * 4): disabled/enabled off `getWorldHistoryDepth`, and a click drives the
 * same `undoWorldEdit`/`applied` path Ctrl+Z already does.
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
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('the World bar undo/redo buttons', () => {
  it('are disabled once the world opens with an empty history', async () => {
    await openWorld();

    await waitFor(() => expect(api.getWorldHistoryDepth).toHaveBeenCalled());
    expect(screen.getByTestId('world-undo')).toBeDisabled();
    expect(screen.getByTestId('world-redo')).toBeDisabled();
  });

  it('enables undo once a batch is committed', async () => {
    const summary = await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    api.getWorldHistoryDepth.mockResolvedValueOnce({ undo: 1, redo: 0 } as never);

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    await waitFor(() => expect(screen.getByTestId('world-undo')).toBeEnabled());
    expect(screen.getByTestId('world-redo')).toBeDisabled();
    // The nudge itself still landed — this readout doesn't stand in its way.
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([20, 20, 30]);
  });

  it('drives undoWorldEdit and applies what it answers, same as Ctrl+Z', async () => {
    // A real commit first — a disabled button takes no click, so the test
    // earns the enabled undo the same way a user would rather than faking it.
    const summary = await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    api.getWorldHistoryDepth.mockResolvedValueOnce({ undo: 1, redo: 0 } as never);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('world-undo')).toBeEnabled());

    api.undoWorldEdit.mockResolvedValueOnce([MOVE] as never);
    api.getWorldHistoryDepth.mockResolvedValueOnce({ undo: 0, redo: 1 } as never);

    fireEvent.click(screen.getByTestId('world-undo'));

    await waitFor(() => expect(api.undoWorldEdit).toHaveBeenCalled());
    await waitFor(() => expect(createVobReader(summary.vobIndex).position(1)).toEqual([11, 22, 33]));
    await waitFor(() => expect(screen.getByTestId('world-redo')).toBeEnabled());
  });

  it('drives redoWorldEdit on a click', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    api.getWorldHistoryDepth.mockResolvedValueOnce({ undo: 1, redo: 0 } as never);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('world-undo')).toBeEnabled());

    api.undoWorldEdit.mockResolvedValueOnce([MOVE] as never);
    api.getWorldHistoryDepth.mockResolvedValueOnce({ undo: 0, redo: 1 } as never);
    fireEvent.click(screen.getByTestId('world-undo'));
    await waitFor(() => expect(screen.getByTestId('world-redo')).toBeEnabled());

    api.redoWorldEdit.mockResolvedValueOnce([MOVE] as never);

    fireEvent.click(screen.getByTestId('world-redo'));

    await waitFor(() => expect(api.redoWorldEdit).toHaveBeenCalled());
  });
});
