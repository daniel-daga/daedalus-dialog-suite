/**
 * #277: a dialog's description follows its information function's first line
 * for as long as the two agree. The store does it, not the line editor, so a
 * delete, a reorder or a pasted line carry it too — and it lands in the same
 * model write as the line edit, so one undo takes back both.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import type { FileState } from '../src/renderer/store/fileStore';

const FILE = 'sync.d';

const line = (text: string, speaker = 'other') => ({ type: 'DialogLine', speaker, text, id: `id_${text}` });

const infoFunction = (...actions: unknown[]) => ({
  name: 'DIA_Sync_Info', returnType: 'VOID', conditions: [], calls: [], actions
});

const seed = (description: string | undefined, actions: unknown[]) => {
  const fileState: FileState = {
    filePath: FILE,
    semanticModel: {
      dialogs: {
        DIA_Sync: {
          name: 'DIA_Sync',
          parent: 'C_INFO',
          properties: { npc: 'PC_Hero', information: 'dia_sync_info', ...(description === undefined ? {} : { description }) }
        }
      },
      functions: { DIA_Sync_Info: infoFunction(...actions) },
      hasErrors: false,
      errors: []
    } as any,
    isDirty: false,
    lastSaved: new Date()
  };
  useEditorStore.setState({ openFiles: new Map([[FILE, fileState]]), activeFile: FILE });
};

const descriptionNow = () =>
  useEditorStore.getState().getFileState(FILE)?.semanticModel.dialogs.DIA_Sync.properties.description;

const replaceInfo = (...actions: unknown[]) =>
  useEditorStore.getState().updateFunction(FILE, 'DIA_Sync_Info', infoFunction(...actions) as any);

describe('description follows the first line (#277)', () => {
  beforeEach(() => useEditorStore.setState({ openFiles: new Map() }));

  test('an edit to the first line carries into a description that matched it', () => {
    seed('"Hallo du"', [line('Hallo du'), line('Was willst du?', 'self')]);
    replaceInfo(line('Hallo Fremder'), line('Was willst du?', 'self'));
    expect(descriptionNow()).toBe('"Hallo Fremder"');
  });

  test('the updater path carries it too', () => {
    seed('"Hallo du"', [line('Hallo du')]);
    useEditorStore.getState().updateFunctionWithUpdater(FILE, 'DIA_Sync_Info', (fn) => ({
      ...fn, actions: [line('Hallo Fremder')]
    }) as any);
    expect(descriptionNow()).toBe('"Hallo Fremder"');
  });

  test('a new dialog with no lines and no description fills from its first line', () => {
    seed('', []);
    replaceInfo(line('Hallo du'));
    expect(descriptionNow()).toBe('"Hallo du"');
  });

  test('a description that already differed is left alone', () => {
    seed('"Wer bist du?"', [line('Hallo du')]);
    replaceInfo(line('Hallo Fremder'));
    expect(descriptionNow()).toBe('"Wer bist du?"');
  });

  test('deleting the first line moves the description to the new first line', () => {
    seed('"Hallo du"', [line('Hallo du'), line('Was willst du?', 'self')]);
    replaceInfo(line('Was willst du?', 'self'));
    expect(descriptionNow()).toBe('"Was willst du?"');
  });

  test('a dialog whose information is another function is untouched', () => {
    seed('"Hallo du"', [line('Hallo du')]);
    useEditorStore.getState().updateFunction(FILE, 'DIA_Other_Info', {
      ...infoFunction(line('Anders')), name: 'DIA_Other_Info'
    } as any);
    expect(descriptionNow()).toBe('"Hallo du"');
  });
});
