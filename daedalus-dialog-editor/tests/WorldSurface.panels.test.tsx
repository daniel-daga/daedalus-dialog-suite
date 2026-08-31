import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The World surface's resizable side panels (level-editor-ui-improvements.md
 * slice 8) — a `PanelSplitter` drag changes the panel's width, clamped, and
 * persists it to localStorage on pointerup; collapse/expand hide and restore
 * a panel at the width it already had. jsdom has no layout, so these assert
 * the `width` style and the stored preference, not pixels on screen.
 */

const STORAGE_KEY = 'dandelion-world-panel-widths';

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

/** jsdom has no `PointerEvent` constructor — `WorldViewport.multiSelect.
 *  test.tsx` hits the same wall for its own pointerdown/pointerup — so a
 *  drag is a plain `MouseEvent` of the right *type*, dispatched directly:
 *  React routes on `event.type`, not the constructor, and `clientX` is a
 *  real `MouseEvent` field where it is only an inert property on whatever
 *  `fireEvent.pointerDown`'s init-dict fallback constructs. */
function pointerEvent(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { clientX, bubbles: true, cancelable: true });
}

function drag(handle: HTMLElement, fromX: number, toX: number) {
  act(() => {
    handle.dispatchEvent(pointerEvent('pointerdown', fromX));
    handle.dispatchEvent(pointerEvent('pointermove', toX));
  });
}

function endDrag(handle: HTMLElement, atX: number) {
  act(() => { handle.dispatchEvent(pointerEvent('pointerup', atX)); });
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('the World surface panels', () => {
  it('opens at the default widths with nothing stored', async () => {
    await openWorld();

    expect(screen.getByTestId('world-panel-left')).toHaveStyle({ width: '280px' });
    expect(screen.getByTestId('world-panel-right')).toHaveStyle({ width: '300px' });
  });

  it('resizes the left panel while dragging its splitter', async () => {
    await openWorld();

    drag(screen.getByTestId('world-splitter-left'), 0, 50);

    expect(screen.getByTestId('world-panel-left')).toHaveStyle({ width: '330px' });
  });

  it('clamps the left panel to [200, 480]', async () => {
    await openWorld();

    drag(screen.getByTestId('world-splitter-left'), 0, 1000);
    expect(screen.getByTestId('world-panel-left')).toHaveStyle({ width: '480px' });

    drag(screen.getByTestId('world-splitter-left'), 0, -1000);
    expect(screen.getByTestId('world-panel-left')).toHaveStyle({ width: '200px' });
  });

  it('widens the right panel by dragging its splitter to the left', async () => {
    // grow="left": the right panel widens as the pointer moves left.
    await openWorld();

    drag(screen.getByTestId('world-splitter-right'), 0, -50);

    expect(screen.getByTestId('world-panel-right')).toHaveStyle({ width: '350px' });
  });

  it('clamps the right panel to [220, 520]', async () => {
    await openWorld();

    drag(screen.getByTestId('world-splitter-right'), 0, -1000);
    expect(screen.getByTestId('world-panel-right')).toHaveStyle({ width: '520px' });

    drag(screen.getByTestId('world-splitter-right'), 0, 1000);
    expect(screen.getByTestId('world-panel-right')).toHaveStyle({ width: '220px' });
  });

  it('persists to localStorage on pointerup, not on every move', async () => {
    await openWorld();
    const splitter = screen.getByTestId('world-splitter-left');

    drag(splitter, 0, 40);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    endDrag(splitter, 40);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.left).toBe(320);
  });

  it('restores a stored width on a fresh render', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: 350, right: 260 }));

    await openWorld();

    expect(screen.getByTestId('world-panel-left')).toHaveStyle({ width: '350px' });
    expect(screen.getByTestId('world-panel-right')).toHaveStyle({ width: '260px' });
  });

  it('collapses the left panel to a slim strip, and back to its own width', async () => {
    await openWorld();
    drag(screen.getByTestId('world-splitter-left'), 0, 60);
    expect(screen.getByTestId('world-panel-left')).toHaveStyle({ width: '340px' });

    fireEvent.click(screen.getByTestId('world-panel-collapse-left'));

    expect(screen.queryByTestId('world-panel-left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('world-splitter-left')).not.toBeInTheDocument();
    expect(screen.getByTestId('world-panel-expand-left')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('world-panel-expand-left'));

    // Restored at the width it was resized to, not the default.
    expect(screen.getByTestId('world-panel-left')).toHaveStyle({ width: '340px' });
    expect(screen.queryByTestId('world-panel-expand-left')).not.toBeInTheDocument();
  });

  it('collapses the right panel to a slim strip, and back to its own width', async () => {
    await openWorld();

    fireEvent.click(screen.getByTestId('world-panel-collapse-right'));

    expect(screen.queryByTestId('world-panel-right')).not.toBeInTheDocument();
    expect(screen.getByTestId('world-panel-expand-right')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('world-panel-expand-right'));

    expect(screen.getByTestId('world-panel-right')).toHaveStyle({ width: '300px' });
  });
});
