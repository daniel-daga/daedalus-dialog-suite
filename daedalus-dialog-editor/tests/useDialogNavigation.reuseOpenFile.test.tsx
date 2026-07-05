/**
 * Phase 1.1 (dialog-open-latency): selecting a dialog whose file is already
 * open must reuse `setActiveFile` instead of re-running `openFile`'s
 * readFile → parseSource pipeline. This also fixes a latent bug — `openFile`
 * on an already-open *dirty* file used to discard in-flight edits.
 *
 * TDD: red before `handleSelectDialog`/`handleSelectRecentDialog` gain the
 * "already open" branch.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useDialogNavigation } from '../src/renderer/components/hooks/useDialogNavigation';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import type { FileState } from '../src/renderer/store/fileStore';

const mockReadFile = jest.spyOn(window.editorAPI, 'readFile');
const mockParseSource = jest.spyOn(window.editorAPI, 'parseSource');

const makeFileState = (over: Partial<FileState>): FileState => ({
  filePath: 'x.d',
  semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any,
  isDirty: false,
  lastSaved: new Date(),
  ...over,
});

const baseFileStoreState = {
  activeFile: null as string | null,
  pendingValidation: null,
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

function renderNav(overrides: Partial<Parameters<typeof useDialogNavigation>[0]> = {}) {
  const finalizeDialogSelection = jest.fn();
  const setIsLoadingDialog = jest.fn();
  const setOperationError = jest.fn();
  const closeRecentDialog = jest.fn(() => null);

  const { result } = renderHook(() =>
    useDialogNavigation({
      isProjectMode: true,
      selectedNPC: 'NPC1',
      selectedDialog: null,
      activeNpcName: null,
      finalizeDialogSelection,
      setIsLoadingDialog,
      setOperationError,
      closeRecentDialog,
      ...overrides,
    })
  );

  return { result, finalizeDialogSelection, setIsLoadingDialog, setOperationError };
}

describe('useDialogNavigation reuses already-open files', () => {
  beforeEach(() => {
    mockReadFile.mockClear();
    mockParseSource.mockClear();

    useProjectStore.setState({
      dialogIndex: new Map([
        ['NPC1', [{ dialogName: 'D1', npc: 'NPC1', filePath: 'file1.d' }]],
      ]),
    });
  });

  test('handleSelectDialog: file already open → setActiveFile, no readFile/parseSource', async () => {
    useEditorStore.setState({
      ...baseFileStoreState,
      openFiles: new Map([
        ['file1.d', makeFileState({ filePath: 'file1.d' })],
        ['file2.d', makeFileState({ filePath: 'file2.d' })],
      ]),
      activeFile: 'file2.d',
    });

    const { result, finalizeDialogSelection } = renderNav();

    await act(async () => {
      await result.current.handleSelectDialog('D1', null);
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockParseSource).not.toHaveBeenCalled();
    expect(useEditorStore.getState().activeFile).toBe('file1.d');
    expect(finalizeDialogSelection).toHaveBeenCalledWith('D1', null);
  });

  test('handleSelectDialog: already-open dirty file keeps its model, isDirty, and workingCode', async () => {
    const dirtyModel = { dialogs: { Kept: {} }, functions: {}, hasErrors: false, errors: [] } as any;
    const dirtyFileState = makeFileState({
      filePath: 'file1.d',
      semanticModel: dirtyModel,
      isDirty: true,
      workingCode: 'in-flight edits not yet saved',
      originalCode: 'disk content',
    });

    useEditorStore.setState({
      ...baseFileStoreState,
      openFiles: new Map([
        ['file1.d', dirtyFileState],
        ['file2.d', makeFileState({ filePath: 'file2.d' })],
      ]),
      activeFile: 'file2.d',
    });

    const { result } = renderNav();

    await act(async () => {
      await result.current.handleSelectDialog('D1', null);
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockParseSource).not.toHaveBeenCalled();

    const fileState = useEditorStore.getState().getFileState('file1.d');
    expect(useEditorStore.getState().activeFile).toBe('file1.d');
    expect(fileState?.semanticModel).toBe(dirtyModel);
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.workingCode).toBe('in-flight edits not yet saved');
  });

  test('handleSelectRecentDialog: file already open → setActiveFile, no readFile/parseSource', async () => {
    useEditorStore.setState({
      ...baseFileStoreState,
      openFiles: new Map([
        ['file1.d', makeFileState({ filePath: 'file1.d' })],
        ['file2.d', makeFileState({ filePath: 'file2.d' })],
      ]),
      activeFile: 'file2.d',
    });

    const { result, finalizeDialogSelection } = renderNav();

    await act(async () => {
      await result.current.handleSelectRecentDialog('D1', null, 'NPC1');
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockParseSource).not.toHaveBeenCalled();
    expect(useEditorStore.getState().activeFile).toBe('file1.d');
    expect(finalizeDialogSelection).toHaveBeenCalledWith('D1', null);
  });
});
