import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The surface's half of the camera slots (09-04 review §5.1 item 6). The
 * controller decides *what* happened — `NavController.test.ts` holds that —
 * and this is the half the review was about: that the user is told.
 *
 * A slot recall is the one navigation whose success and failure look
 * identical, because both leave the screen as it was: an empty slot moves
 * nothing, and a recall onto the pose you are already at moves nothing
 * either. So the notice is not decoration, it is the only difference.
 *
 * Transient, unlike the three Alerts under the toolbar: those are about a
 * world (refused, saved, failed) and stand until dismissed; this is about a
 * keystroke and outlives it by seconds. The viewport is stubbed as the panels
 * and scatter suites stub it, with a button per outcome.
 */

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((props: {
      onCameraSlot?: (outcome: 'stored' | 'recalled' | 'empty', slot: number) => void;
    }, ref: React.Ref<unknown>) => {
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: () => null, frameVob: () => undefined, framePoint: () => undefined,
      }));
      return (
        <div data-testid="world-viewport-stub">
          {(['stored', 'recalled', 'empty'] as const).map((outcome) => (
            <button
              key={outcome}
              type="button"
              data-testid={`stub-slot-${outcome}`}
              onClick={() => props.onCameraSlot?.(outcome, 1)}
            >
              {outcome}
            </button>
          ))}
        </div>
      );
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
  fireEvent.click(await screen.findByTestId('world-picker-browse'));
  await screen.findByTestId('world-viewport-stub');
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  jest.useRealTimers();
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('WorldSurface — the camera slots say what they did', () => {

  it('names the slot and what happened to it, by its one-based key', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-slot-stored'));
    // Slot index 1 is Ctrl+Shift+2, and the key is what the user pressed.
    expect(screen.getByTestId('world-camera-slot')).toHaveTextContent('Camera slot 2 stored');
  });

  it('says a recall happened, which is otherwise invisible', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-slot-recalled'));
    expect(screen.getByTestId('world-camera-slot')).toHaveTextContent('Camera slot 2 recalled');
  });

  it('says an empty slot is empty — the silence the finding was about', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-slot-empty'));
    expect(screen.getByTestId('world-camera-slot')).toHaveTextContent('Camera slot 2 is empty');
    // Not an error: nothing went wrong, the slot was never filled.
    expect(screen.queryByTestId('world-edit-error')).not.toBeInTheDocument();
  });

  it('goes away on its own — it is about a keystroke, not about the world', async () => {
    // Real timers to open (the open is async and `findBy` polls), fake ones
    // only for the wait this test is about.
    await openWorld();
    jest.useFakeTimers();
    fireEvent.click(screen.getByTestId('stub-slot-stored'));
    expect(screen.getByTestId('world-camera-slot')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(4000); });
    expect(screen.queryByTestId('world-camera-slot')).not.toBeInTheDocument();
  });

  it('a second keystroke replaces the first rather than queueing behind it', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-slot-stored'));
    fireEvent.click(screen.getByTestId('stub-slot-empty'));
    const notices = screen.getAllByTestId('world-camera-slot');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent('Camera slot 2 is empty');
  });
});
