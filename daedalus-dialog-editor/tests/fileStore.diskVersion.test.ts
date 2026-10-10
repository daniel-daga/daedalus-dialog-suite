/**
 * The editing snapshot carries the disk version it was read from (#378).
 *
 * The main process keeps no save baseline of its own: `openFile`/`reloadFile`
 * take the version with the bytes, `saveFile` hands it back as
 * `expectedVersion`, and a successful save adopts the version it wrote. No
 * other read — a Review Changes preview, the conflict dialog's diff — can
 * advance it.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';

const SOURCE = 'func void F1() {};\n';

const baseState = {
  activeFile: null as string | null,
  project: null,
  codeSettings: {
    indentChar: '\t' as const,
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true,
  },
  autoSaveEnabled: true,
  autoSaveInterval: 2000,
};

const ok = (version: string) => ({
  success: true,
  version,
  validationResult: { isValid: true, errors: [], warnings: [] },
});

describe('fileStore disk version (#378)', () => {
  let readVersioned: jest.SpiedFunction<typeof window.editorAPI.readFileVersioned>;
  let saveFile: jest.SpiedFunction<typeof window.editorAPI.saveFile>;

  beforeEach(() => {
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
    readVersioned = jest.spyOn(window.editorAPI, 'readFileVersioned');
    saveFile = jest.spyOn(window.editorAPI, 'saveFile');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const expectedVersionOf = (call: number) =>
    (saveFile.mock.calls[call][3] as { expectedVersion?: string }).expectedVersion;

  test('a save sends the version the file was opened at, and adopts the version it wrote', async () => {
    readVersioned.mockResolvedValueOnce({ content: SOURCE, version: 'v-open' });
    await useEditorStore.getState().openFile('a.d');

    saveFile.mockResolvedValueOnce(ok('v-save1') as any);
    await useEditorStore.getState().saveFile('a.d');
    expect(expectedVersionOf(0)).toBe('v-open');

    // A preview read between saves goes through `readFile`; it is not the
    // snapshot's read and must not touch the baseline.
    await window.editorAPI.readFile('a.d').catch(() => undefined);

    saveFile.mockResolvedValueOnce(ok('v-save2') as any);
    await useEditorStore.getState().saveFile('a.d');
    expect(expectedVersionOf(1)).toBe('v-save1');
  });

  test('a reload adopts the version of the bytes it re-read', async () => {
    readVersioned.mockResolvedValueOnce({ content: SOURCE, version: 'v-open' });
    await useEditorStore.getState().openFile('b.d');

    readVersioned.mockResolvedValueOnce({ content: SOURCE, version: 'v-reloaded' });
    await useEditorStore.getState().reloadFile('b.d');

    saveFile.mockResolvedValueOnce(ok('v-save') as any);
    await useEditorStore.getState().saveFile('b.d');
    expect(expectedVersionOf(0)).toBe('v-reloaded');
  });

  test('a refused save keeps the old version', async () => {
    readVersioned.mockResolvedValueOnce({ content: SOURCE, version: 'v-open' });
    await useEditorStore.getState().openFile('c.d');

    saveFile.mockRejectedValueOnce(
      new Error('Failed to save file: EXTERNAL_MODIFICATION: c.d was modified on disk since it was last read')
    );
    await useEditorStore.getState().saveFile('c.d').catch(() => undefined);
    expect(useEditorStore.getState().getFileState('c.d')?.externalConflict).toBeDefined();

    saveFile.mockResolvedValueOnce(ok('v-forced') as any);
    await useEditorStore.getState().resolveExternalConflict('c.d', 'keepMine');
    expect(expectedVersionOf(1)).toBe('v-open');
    expect((saveFile.mock.calls[1][3] as { overwriteExternal?: boolean }).overwriteExternal).toBe(true);
  });

  test('overlapping saves of one file run in turn, the second guarded by the first one\'s version', async () => {
    readVersioned.mockResolvedValueOnce({ content: SOURCE, version: 'v-open' });
    await useEditorStore.getState().openFile('d.d');

    let finishFirst!: (value: unknown) => void;
    saveFile.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }) as any);
    saveFile.mockResolvedValueOnce(ok('v-save2') as any);

    // Auto-save and Ctrl+S racing: without serialization the second would
    // carry the pre-save version and be refused as an external change.
    const first = useEditorStore.getState().saveFile('d.d');
    const second = useEditorStore.getState().saveFile('d.d');
    await Promise.resolve();
    expect(saveFile).toHaveBeenCalledTimes(1);

    finishFirst(ok('v-save1'));
    await Promise.all([first, second]);

    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(expectedVersionOf(0)).toBe('v-open');
    expect(expectedVersionOf(1)).toBe('v-save1');
  });
});
