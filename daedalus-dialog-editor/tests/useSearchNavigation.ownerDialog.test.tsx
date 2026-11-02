/**
 * #483: a search hit on a line inside a choice function selected that function
 * and left the previously selected dialog alone, so the pane described two
 * dialogs — and showed no actions at all when the function lived in another
 * file. The hit must land on the function together with the dialog that owns
 * it, whichever file that dialog is in.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useSearchNavigation } from '../src/renderer/components/hooks/useSearchNavigation';
import { useDialogNavigation } from '../src/renderer/components/hooks/useDialogNavigation';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import type { FileState } from '../src/renderer/store/fileStore';
import type { SearchResult } from '../src/renderer/store/searchStore';

const choice = (targetFunction: string) => ({
  type: 'Choice',
  dialogRef: 'DIA_Open',
  text: 'Go on',
  targetFunction,
});

const otherDialogModel = {
  dialogs: {
    DIA_Other: { name: 'DIA_Other', parent: 'C_INFO', properties: { npc: 'NPC1', information: 'DIA_Other_Info' } },
  },
  functions: {
    DIA_Other_Info: { name: 'DIA_Other_Info', actions: [] },
  },
  hasErrors: false,
  errors: [],
} as any;

const openDialogModel = {
  dialogs: {
    DIA_Open: { name: 'DIA_Open', parent: 'C_INFO', properties: { npc: 'NPC1', information: 'DIA_Open_Info' } },
  },
  functions: {
    DIA_Open_Info: { name: 'DIA_Open_Info', actions: [choice('DIA_Open_Choice_1')] },
    DIA_Open_Choice_1: { name: 'DIA_Open_Choice_1', actions: [] },
  },
  hasErrors: false,
  errors: [],
} as any;

const bothDialogsModel = {
  dialogs: { ...otherDialogModel.dialogs, ...openDialogModel.dialogs },
  functions: { ...otherDialogModel.functions, ...openDialogModel.functions },
  hasErrors: false,
  errors: [],
} as any;

const makeFileState = (over: Partial<FileState>): FileState => ({
  filePath: 'x.d',
  semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any,
  isDirty: false,
  lastSaved: new Date(),
  ...over,
});

const hitInChoice: SearchResult = {
  type: 'text',
  name: 'DIA_Open_Choice_1',
  match: 'Go on',
  context: '[self]',
  functionName: 'DIA_Open_Choice_1',
};

function renderSearchNav(semanticModel: any) {
  const finalizeDialogSelection = jest.fn();
  const setOperationError = jest.fn();

  const { result } = renderHook(() => {
    const nav = useDialogNavigation({
      isProjectMode: false,
      selectedNPC: 'NPC1',
      selectedDialog: 'DIA_Other',
      activeNpcName: 'NPC1',
      finalizeDialogSelection,
      setIsLoadingDialog: jest.fn(),
      setOperationError,
      closeRecentDialog: jest.fn(() => null),
    });

    return useSearchNavigation({
      semanticModel,
      handleSelectNPC: nav.handleSelectNPC,
      navigateToDialogWithLoading: nav.navigateToDialogWithLoading,
      setOperationError,
    });
  });

  return { result, finalizeDialogSelection, setOperationError };
}

describe('search navigation to a function outside the selected dialog', () => {
  beforeEach(() => {
    useProjectStore.setState({ dialogIndex: new Map(), projectPath: null } as never);
    useEditorStore.setState({ autoSaveEnabled: false } as never);
    useUISelectionStore.setState({
      selectedDialog: 'DIA_Other',
      selectedFunctionName: 'DIA_Other_Info',
      activeView: 'dialog',
    } as never);
  });

  test('a choice-function hit selects its owning dialog and the function together', async () => {
    useEditorStore.setState({
      openFiles: new Map([['dia.d', makeFileState({ filePath: 'dia.d', semanticModel: bothDialogsModel })]]),
      activeFile: 'dia.d',
    } as never);

    const { result, finalizeDialogSelection, setOperationError } = renderSearchNav(bothDialogsModel);

    await act(async () => {
      await result.current.handleSearchResultClick(hitInChoice);
    });

    expect(useUISelectionStore.getState().selectedDialog).toBe('DIA_Open');
    expect(useUISelectionStore.getState().selectedFunctionName).toBe('DIA_Open_Choice_1');
    expect(finalizeDialogSelection).toHaveBeenCalledWith('DIA_Open', 'DIA_Open_Choice_1');
    expect(setOperationError).not.toHaveBeenCalledWith(expect.stringContaining('Could not find'));
  });

  test('a hit in another open file opens that file with its owning dialog selected', async () => {
    useEditorStore.setState({
      openFiles: new Map([
        ['other.d', makeFileState({ filePath: 'other.d', semanticModel: otherDialogModel })],
        ['open.d', makeFileState({ filePath: 'open.d', semanticModel: openDialogModel })],
      ]),
      activeFile: 'other.d',
    } as never);

    const { result, finalizeDialogSelection } = renderSearchNav(otherDialogModel);

    await act(async () => {
      await result.current.handleSearchResultClick(hitInChoice);
    });

    expect(useEditorStore.getState().activeFile).toBe('open.d');
    expect(useUISelectionStore.getState().selectedDialog).toBe('DIA_Open');
    expect(useUISelectionStore.getState().selectedFunctionName).toBe('DIA_Open_Choice_1');
    expect(finalizeDialogSelection).toHaveBeenCalledWith('DIA_Open', 'DIA_Open_Choice_1');
  });
});
