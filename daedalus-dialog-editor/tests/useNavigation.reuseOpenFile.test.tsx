/**
 * #377: symbol navigation must not reload a file that is already open. Calling
 * `openFile` on an open file re-reads disk, replaces the unsaved model and marks
 * it clean — navigation reuses the open state via `setActiveFile` instead, as
 * useDialogNavigation already does.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useNavigation } from '../src/renderer/hooks/useNavigation';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import type { FileState } from '../src/renderer/store/fileStore';

const mockReadFile = jest.spyOn(window.editorAPI, 'readFile');
const mockParseSource = jest.spyOn(window.editorAPI, 'parseSource');

const modelWithVariable = (value: number) => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: { TEST: { name: 'TEST', type: 'int', value, filePath: 'vars.d' } },
  instances: {},
  hasErrors: false,
  errors: [],
}) as any;

const makeFileState = (over: Partial<FileState>): FileState => ({
  filePath: 'x.d',
  semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any,
  isDirty: false,
  lastSaved: new Date(),
  ...over,
});

describe('useNavigation reuses already-open files', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockParseSource.mockReset();
    mockReadFile.mockResolvedValue('var int TEST = 1;');
    mockParseSource.mockResolvedValue(modelWithVariable(1));
    useProjectStore.setState({ dialogIndex: new Map(), projectPath: null } as never);
    useUISelectionStore.setState({ activeView: 'dialog' } as never);
    useEditorStore.setState({ autoSaveEnabled: false } as never);
  });

  test('navigateToSymbol to a variable in an open dirty file keeps the edit and isDirty', async () => {
    const dirtyModel = modelWithVariable(2);
    useEditorStore.setState({
      openFiles: new Map([
        ['vars.d', makeFileState({ filePath: 'vars.d', semanticModel: dirtyModel, isDirty: true, originalCode: 'var int TEST = 1;' })],
      ]),
      activeFile: 'vars.d',
    } as never);

    const { result } = renderHook(() => useNavigation());
    await act(async () => {
      await result.current.navigateToSymbol('TEST', { kind: 'variable' });
    });

    const fileState = useEditorStore.getState().getFileState('vars.d');
    expect(mockReadFile).not.toHaveBeenCalled();
    expect((fileState?.semanticModel.variables as any).TEST.value).toBe(2);
    expect(fileState?.isDirty).toBe(true);
    expect(useUISelectionStore.getState().activeView).toBe('variable');
  });

  test('navigateToDialog to an open but inactive dirty file activates it without reloading', async () => {
    const dirtyModel = { dialogs: { DIA_Kept: {} }, functions: {}, hasErrors: false, errors: [] } as any;
    useProjectStore.setState({
      dialogIndex: new Map([['NPC1', [{ dialogName: 'DIA_Kept', npc: 'NPC1', filePath: 'dia.d' }]]]),
    } as never);
    useEditorStore.setState({
      openFiles: new Map([
        ['dia.d', makeFileState({ filePath: 'dia.d', semanticModel: dirtyModel, isDirty: true })],
        ['other.d', makeFileState({ filePath: 'other.d' })],
      ]),
      activeFile: 'other.d',
    } as never);

    const { result } = renderHook(() => useNavigation());
    await act(async () => {
      await result.current.navigateToDialog('DIA_Kept');
    });

    const fileState = useEditorStore.getState().getFileState('dia.d');
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().activeFile).toBe('dia.d');
    expect(fileState?.semanticModel).toBe(dirtyModel);
    expect(fileState?.isDirty).toBe(true);
  });

  test('navigateToSymbol to a function in a file that is not open still opens it', async () => {
    mockParseSource.mockResolvedValue({ dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any);
    useEditorStore.setState({
      openFiles: new Map([
        ['a.d', makeFileState({
          filePath: 'a.d',
          semanticModel: { dialogs: {}, functions: { Helper: { name: 'Helper', filePath: 'b.d' } }, hasErrors: false, errors: [] } as any,
        })],
      ]),
      activeFile: 'a.d',
    } as never);

    const { result } = renderHook(() => useNavigation());
    await act(async () => {
      await result.current.navigateToSymbol('Helper', { kind: 'function' });
    });

    expect(mockReadFile).toHaveBeenCalledWith('b.d');
    expect(useEditorStore.getState().activeFile).toBe('b.d');
  });
});
