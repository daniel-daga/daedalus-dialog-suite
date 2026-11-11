/**
 * Cross-file voice-ID plumbing: saveFile must pass the project-wide voice-ID
 * index to validation EXCLUDING the file being saved — otherwise every one of
 * the file's own voice IDs would be reported as a cross-file duplicate of
 * itself. Outside project mode the option must be omitted entirely so
 * validation degrades to intra-file checks.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useProjectStore } from '../src/renderer/store/projectStore';

const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');
const mockValidateModel = jest.spyOn(window.editorAPI, 'validateModel');

const SELF = 'C:/mod/DIA_Self.d';
const OTHER = 'C:/mod/DIA_Other.d';

// The saved file uses DIA_X_15_00 and a conditional's DIA_NESTED_15_00; the
// expression-valued id must never be looked up.
const model = {
  dialogs: {},
  functions: {
    DIA_Self_Info: {
      name: 'DIA_Self_Info',
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'X', id: 'DIA_X_15_00' },
        {
          type: 'ConditionalAction',
          condition: 'TRUE',
          thenActions: [{ type: 'DialogLine', speaker: 'self', text: 'N', id: 'DIA_Nested_15_00' }],
          elseActions: [],
        },
        { type: 'DialogLine', speaker: 'self', text: 'E', id: 'DIA_Expr_15_00', idIsExpression: true },
      ],
    },
  },
  hasErrors: false,
  errors: [],
};

const openSelf = () => {
  useEditorStore.setState({
    openFiles: new Map([[SELF, {
      filePath: SELF,
      semanticModel: model,
      isDirty: true,
      lastSaved: new Date(),
    }]]),
    activeFile: SELF,
  } as any);
};

describe('saveFile existingVoiceIds option', () => {
  beforeEach(() => {
    mockSaveFile.mockReset();
    mockSaveFile.mockResolvedValue({
      success: true,
      validationResult: { isValid: true, errors: [], warnings: [] },
    } as any);
    mockValidateModel.mockReset();
    mockValidateModel.mockResolvedValue({ isValid: true, errors: [], warnings: [] } as any);
    openSelf();
  });

  test('carries only the ids this file uses, minus the file own entries', async () => {
    useProjectStore.setState({
      projectPath: 'C:/mod',
      voiceIdIndex: {
        DIA_X_15_00: [
          { filePath: SELF, functionName: 'DIA_Self_Info' },
          { filePath: OTHER, functionName: 'DIA_Other_Info' },
        ],
        DIA_NESTED_15_00: [{ filePath: OTHER, functionName: 'DIA_Other_Nested' }],
        DIA_EXPR_15_00: [{ filePath: OTHER, functionName: 'DIA_Other_Expr' }],
        DIA_Y_15_01: [
          { filePath: SELF, functionName: 'DIA_Self_Choice' },
        ],
        DIA_UNUSED_15_02: [{ filePath: OTHER, functionName: 'DIA_Other_Unused' }],
      },
    } as any);

    await useEditorStore.getState().saveFile(SELF);

    expect(mockSaveFile).toHaveBeenCalledTimes(1);
    const options = mockSaveFile.mock.calls[0][3] as any;
    expect(options.existingVoiceIds).toEqual({
      DIA_X_15_00: [{ filePath: OTHER, functionName: 'DIA_Other_Info' }],
      DIA_NESTED_15_00: [{ filePath: OTHER, functionName: 'DIA_Other_Nested' }],
    });
  });

  test('carries the same filtered map on the validateFile path', async () => {
    useProjectStore.setState({
      projectPath: 'C:/mod',
      voiceIdIndex: {
        DIA_X_15_00: [{ filePath: OTHER, functionName: 'DIA_Other_Info' }],
        DIA_UNUSED_15_02: [{ filePath: OTHER, functionName: 'DIA_Other_Unused' }],
      },
    } as any);

    await useEditorStore.getState().validateFile(SELF);

    const options = mockValidateModel.mock.calls[0][2] as any;
    expect(options.existingVoiceIds).toEqual({
      DIA_X_15_00: [{ filePath: OTHER, functionName: 'DIA_Other_Info' }],
    });
  });

  test('omits the option outside project mode', async () => {
    useProjectStore.setState({ projectPath: null, voiceIdIndex: {} } as any);

    await useEditorStore.getState().saveFile(SELF);

    const options = mockSaveFile.mock.calls[0][3] as any;
    expect(options.existingVoiceIds).toBeUndefined();
  });
});
