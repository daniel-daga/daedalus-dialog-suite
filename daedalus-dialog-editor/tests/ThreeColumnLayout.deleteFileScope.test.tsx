/**
 * #485: the delete confirmation was computed on the merged project model and
 * applied to the active file's model. A function another file's dialog also
 * targets was therefore kept in the preview and deleted by the store, and a
 * dialog that lives in another file made delete a silent no-op.
 *
 * Renders the real layout and the real confirmation dialog, and opens the
 * delete from the same prop `EditorColumn` receives, so the assertion is about
 * what the user is promised and what the store then does.
 */
import React from 'react';
import { describe, test, expect, beforeEach } from '@jest/globals';
import { render, act, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ThreeColumnLayout from '../src/renderer/components/ThreeColumnLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import type { SemanticModel } from '../src/renderer/types/global';

const mockEditorColumnProps: { current: { onDeleteDialog: (dialogName: string) => void } | null } = {
  current: null,
};

jest.mock('../src/renderer/components/NpcColumn', () => () => null);
jest.mock('../src/renderer/components/DialogTreeColumn', () => () => null);
jest.mock('../src/renderer/components/EditorColumn', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  return {
    __esModule: true,
    default: ReactActual.forwardRef((props: never, _ref: React.ForwardedRef<unknown>) => {
      mockEditorColumnProps.current = props;
      return null;
    }),
  };
});
jest.mock('../src/renderer/components/SearchPanel', () => () => null);
jest.mock('../src/renderer/components/SyntaxErrorsDisplay', () => () => null);
jest.mock('../src/renderer/components/RenameDialogConfirmDialog', () => () => null);

const ACTIVE = 'C:/mod/DIA_Own.d';
const OTHER = 'C:/mod/DIA_Other.d';

const dialog = (name: string, information: string) => ({
  name,
  parent: 'C_INFO',
  properties: { npc: 'NPC_A', information },
});
const fn = (name: string, actions: any[] = []) => ({ name, returnType: 'VOID', actions, conditions: [], calls: [] });
const choice = (targetFunction: string) => ({ type: 'Choice', text: 'go', targetFunction });
const knowsInfo = (dialogRef: string) => ({ type: 'NpcKnowsInfoCondition', npc: 'other', dialogRef });

const modelWith = (dialogs: unknown, functions: unknown): SemanticModel => ({
  dialogs,
  functions,
  constants: {},
  variables: {},
  instances: {},
  items: {},
  npcs: {},
  animations: {},
  hasErrors: false,
  errors: [],
}) as never;

const fileState = (filePath: string, semanticModel: SemanticModel) => ({
  filePath,
  semanticModel,
  isDirty: false,
  lastSaved: new Date(),
  originalCode: '',
  hasErrors: false,
  errors: [],
  validationResult: null,
});

// Declared in the active file, targeted by a dialog in each file: the merged
// preview keeps it, the file the store rewrites deletes it.
const activeModel = () =>
  modelWith(
    { DIA_A: dialog('DIA_A', 'DIA_A_Info') },
    {
      DIA_A_Info: fn('DIA_A_Info', [choice('SHARED_BRANCH')]),
      SHARED_BRANCH: fn('SHARED_BRANCH'),
    }
  );
const otherModel = () =>
  modelWith(
    { DIA_B: dialog('DIA_B', 'DIA_B_Info') },
    {
      DIA_B_Info: {
        ...fn('DIA_B_Info', [choice('SHARED_BRANCH')]),
        conditions: [knowsInfo('DIA_A')],
      },
    }
  );

const activeFunctions = () => useFileStore.getState().openFiles.get(ACTIVE)!.semanticModel.functions;

describe('ThreeColumnLayout - #485 delete preview is computed on the file the store writes', () => {
  beforeEach(() => {
    mockEditorColumnProps.current = null;

    const own = activeModel();
    const other = otherModel();

    useProjectStore.setState({
      projectPath: '/mod',
      npcList: ['NPC_A'],
      dialogIndex: new Map([['NPC_A', [
        { dialogName: 'DIA_A', npc: 'NPC_A', filePath: ACTIVE },
        { dialogName: 'DIA_B', npc: 'NPC_A', filePath: OTHER },
      ]]]),
      allDialogFiles: [ACTIVE, OTHER],
      mergedSemanticModel: modelWith({ ...own.dialogs, ...other.dialogs }, { ...own.functions, ...other.functions }),
      parsedFiles: new Map([
        [ACTIVE, { filePath: ACTIVE, semanticModel: own, lastParsed: new Date() }],
        [OTHER, { filePath: OTHER, semanticModel: other, lastParsed: new Date() }],
      ]),
    } as never);
    useFileStore.setState({
      openFiles: new Map([[ACTIVE, fileState(ACTIVE, own)], [OTHER, fileState(OTHER, other)]]),
      activeFile: ACTIVE,
    } as never);
    useUISelectionStore.setState({
      selectedNPC: 'NPC_A',
      selectedDialog: 'DIA_A',
      selectedFunctionName: null,
    } as never);
    useHistoryStore.setState({ editHistory: new Map() } as never);
  });

  test('the confirmation lists every function the store then deletes', () => {
    render(<ThreeColumnLayout filePath={ACTIVE} />);

    act(() => {
      mockEditorColumnProps.current!.onDeleteDialog('DIA_A');
    });

    // Both are owned by DIA_A in this file. The merged model would keep
    // SHARED_BRANCH alive because DIA_B (another file) also targets it.
    expect(screen.getByText('DIA_A_Info')).toBeInTheDocument();
    expect(screen.getByText('SHARED_BRANCH')).toBeInTheDocument();
    // The other file's Npc_KnowsInfo consumer is still warned about: that
    // damage is project-wide even though the delete is not.
    expect(screen.getByText('DIA_B_Info')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const functions = activeFunctions();
    expect(functions.DIA_A_Info).toBeUndefined();
    expect(functions.SHARED_BRANCH).toBeUndefined();
    expect(useFileStore.getState().openFiles.get(ACTIVE)!.semanticModel.dialogs.DIA_A).toBeUndefined();
    // The other file is not the store's business: its dialog and its choice
    // target name are untouched.
    expect(useFileStore.getState().openFiles.get(OTHER)!.semanticModel.dialogs.DIA_B).toBeDefined();
  });

  test('a dialog declared in another file is refused with a message, not silently ignored', () => {
    useUISelectionStore.setState({ selectedDialog: 'DIA_B' } as never);
    render(<ThreeColumnLayout filePath={ACTIVE} />);

    act(() => {
      mockEditorColumnProps.current!.onDeleteDialog('DIA_B');
    });

    expect(screen.queryByText('Delete Dialog')).toBeNull();
    expect(screen.getByText(/not declared in the active file/)).toBeInTheDocument();
    expect(useFileStore.getState().openFiles.get(OTHER)!.semanticModel.dialogs.DIA_B).toBeDefined();
  });
});
