/**
 * #381: an open still in flight when the project closes. `endWorldSession`
 * (App.tsx) closes the world and resets the store, and `MainLayout`'s
 * `projectSession` key unmounts the surface — but the pending `openWorld` is
 * then rejected by `WorldService.close()` ("The world was closed"), and its
 * catch used to call `openFailed` on the shared store, so the next project's
 * World view opened on that error instead of the idle picker.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => ({
  __esModule: true,
  default: () => <div data-testid="world-viewport-stub" />,
}));

const api = makeWorldEditorApi();

/** Starts an open through Browse… whose `openWorld` answers only when told. */
async function startOpen() {
  let answer!: { resolve: (value: unknown) => void; reject: (error: Error) => void };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockReturnValueOnce(new Promise((resolve, reject) => { answer = { resolve, reject }; }) as never);
  const view = render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  fireEvent.click(await screen.findByTestId('world-picker-browse'));
  await act(async () => {});
  expect(useWorldStore.getState().status).toBe('opening');
  return { view, answer };
}

/** What `endWorldSession` does to the surface: the store reset, then the
 *  remount `projectSession` keys. */
function endWorldSession(view: ReturnType<typeof render>) {
  useWorldStore.getState().reset();
  view.unmount();
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

describe('an open in flight when the world session ends', () => {
  it('drops the rejection the close causes, leaving the store idle', async () => {
    const { view, answer } = await startOpen();

    endWorldSession(view);
    await act(async () => { answer.reject(new Error('The world was closed')); });

    expect(useWorldStore.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('drops a summary that lands after it, too', async () => {
    const { view, answer } = await startOpen();

    endWorldSession(view);
    await act(async () => { answer.resolve({ ...SUMMARY, vobIndex: vobIndex([[0, 0, 0]]) }); });

    expect(useWorldStore.getState()).toMatchObject({ status: 'idle', summary: null });
    expect(api.getWorldMesh).not.toHaveBeenCalled();
  });
});
