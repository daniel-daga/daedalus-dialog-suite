/**
 * Mid-save race guards for saveFile / saveSource (E7 + N2).
 *
 * An edit that lands while the save IPC is in flight must not be marked clean:
 * it is not on disk yet. saveSource must additionally keep source keystrokes
 * typed during the write so the file stays source-dirty (E2a semantics).
 *
 * TDD: these tests are red before the guards are added.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';

const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');
const mockWriteFile = jest.spyOn(window.editorAPI, 'writeFile');
const mockParseSource = jest.spyOn(window.editorAPI, 'parseSource');

const baseState = {
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

describe('fileStore.saveFile mid-save race guard (E7)', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
    mockSaveFile.mockReset();
  });

  test('keeps the file dirty when the model is edited while the save is in flight', async () => {
    const filePath = 'race.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: { dialogs: {}, functions: { F1: { name: 'F1', actions: [] } }, hasErrors: false, errors: [] },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    let resolveSave!: (value: unknown) => void;
    mockSaveFile.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }) as any
    );

    const savePromise = useEditorStore.getState().saveFile(filePath);

    // Edit lands while the save IPC round-trip is still pending
    useEditorStore.getState().updateFunction(filePath, 'F1', {
      name: 'F1',
      actions: [{ text: 'edited mid-save' } as any],
    });

    resolveSave({ success: true, validationResult: { isValid: true, errors: [], warnings: [] } });
    await savePromise;

    expect(useEditorStore.getState().getFileState(filePath)?.isDirty).toBe(true);
  });

  test('marks the file clean when nothing changes during the save', async () => {
    const filePath = 'clean.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: { dialogs: {}, functions: { F1: { name: 'F1', actions: [] } }, hasErrors: false, errors: [] },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    mockSaveFile.mockResolvedValueOnce({
      success: true,
      validationResult: { isValid: true, errors: [], warnings: [] },
    } as any);

    await useEditorStore.getState().saveFile(filePath);

    expect(useEditorStore.getState().getFileState(filePath)?.isDirty).toBe(false);
  });

  test('does not raise a stale validation dialog for a superseded model', async () => {
    const filePath = 'superseded.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: { dialogs: {}, functions: { F1: { name: 'F1', actions: [] } }, hasErrors: false, errors: [] },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    const validationResult = { isValid: false, errors: [{ type: 'syntax_error', message: 'bad' }], warnings: [] };
    let resolveSave!: (value: unknown) => void;
    mockSaveFile.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; }) as any
    );

    const savePromise = useEditorStore.getState().saveFile(filePath);

    // Model edited during the round-trip → the returned validation is stale
    useEditorStore.getState().updateFunction(filePath, 'F1', {
      name: 'F1',
      actions: [{ text: 'edited mid-save' } as any],
    });

    resolveSave({ success: false, validationResult });
    await savePromise;

    expect(useEditorStore.getState().pendingValidation).toBeNull();
  });
});

describe('fileStore.saveSource mid-save race guard (N2)', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
    mockWriteFile.mockReset();
    mockParseSource.mockReset();
    mockParseSource.mockResolvedValue({ dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any);
  });

  test('keeps workingCode when the user types during the save (file stays source-dirty)', async () => {
    const filePath = 'source-race.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] },
        isDirty: false,
        lastSaved: new Date(),
        originalCode: 'old code',
        workingCode: 'saved snapshot',
      }]]),
      activeFile: filePath,
    });

    let resolveWrite!: (value: unknown) => void;
    mockWriteFile.mockImplementationOnce(
      () => new Promise((resolve) => { resolveWrite = resolve; }) as any
    );

    const savePromise = useEditorStore.getState().saveSource(filePath, 'saved snapshot');

    // Keystrokes land during the write
    useEditorStore.getState().setWorkingCode(filePath, 'newer typed code');

    resolveWrite({ success: true });
    await savePromise;

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.workingCode).toBe('newer typed code');
    expect(fileState?.originalCode).toBe('saved snapshot');
    expect(fileState?.workingCode).not.toBe(fileState?.originalCode);
    expect(fileState?.isDirty).toBe(false);
  });

  test('clears workingCode when nothing changed during the save', async () => {
    const filePath = 'source-clean.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] },
        isDirty: false,
        lastSaved: new Date(),
        originalCode: 'old code',
        workingCode: 'saved snapshot',
      }]]),
      activeFile: filePath,
    });

    mockWriteFile.mockResolvedValueOnce({ success: true } as any);

    await useEditorStore.getState().saveSource(filePath, 'saved snapshot');

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.workingCode).toBeUndefined();
    expect(fileState?.originalCode).toBe('saved snapshot');
  });
});
