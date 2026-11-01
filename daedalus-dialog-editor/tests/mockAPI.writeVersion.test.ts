/**
 * The harness fake must keep the write precondition the real IPC enforces
 * (#505). `file:write`/`generator:saveFile` compare the caller's
 * `expectedVersion` with the file's current one and refuse a stale write
 * (FileService's EXTERNAL_MODIFICATION), returning the version they wrote.
 *
 * A fake that drops both arguments silently disables the renderer's stale-write
 * guard under the harness and leaves `fileStore`'s `diskVersion` undefined after
 * the first save — so every later save also skips the guard.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { useFileStore } from '../src/renderer/store/fileStore';
import { seedMockFile, resetMockFileSystem } from '../src/renderer/utils/mockAPI';

const FILE = '/project/DIA_Test.d';
const SOURCE = 'func void F1() {};\n';

describe('mockAPI write/version contract (#505)', () => {
  beforeEach(() => {
    useFileStore.setState({ openFiles: new Map(), activeFile: null } as any);
    resetMockFileSystem();
  });

  test('a save reports the version it wrote, and the next save sends it back', async () => {
    seedMockFile(FILE, SOURCE);
    await useFileStore.getState().openFile(FILE);
    const openedAt = useFileStore.getState().getFileState(FILE)!.diskVersion;
    expect(typeof openedAt).toBe('string');

    await useFileStore.getState().saveFile(FILE);
    const savedAt = useFileStore.getState().getFileState(FILE)!.diskVersion;
    expect(typeof savedAt).toBe('string');

    // The version the save adopted is the one the file now holds, so a second
    // save guarded by it is accepted rather than refused as an external change.
    await useFileStore.getState().saveFile(FILE);
    expect(useFileStore.getState().getFileState(FILE)!.externalConflict).toBeUndefined();
  });

  test('a save carrying a stale expectedVersion is refused as an external modification', async () => {
    seedMockFile(FILE, SOURCE);
    await useFileStore.getState().openFile(FILE);

    // Something else wrote the file after the editor read it.
    seedMockFile(FILE, `${SOURCE}// external edit\n`);

    await expect(useFileStore.getState().saveFile(FILE)).rejects.toThrow(/EXTERNAL_MODIFICATION/);
    const state = useFileStore.getState().getFileState(FILE)!;
    expect(state.externalConflict).toBeDefined();
    // The refusal left the disk alone, as the real precondition does.
    expect(await window.editorAPI.readFile(FILE)).toContain('external edit');
  });

  test('resolveExternalConflict("keepMine") overwrites the stale version', async () => {
    seedMockFile(FILE, SOURCE);
    await useFileStore.getState().openFile(FILE);
    seedMockFile(FILE, `${SOURCE}// external edit\n`);

    await useFileStore.getState().saveFile(FILE).catch(() => undefined);
    await useFileStore.getState().resolveExternalConflict(FILE, 'keepMine');

    expect(useFileStore.getState().getFileState(FILE)!.externalConflict).toBeUndefined();
    expect(await window.editorAPI.readFile(FILE)).not.toContain('external edit');
  });
});
