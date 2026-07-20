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

const SELF = 'C:/mod/DIA_Self.d';
const OTHER = 'C:/mod/DIA_Other.d';

const model = { dialogs: {}, functions: {}, hasErrors: false, errors: [] };

const openSelf = () => {
  useEditorStore.setState({
    openFiles: new Map([[SELF, {
      filePath: SELF,
      semanticModel: model,
      isDirty: true,
      lastSaved: new Date(),
    }]]),
    activeFile: SELF,
    pendingValidation: null,
  } as any);
};

describe('saveFile existingVoiceIds option', () => {
  beforeEach(() => {
    mockSaveFile.mockReset();
    mockSaveFile.mockResolvedValue({
      success: true,
      validationResult: { isValid: true, errors: [], warnings: [] },
    } as any);
    openSelf();
  });

  test('excludes the saved file\'s own entries and drops self-only ids', async () => {
    useProjectStore.setState({
      projectPath: 'C:/mod',
      voiceIdIndex: {
        DIA_X_15_00: [
          { filePath: SELF, functionName: 'DIA_Self_Info' },
          { filePath: OTHER, functionName: 'DIA_Other_Info' },
        ],
        DIA_Y_15_01: [
          { filePath: SELF, functionName: 'DIA_Self_Choice' },
        ],
      },
    } as any);

    await useEditorStore.getState().saveFile(SELF);

    expect(mockSaveFile).toHaveBeenCalledTimes(1);
    const options = mockSaveFile.mock.calls[0][3] as any;
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
