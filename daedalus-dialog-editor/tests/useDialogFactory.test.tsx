/**
 * Issue #141 follow-up: the "Add NPC" button was removed because
 * createNpcInstanceTemplate generated NPC instances with incorrect
 * parameters, but the same generation stayed reachable through the ordinary
 * "Add Dialog" flow whenever the selected NPC's C_NPC instance was not in
 * the semantic model. Creating a dialog must never write an NPC instance
 * file or fabricate an instance in the model.
 */
import { renderHook } from '@testing-library/react';
import { useDialogFactory } from '../src/renderer/components/hooks/useDialogFactory';

const FILE = 'C:/project/DIA_Test.d';

const emptyModel = () => ({
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, items: {}, npcs: {}, animations: {},
  hasErrors: false, errors: []
});

describe('useDialogFactory.createDialogForNpc', () => {
  test('does not create an NPC instance file when the NPC has no instance', async () => {
    const readFile = jest.spyOn(window.editorAPI, 'readFile')
      .mockRejectedValue(new Error('File not found'));
    const writeFile = jest.spyOn(window.editorAPI, 'writeFile')
      .mockResolvedValue({ success: true } as any);
    const updateModel = jest.fn();
    const model = emptyModel();

    const { result } = renderHook(() =>
      useDialogFactory({
        projectPath: null,
        activeFile: FILE,
        filePath: FILE,
        allDialogFiles: [FILE],
        isProjectMode: false,
        semanticModel: model as any,
        dialogIndex: new Map(),
        selectedNPC: 'PC_Fremder',
        openFile: jest.fn(),
        getFileState: () => ({ semanticModel: model as any }),
        updateModel,
        addDialogToIndex: jest.fn(),
        selectNpc: jest.fn(),
        loadAndMergeNpcModels: jest.fn(),
        setSelectedNPC: jest.fn(),
        onDialogCreated: jest.fn()
      })
    );

    await result.current.createDialogForNpc('PC_Fremder', 'DIA_Fremder_Hello');

    // No NPC_<token>.d is written (nor any other file in single-file mode)
    expect(writeFile).not.toHaveBeenCalled();

    // The model gains the dialog but no fabricated NPC instance
    const updated = updateModel.mock.calls[0][1];
    expect(updated.dialogs.DIA_Fremder_Hello).toBeDefined();
    expect(updated.instances).toEqual({});
    expect(updated.npcs).toEqual({});

    readFile.mockRestore();
    writeFile.mockRestore();
  });
});
