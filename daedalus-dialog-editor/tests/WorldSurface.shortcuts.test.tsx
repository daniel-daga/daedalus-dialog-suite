import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The window keydown handler's shortcuts that open an existing confirm rather
 * than commit directly (level-editor-ui-improvements.md slices 1-3): Delete,
 * Escape, and arrow-key nudge. The delete and Escape paths are gated by the
 * same confirm dialogs `WorldSurface.editing.test.tsx` already exercises —
 * these tests check only that the shortcut *reaches* them.
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
  // A fresh vobIndex per call: a committed op mutates it in place, and a
  // shared object would carry one test's move into the next.
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
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('the Delete key', () => {
  it('opens the VOB delete confirm for a single selected VOB', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.getByTestId('world-delete-warning')).toBeVisible();
    fireEvent.click(screen.getByTestId('world-delete-confirm'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as [Array<{ op: string; vob: number }>];
    expect(ops).toMatchObject([{ op: 'DeleteVob', vob: 1 }]);
  });

  it('does nothing with a multi-VOB selection', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVobs([0, 1]); });

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.queryByTestId('world-delete-warning')).not.toBeInTheDocument();
  });

  it('opens the waypoint delete confirm for a selected waypoint', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectWaypoint(1); });

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.getByTestId('world-waypoint-delete-warning')).toBeVisible();
  });

  it('does nothing while a text field has focus', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();

    fireEvent.keyDown(field, { key: 'Delete' });

    expect(screen.queryByTestId('world-delete-warning')).not.toBeInTheDocument();
    field.remove();
  });

  it('does nothing when the surface is hidden', async () => {
    const { rerender } = render(<WorldSurface />);
    api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
    api.openWorld.mockResolvedValueOnce(SUMMARY as never);
    api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: SUMMARY.bbox } as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
    fireEvent.click(screen.getByTestId('world-open'));
    await screen.findByTestId('world-viewport-stub');
    await act(async () => { useWorldStore.getState().selectVob(1); });

    rerender(<WorldSurface hidden />);
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.queryByTestId('world-delete-warning')).not.toBeInTheDocument();
  });
});

describe('the Escape key', () => {
  it('clears a VOB selection', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useWorldStore.getState().selection).toEqual([]);
  });

  it('clears a selected waypoint', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectWaypoint(1); });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useWorldStore.getState().selectedWaypoint).toBeNull();
  });

  it('does not clear the selection while the delete confirm is open, so the dialog is not fighting the shortcut over it', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByTestId('world-delete-warning')).toBeVisible();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useWorldStore.getState().selection).toEqual([1]);
  });

  it('does nothing while a text field has focus', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();

    fireEvent.keyDown(field, { key: 'Escape' });

    expect(useWorldStore.getState().selection).toEqual([1]);
    field.remove();
  });
});

describe('arrow-key nudge', () => {
  /** The one control, which means whichever step the gizmo mode is about —
   *  ported from `WorldSurface.editing.test.tsx`'s `chooseStep`. */
  const chooseStep = async (label: string) => {
    fireEvent.mouseDown(within(screen.getByTestId('world-snap')).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: label }));
  };

  const nudgeOp = (to: [number, number, number]) => ({
    op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to,
  });

  it('moves the selection +X by the default 10 cm step on ArrowRight', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.applyWorldOps.mock.calls[0][0]).toMatchObject([nudgeOp([20, 20, 30])]);
  });

  it.each([
    ['ArrowLeft', [0, 20, 30]],
    ['ArrowUp', [10, 20, 20]],
    ['ArrowDown', [10, 20, 40]],
    ['PageUp', [10, 30, 30]],
    ['PageDown', [10, 10, 30]],
  ] as Array<[string, [number, number, number]]>)('moves the selection on %s', async (key, to) => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });

    fireEvent.keyDown(window, { key });

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.applyWorldOps.mock.calls[0][0]).toMatchObject([nudgeOp(to)]);
  });

  it('nudges by the chosen snap step instead of the 10 cm default', async () => {
    await openWorld();
    await chooseStep('1 m');
    await act(async () => { useWorldStore.getState().selectVob(1); });

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.applyWorldOps.mock.calls[0][0]).toMatchObject([nudgeOp([110, 20, 30])]);
  });

  it('multiplies the step by 10 while Shift is held', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });

    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.applyWorldOps.mock.calls[0][0]).toMatchObject([nudgeOp([110, 20, 30])]);
  });

  it('does nothing with an empty selection', async () => {
    await openWorld();

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('does nothing while a text field has focus', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();

    fireEvent.keyDown(field, { key: 'ArrowRight' });

    expect(api.applyWorldOps).not.toHaveBeenCalled();
    field.remove();
  });

  it('does nothing while focus is inside a tree, reserving arrows for its own navigation', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    const tree = document.createElement('div');
    tree.setAttribute('role', 'tree');
    const row = document.createElement('div');
    row.tabIndex = 0;
    tree.appendChild(row);
    document.body.appendChild(tree);
    row.focus();

    fireEvent.keyDown(row, { key: 'ArrowRight' });

    expect(api.applyWorldOps).not.toHaveBeenCalled();
    tree.remove();
  });
});
