/**
 * #484: renaming a dialog rewrites one file's model, so any other file's
 * `Npc_KnowsInfo(other, DIA_Old)` stops naming anything — silently. The rename
 * confirmation carries a `crossFileWarnings` list for exactly this, but its only
 * producer passed `[]`.
 *
 * Renders the real layout and the real confirmation dialog, and opens the
 * rename from the same prop `EditorColumn` receives, so the assertion is about
 * what the user is actually shown.
 */
import React from 'react';
import { describe, test, expect, beforeEach } from '@jest/globals';
import { render, act, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ThreeColumnLayout from '../src/renderer/components/ThreeColumnLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import type { SemanticModel } from '../src/renderer/types/global';

const mockEditorColumnProps: { current: { onRenameDialog: (dialogName: string) => void } | null } = {
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
jest.mock('../src/renderer/components/DeleteDialogConfirmDialog', () => () => null);

const ACTIVE = 'C:/mod/DIA_Own.d';
const OTHER = 'C:/mod/DIA_Other.d';

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

describe('ThreeColumnLayout - #484 rename lists files whose Npc_KnowsInfo names the dialog', () => {
  const dialog = { name: 'DIA_Old', properties: { npc: 'NPC_A' } };

  beforeEach(() => {
    mockEditorColumnProps.current = null;

    // The renamed dialog's own file: its info function checks the dialog too.
    const activeModel = modelWith(
      { DIA_Old: dialog },
      { DIA_Old_Info: { name: 'DIA_Old_Info', conditions: [{ type: 'NpcKnowsInfoCondition', npc: 'other', dialogRef: 'DIA_Old' }] } }
    );
    // Another file that knows the dialog by the name being renamed.
    const otherModel = modelWith(
      {},
      { DIA_Other_Info: { name: 'DIA_Other_Info', conditions: [{ type: 'NpcKnowsInfoCondition', npc: 'NPC_A', dialogRef: 'DIA_Old' }] } }
    );

    useProjectStore.setState({
      projectPath: '/mod',
      npcList: ['NPC_A'],
      dialogIndex: new Map([['NPC_A', [{ dialogName: 'DIA_Old', npc: 'NPC_A', filePath: ACTIVE }]]]),
      allDialogFiles: [ACTIVE, OTHER],
      mergedSemanticModel: modelWith(
        { ...activeModel.dialogs },
        { ...activeModel.functions, ...otherModel.functions }
      ),
      parsedFiles: new Map([
        [ACTIVE, { filePath: ACTIVE, semanticModel: activeModel, lastParsed: new Date() }],
        [OTHER, { filePath: OTHER, semanticModel: otherModel, lastParsed: new Date() }],
      ]),
    } as never);
    useUISelectionStore.setState({
      selectedNPC: 'NPC_A',
      selectedDialog: 'DIA_Old',
      selectedFunctionName: null,
    } as never);
    useFileStore.setState({ openFiles: new Map(), activeFile: ACTIVE } as never);
  });

  test('the other file is named in the warning, the renamed file itself is not', () => {
    render(<ThreeColumnLayout filePath={null} />);

    act(() => {
      mockEditorColumnProps.current!.onRenameDialog('DIA_Old');
    });

    expect(screen.getByText('References in the following files will need manual update:')).toBeInTheDocument();
    expect(screen.getByText(OTHER)).toBeInTheDocument();
    // The store rewrites the renamed file itself; warning about it would be noise.
    expect(screen.queryByText(ACTIVE)).toBeNull();
  });
});
