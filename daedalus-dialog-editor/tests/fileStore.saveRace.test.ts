/**
 * Mid-save race guard for saveFile (E7).
 *
 * An edit that lands while the save IPC is in flight must not be marked clean:
 * it is not on disk yet.
 *
 * The companion saveSource (N2) race guard was removed with the source-editing
 * state machine (F2) — there is no source buffer to race against any more.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';

const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');

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
