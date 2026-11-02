import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { resetMockFileSystem, seedMockFile } from '../src/renderer/utils/mockAPI';
import NpcEditorDialog from '../src/renderer/components/NpcEditorDialog';

/**
 * #490: the form computes its edits from the body it read when it opened, and
 * the equipment and overlay edits are addressed by occurrence — so a body that
 * gained an `EquipItem` since then would take the change onto the wrong call.
 * The save must refuse, and keep what was typed.
 */

// The bind-pose preview is a three.js view with nothing to do with the save.
jest.mock('../src/renderer/components/NpcVisualPreview', () => ({
  __esModule: true,
  default: () => null,
}));

const source = `INSTANCE NPC_TEST (C_NPC)
{
	id = 11;
	name = "Test";
	EquipItem (self, ItMw_1H_Sword);
	EquipItem (self, ItRw_Bow);
};
`;

beforeEach(() => {
  resetMockFileSystem();
  useEditorStore.setState({ openFiles: new Map(), activeFile: null } as never);
  useHistoryStore.setState({ editHistory: new Map() } as never);
  useProjectStore.setState({
    npcFileIndex: { NPC_TEST: 'test.d' },
    // A second melee weapon to choose from, so the control has the option.
    parsedFiles: new Map([['Items.d', {
      filePath: 'Items.d',
      lastParsed: new Date(),
      semanticModel: {
        items: { ItMw_2H_Axe: { sourceText: 'mainflag = ITEM_KAT_NF;' } },
        constants: {},
      },
    }]]),
  } as never);
  seedMockFile('test.d', source);
});

it('refuses a save when the body gained an EquipItem since the form read it', async () => {
  await useEditorStore.getState().openFile('test.d');
  const onClose = jest.fn();
  render(<NpcEditorDialog npcName="NPC_TEST" filePath="test.d" onClose={onClose} />);

  const melee = await screen.findByLabelText('Melee weapon');
  fireEvent.change(melee, { target: { value: 'ItMw_2H_Axe' } });
  fireEvent.click(await screen.findByRole('option', { name: 'ItMw_2H_Axe' }));
  expect(melee).toHaveValue('ItMw_2H_Axe');

  // Meanwhile the script gained a dagger ahead of the sword — the occurrence
  // the form's edit names is now the dagger.
  const state = useEditorStore.getState();
  const fileState = state.getFileState('test.d')!;
  const model = fileState.semanticModel;
  const instance = model.instances!.NPC_TEST;
  const moved = {
    ...instance,
    sourceText: instance.sourceText!.replace(
      'EquipItem (self, ItMw_1H_Sword);',
      'EquipItem (self, ItMw_Dagger);\n\tEquipItem (self, ItMw_1H_Sword);',
    ),
  };
  useEditorStore.setState({
    openFiles: new Map(state.openFiles).set('test.d', {
      ...fileState,
      semanticModel: { ...model, instances: { ...model.instances, NPC_TEST: moved } },
    }),
  } as never);
  const apply = jest.spyOn(window.editorAPI, 'applyNpcEdits');

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/changed since the NPC editor read it/);
  expect(apply).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Melee weapon')).toHaveValue('ItMw_2H_Axe');
});
