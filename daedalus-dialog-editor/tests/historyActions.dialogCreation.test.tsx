/**
 * Item 0.4 (code-review remediation): dialog creation must route through
 * history so the very next Ctrl+Z reverts only the creation, not fuse it
 * with whatever edit preceded it.
 *
 * Bug: ThreeColumnLayout wired useDialogFactory's `updateModel` to the raw
 * fileStore.updateModel (via useEditorStore/useFileStore), bypassing
 * historyActions entirely. That mirrors the history-aware wiring already
 * used for dialog remove/rename (historyActions.removeDialog /
 * historyActions.renameDialog) — dialog creation must follow the same
 * pattern.
 *
 * This test renders the real ThreeColumnLayout component (in single-file
 * mode) and drives dialog creation through the actual `onAddDialog` prop
 * handed to DialogTreeColumn, exercising the exact wiring path the bug
 * lives in — not just a unit test of useDialogFactory in isolation.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ThreeColumnLayout from '../src/renderer/components/ThreeColumnLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import type { SemanticModel } from '../src/renderer/types/global';

// Captures the `onAddDialog` handler ThreeColumnLayout hands to DialogTreeColumn,
// so the test can invoke it exactly as the real DialogTreeColumn "Add Dialog" UI
// would, without needing to mount and click through the heavy tree UI itself.
const mockOnAddDialogRef: { current: ((dialogName: string) => Promise<void>) | null } = { current: null };

jest.mock('../src/renderer/components/NpcColumn', () => () => null);
jest.mock('../src/renderer/components/DialogTreeColumn', () => (props: { onAddDialog: (dialogName: string) => Promise<void> }) => {
  mockOnAddDialogRef.current = props.onAddDialog;
  return null;
});
jest.mock('../src/renderer/components/EditorColumn', () => ({
  __esModule: true,
  default: React.forwardRef(() => null),
}));
jest.mock('../src/renderer/components/SearchPanel', () => () => null);
jest.mock('../src/renderer/components/SyntaxErrorsDisplay', () => () => null);
jest.mock('../src/renderer/components/DeleteDialogConfirmDialog', () => () => null);
jest.mock('../src/renderer/components/RenameDialogConfirmDialog', () => () => null);

const FILE_PATH = 'C:/project/DIA_Test.d';

const emptyModel = (): SemanticModel => ({
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, items: {}, npcs: {}, animations: {},
  hasErrors: false, errors: [],
} as SemanticModel);

describe('ThreeColumnLayout - dialog creation routes through history (item 0.4)', () => {
  beforeEach(() => {
    useFileStore.setState({
      openFiles: new Map([[FILE_PATH, {
        filePath: FILE_PATH,
        semanticModel: emptyModel(),
        isDirty: false,
        lastSaved: new Date(),
        originalCode: '',
        hasErrors: false,
        errors: [],
        validationResult: null,
      }]]),
      activeFile: FILE_PATH,
    } as never);

    useProjectStore.setState({
      projectPath: null,
      npcList: [],
      dialogIndex: new Map(),
      allDialogFiles: [],
      mergedSemanticModel: { dialogs: {}, functions: {} },
    } as never);

    useUISelectionStore.setState({
      selectedNPC: 'NPC_Test',
      selectedDialog: null,
      selectedFunctionName: null,
    } as never);

    useHistoryStore.setState({
      editHistory: new Map(),
    } as never);

    mockOnAddDialogRef.current = null;
  });

  const getModel = () => useFileStore.getState().getFileState(FILE_PATH)?.semanticModel;

  test('creating a dialog pushes its own undo snapshot instead of fusing with the prior edit', async () => {
    render(<ThreeColumnLayout filePath={FILE_PATH} />);

    expect(mockOnAddDialogRef.current).not.toBeNull();
    expect(useHistoryStore.getState().canUndo(FILE_PATH)).toBe(false);

    await act(async () => {
      await mockOnAddDialogRef.current!('DIA_Test_New');
    });

    // The dialog was actually created in the model.
    expect(Object.keys(getModel()?.dialogs || {})).toContain('DIA_Test_New');

    // Creating the dialog must have pushed its own undo snapshot. Before the
    // fix, ThreeColumnLayout wired useDialogFactory to the raw
    // fileStore.updateModel (bypassing historyActions), so no snapshot was
    // pushed here and this assertion fails.
    expect(useHistoryStore.getState().canUndo(FILE_PATH)).toBe(true);

    act(() => {
      useHistoryStore.getState().undo(FILE_PATH);
    });

    // Undo reverts exactly the dialog creation, nothing more.
    expect(getModel()?.dialogs['DIA_Test_New']).toBeUndefined();
  });
});
