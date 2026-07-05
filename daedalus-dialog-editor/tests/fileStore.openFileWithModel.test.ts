/**
 * Phase 1.2 (dialog-open-latency): `openFile` accepts a pre-parsed model so a
 * cross-file dialog click can reuse the projectStore's cached
 * `parsedFiles` model instead of re-running the full parse pipeline.
 *
 * TDD: red before `openFile` gains the `opts.model` parameter.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { seedMockFile, resetMockFileSystem } from '../src/renderer/utils/mockAPI';

const mockParseSource = jest.spyOn(window.editorAPI, 'parseSource');
const mockReadFile = jest.spyOn(window.editorAPI, 'readFile');

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

describe('openFile with a pre-parsed model (opts.model)', () => {
  beforeEach(() => {
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
    mockParseSource.mockClear();
    mockReadFile.mockClear();
    resetMockFileSystem();
  });

  test('skips parseSource, applies ensureActionIds, and still reads disk for originalCode', async () => {
    const filePath = 'precached.d';
    const diskSource = '// disk content, not read by any parser here\n';
    seedMockFile(filePath, diskSource);

    const model = {
      dialogs: {
        D1: { name: 'D1', properties: { npc: 'NPC1', information: 'D1_Info' } },
      },
      functions: {
        D1_Info: {
          name: 'D1_Info',
          returnType: 'VOID',
          actions: [
            { type: 'DialogLine', speaker: 'self', text: 'D1_15_00', id: 'NEW_LINE_ID' },
          ],
          calls: [],
        },
      },
      hasErrors: false,
      errors: [],
    } as any;

    await useEditorStore.getState().openFile(filePath, { model });

    expect(mockParseSource).not.toHaveBeenCalled();
    expect(mockReadFile).toHaveBeenCalledWith(filePath);

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState).toBeDefined();
    expect(fileState?.originalCode).toBe(diskSource);
    expect(useEditorStore.getState().activeFile).toBe(filePath);
    expect(fileState?.isDirty).toBe(false);

    // ensureActionIds must have replaced the placeholder id with a real one.
    const action = fileState?.semanticModel.functions.D1_Info.actions[0] as any;
    expect(action.id).toBeDefined();
    expect(action.id).not.toBe('NEW_LINE_ID');
  });

  test('without opts, still parses via parseSource (unchanged behavior)', async () => {
    const filePath = 'needs-parse.d';
    seedMockFile(filePath, 'INSTANCE DIA_Example_Hello(C_INFO) {\n\tnpc = PC_Hero;\n};');

    await useEditorStore.getState().openFile(filePath);

    expect(mockParseSource).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().getFileState(filePath)).toBeDefined();
    expect(useEditorStore.getState().activeFile).toBe(filePath);
  });
});
