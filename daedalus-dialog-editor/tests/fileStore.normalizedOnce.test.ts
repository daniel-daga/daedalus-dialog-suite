/**
 * `ensureActionIds` walks every function of a model — O(functions × dialogs)
 * — and `openFile` ran it on every open, cache hit included (production-
 * readiness §3 P3). A cross-file dialog click hands `openFile` the
 * projectStore's cached model object; the second click on the same dialog
 * hands it the very same object, and the walk has nothing left to stamp.
 *
 * `collectDialogLineActions` is called once per function inside the walk, so
 * counting its calls is counting the walk.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { collectDialogLineActions } from '../src/renderer/components/nestedActionUtils';
import { seedMockFile, resetMockFileSystem } from '../src/renderer/utils/mockAPI';

jest.mock('../src/renderer/components/nestedActionUtils', () => {
  const actual = jest.requireActual<typeof import('../src/renderer/components/nestedActionUtils')>(
    '../src/renderer/components/nestedActionUtils'
  );
  return { ...actual, collectDialogLineActions: jest.fn(actual.collectDialogLineActions) };
});

const walk = collectDialogLineActions as jest.Mock;

const cachedModel = () => ({
  dialogs: {
    D1: { name: 'D1', properties: { npc: 'NPC1', information: 'D1_Info' } },
  },
  functions: {
    D1_Info: {
      name: 'D1_Info',
      returnType: 'VOID',
      calls: [],
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'Hello', id: 'NEW_LINE_ID' },
        { type: 'SetVariableAction', variableName: 'X', operator: '=', value: 1 },
      ],
    },
    D1_Choice: { name: 'D1_Choice', returnType: 'VOID', calls: [], actions: [] },
  },
  hasErrors: false,
  errors: [],
}) as any;

describe('fileStore › re-opening a normalized file does not re-walk', () => {
  beforeEach(() => {
    useEditorStore.setState({ openFiles: new Map(), activeFile: null } as any);
    resetMockFileSystem();
    walk.mockClear();
  });

  test('the same cached model object is walked once across two opens', async () => {
    const filePath = 'cached.d';
    seedMockFile(filePath, '// disk\n');
    const model = cachedModel();
    const store = useEditorStore.getState();

    await store.openFile(filePath, { model });
    expect(walk).toHaveBeenCalled();
    const first = store.getFileState(filePath)!.semanticModel;
    expect((first.functions.D1_Info.actions[0] as any).id).not.toBe('NEW_LINE_ID');

    store.closeFile(filePath);
    walk.mockClear();

    await store.openFile(filePath, { model });
    expect(walk).not.toHaveBeenCalled();

    // And the second open still lands the normalized model, not the raw one.
    const second = store.getFileState(filePath)!.semanticModel;
    expect(second).toBe(first);
  });

  test('a different model object for the same path is walked', async () => {
    const filePath = 'cached.d';
    seedMockFile(filePath, '// disk\n');
    const store = useEditorStore.getState();

    await store.openFile(filePath, { model: cachedModel() });
    walk.mockClear();

    await store.openFile(filePath, { model: cachedModel() });
    expect(walk).toHaveBeenCalled();
  });
});
