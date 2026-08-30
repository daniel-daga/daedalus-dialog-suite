/**
 * `updateModel` and `_applyHistoryModelUpdate` clear `saveError` (2026-07 4.5).
 *
 * Every other model mutator (`updateDialog`, `updateFunction`, …) clears both
 * `autoSaveError` and `saveError`, so a stale save failure keeps showing after
 * the user has edited the file. These two cleared only `autoSaveError`, and
 * their bodies were byte-identical copies of each other.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import type { SemanticModel } from 'daedalus-parser/semantic-model';

const emptyModel = (): SemanticModel =>
  ({ dialogs: {}, functions: {}, hasErrors: false, errors: [] }) as unknown as SemanticModel;

const openWithSaveError = (filePath: string) => {
  useEditorStore.setState({
    openFiles: new Map([[filePath, {
      filePath,
      semanticModel: emptyModel(),
      isDirty: false,
      lastSaved: new Date(),
      saveError: 'disk full',
      autoSaveError: 'disk full',
    }]]),
    activeFile: filePath,
  });
};

describe('model mutators clear a stale save failure', () => {
  beforeEach(() => {
    useEditorStore.setState({ openFiles: new Map(), activeFile: null });
  });

  test('updateModel clears saveError', () => {
    openWithSaveError('a.d');
    useEditorStore.getState().updateModel('a.d', emptyModel());
    const fileState = useEditorStore.getState().getFileState('a.d');
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.saveError).toBeUndefined();
    expect(fileState?.autoSaveError).toBeUndefined();
  });

  test('_applyHistoryModelUpdate clears saveError', () => {
    openWithSaveError('b.d');
    useEditorStore.getState()._applyHistoryModelUpdate('b.d', emptyModel());
    const fileState = useEditorStore.getState().getFileState('b.d');
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.saveError).toBeUndefined();
    expect(fileState?.autoSaveError).toBeUndefined();
  });

  test('neither mutator touches a file that is not open', () => {
    useEditorStore.getState().updateModel('missing.d', emptyModel());
    useEditorStore.getState()._applyHistoryModelUpdate('missing.d', emptyModel());
    expect(useEditorStore.getState().getFileState('missing.d')).toBeUndefined();
  });
});
