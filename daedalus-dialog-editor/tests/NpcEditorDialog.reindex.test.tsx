import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { resetMockFileSystem, seedMockFile } from '../src/renderer/utils/mockAPI';
import NpcEditorDialog from '../src/renderer/components/NpcEditorDialog';

/**
 * #492: an NPC-editor save writes the file, and the watcher suppresses the
 * editor's own write — so without a re-index the routine facts the form changed
 * (`daily_routine`, and with it the Routines section, the routine editor and the
 * World surface's routine lens) stay as they were when the project opened.
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
	daily_routine = Rtn_Start_11;
};
`;

beforeEach(() => {
  resetMockFileSystem();
  useEditorStore.setState({ openFiles: new Map(), activeFile: null } as never);
  useHistoryStore.setState({ editHistory: new Map() } as never);
  useProjectStore.setState({
    npcList: ['NPC_TEST'],
    npcFileIndex: { NPC_TEST: 'test.d' },
    npcIdIndex: { NPC_TEST: 11 },
    routineNpcIndex: { NPC_TEST: 'RTN_START_11' },
    routineList: ['RTN_START_11', 'RTN_FARM_11'],
    routineSiteIndex: [],
    dialogIndex: new Map(),
  } as never);
  seedMockFile('test.d', source);
});

it('re-indexes the file it saved, so a changed daily routine is current', async () => {
  await useEditorStore.getState().openFile('test.d');
  render(<NpcEditorDialog npcName="NPC_TEST" filePath="test.d" onClose={jest.fn()} />);

  const daily = await screen.findByLabelText('Daily routine');
  fireEvent.focus(daily);
  fireEvent.click(await screen.findByRole('option', { name: 'RTN_FARM_11' }));
  expect(daily).toHaveValue('RTN_FARM_11');

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  // The save wrote the change — so a re-index reads it).
  await waitFor(async () => {
    expect(await window.editorAPI.readFile('test.d')).toContain('daily_routine = RTN_FARM_11;');
  });
  await waitFor(() => {
    expect(useProjectStore.getState().routineNpcIndex).toEqual({ NPC_TEST: 'RTN_FARM_11' });
  });
});
