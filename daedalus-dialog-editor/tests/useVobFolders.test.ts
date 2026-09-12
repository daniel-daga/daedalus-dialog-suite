/**
 * The World surface's user-created VOB folders, lifted out of
 * `WorldSurface.tsx` (`docs/plans/level-editor-review-2026-09-04.md` §4 —
 * "folders/asset catalog" is one of the nine concerns).
 *
 * A folder is editor metadata, never a `WorldOp`: it is kept in a sidecar
 * beside the world file rather than in the undo history. So what the hook owes
 * its caller is that every mutation goes through the one place that both sets
 * state and writes the sidecar, that a selection is stored as index paths, and
 * that a failed write is logged rather than surfaced the way a refused world
 * edit is.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { emptyVobFolders, type VobIndex } from 'zen-world';
import { useVobFolders } from '../src/renderer/components/world/hooks/useVobFolders';
import { useWorldStore } from '../src/renderer/store/worldStore';
import type { WorldSummary } from '../src/shared/worldTypes';

const WORLD_PATH = 'C:/g2/Data/Worlds/NEWWORLD.ZEN';

/** Three flat root VOBs — enough for `vobIndexPath` to have something to
 *  resolve, which is what a folder actually stores. */
function vobIndexOf(count: number): VobIndex {
  return {
    count,
    parent: new Int32Array(count).fill(-1).buffer,
    childIndex: new Uint32Array(count).map((_, i) => i).buffer,
    positions: new Float32Array(count * 3).buffer,
    rotations: new Float32Array(count * 9).buffer,
    flags: new Uint32Array(count).buffer,
    classes: ['zCVob'], classIndex: new Uint32Array(count).buffer,
    names: [''], nameIndex: new Uint32Array(count).buffer,
    visuals: [''], visualIndex: new Uint32Array(count).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(count).buffer,
  };
}

function summaryOf(count: number): WorldSummary {
  return {
    worldPath: WORLD_PATH,
    bbox: [0, 0, 0, 1, 1, 1],
    vobIndex: vobIndexOf(count),
    stats: { vobCount: count, materials: 1, worldDrawGroups: 1, worldTriangles: 1 },
    timings: {},
  };
}

const saveVobFolders = jest.fn(async () => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  saveVobFolders.mockResolvedValue(undefined);
  (window as unknown as { editorAPI: unknown }).editorAPI = { saveVobFolders };
  useWorldStore.setState({ summary: null, selection: [] } as never);
});

/** The store is read through `getState()`, so a summary is all the hook needs. */
function withWorldOpen(selection: number[] = []): void {
  useWorldStore.setState({ summary: summaryOf(3), selection } as never);
}

function mount() {
  return renderHook(() => useVobFolders());
}

describe('useVobFolders — the sidecar', () => {
  test('a fresh mount has no folders', () => {
    const { result } = mount();
    expect(result.current.vobFolders).toEqual(emptyVobFolders());
  });

  test('creating a folder sets state and writes the sidecar', () => {
    withWorldOpen();
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Fences'); });

    expect(result.current.vobFolders.folders).toHaveLength(1);
    expect(result.current.vobFolders.folders[0].name).toBe('Fences');
    expect(saveVobFolders).toHaveBeenCalledTimes(1);
    const [path, written] = saveVobFolders.mock.calls[0] as [string, typeof result.current.vobFolders];
    expect(path).toBe(WORLD_PATH);
    expect(written.folders[0].name).toBe('Fences');
  });

  test('with no world open, state still changes but nothing is written', () => {
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Orphan'); });
    expect(result.current.vobFolders.folders).toHaveLength(1);
    expect(saveVobFolders).not.toHaveBeenCalled();
  });

  test('a failed write is logged, not thrown at the caller', async () => {
    withWorldOpen();
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    saveVobFolders.mockRejectedValue(new Error('disk full'));

    const { result } = mount();
    await act(async () => {
      result.current.createFolderWithSelection('Fences');
      await Promise.resolve();
    });

    expect(result.current.vobFolders.folders).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
  });

  test('every mutation writes — rename, delete, add and remove alike', () => {
    withWorldOpen();
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Fences'); });
    const id = result.current.vobFolders.folders[0].id;

    act(() => { result.current.renameFolder(id, 'Walls'); });
    expect(result.current.vobFolders.folders[0].name).toBe('Walls');

    act(() => { result.current.removeVobFromFolder(id, '0'); });
    act(() => { result.current.deleteFolder(id); });
    expect(result.current.vobFolders.folders).toHaveLength(0);

    expect(saveVobFolders).toHaveBeenCalledTimes(4);
  });

  test('setVobFolders replaces the state without writing — it is the open path', () => {
    withWorldOpen();
    const { result } = mount();
    act(() => {
      result.current.setVobFolders({ folders: [{ id: 'a', name: 'FromDisk', vobPaths: [] }] });
    });
    expect(result.current.vobFolders.folders[0].name).toBe('FromDisk');
    expect(saveVobFolders).not.toHaveBeenCalled();
  });
});

describe('useVobFolders — the selection', () => {
  test('creating with nothing selected makes an empty folder', () => {
    withWorldOpen();
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Empty'); });
    expect(result.current.vobFolders.folders[0].vobPaths).toEqual([]);
  });

  test('the Folders tab\'s create makes an empty folder even with a selection', () => {
    withWorldOpen([0, 1]);
    const { result } = mount();
    act(() => { result.current.createEmptyFolder('Plain'); });
    expect(result.current.vobFolders.folders[0]).toMatchObject({ name: 'Plain', vobPaths: [] });
  });

  test('the context menu\'s create takes the selection with it', () => {
    withWorldOpen([0, 1]);
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('WithThese'); });
    expect(result.current.vobFolders.folders[0].vobPaths).toEqual(['0', '1']);
  });

  test('adding to a folder with nothing selected is a no-op, not an empty write', () => {
    withWorldOpen([]);
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Fences'); });
    const id = result.current.vobFolders.folders[0].id;
    saveVobFolders.mockClear();

    act(() => { result.current.addSelectionToFolder(id); });
    expect(saveVobFolders).not.toHaveBeenCalled();
  });

  test('a selection is stored as index paths', () => {
    withWorldOpen([0, 2]);
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Fences'); });
    expect(result.current.vobFolders.folders[0].vobPaths).toEqual(['0', '2']);
  });

  test('a VOB outside the index contributes no path, rather than a guess', () => {
    withWorldOpen([0, 99]);
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Fences'); });
    expect(result.current.vobFolders.folders[0].vobPaths).toEqual(['0']);
  });

  test('with no world open at all, a selection resolves to nothing', () => {
    useWorldStore.setState({ summary: null, selection: [0, 1] } as never);
    const { result } = mount();
    act(() => { result.current.createFolderWithSelection('Fences'); });
    expect(result.current.vobFolders.folders[0].vobPaths).toEqual([]);
  });
});
