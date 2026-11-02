import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { resetMockFileSystem, seedMockFile } from '../src/renderer/utils/mockAPI';
import { RoutineEditorPanel } from '../src/renderer/components/RoutineEditor';

/**
 * #489: the panel's draft is addressed by action index, and the model is read
 * again at save. A line that appeared in the function in the meantime shifts
 * those indices, so the save must refuse — and say so where the panel already
 * shows errors — instead of overwriting one activity and deleting another.
 */

const source = `INSTANCE NPC_TEST (C_NPC)
{
	id = 11;
	daily_routine = Rtn_Start_11;
};

FUNC VOID Rtn_Start_11 ()
{
	TA_Sit_Throne (07,00,22,00,"WP_SIT");
	TA_Sleep (22,00,07,00,"WP_BED");
};
`;

const layouts = {
  TA_SIT_THRONE: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 },
  TA_SLEEP: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 },
  TA_STAND_GUARDING: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 },
};

beforeEach(() => {
  resetMockFileSystem();
  useEditorStore.setState({ openFiles: new Map(), activeFile: null } as never);
  useHistoryStore.setState({ editHistory: new Map() } as never);
  useProjectStore.setState({
    npcFileIndex: { NPC_TEST: 'test.d' },
    routineNpcIndex: { NPC_TEST: 'RTN_START_11' },
    routineSiteIndex: [{ routine: 'RTN_START_11', filePath: 'test.d' }],
    routineLayoutIndex: layouts,
  } as never);
  seedMockFile('test.d', source);
});

it('refuses a save when the routine gained a line since the panel read it', async () => {
  const onDone = jest.fn();
  render(<RoutineEditorPanel npc="NPC_TEST" onDone={onDone} />);

  const row = await screen.findByRole('group', { name: 'Activity 1' });
  const waypoint = within(row).getByLabelText('Waypoint');
  fireEvent.change(waypoint, { target: { value: 'WP_SIT_2' } });
  fireEvent.blur(waypoint);

  // Someone else writes the function while the panel holds its draft.
  const state = useEditorStore.getState();
  const fileState = state.getFileState('test.d')!;
  const model = fileState.semanticModel;
  const fn = model.functions.Rtn_Start_11;
  const moved = {
    ...model,
    functions: {
      ...model.functions,
      Rtn_Start_11: {
        ...fn,
        actions: [{ type: 'Action', action: 'TA_Stand_Guarding (06,00,07,00,"WP_GUARD")' }, ...fn.actions] as typeof fn.actions,
      },
    },
  };
  useEditorStore.setState({
    openFiles: new Map(state.openFiles).set('test.d', { ...fileState, semanticModel: moved }),
  } as never);

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/changed since it was opened/);
  expect(onDone).not.toHaveBeenCalled();
  expect(within(screen.getByRole('group', { name: 'Activity 1' })).getByLabelText('Waypoint'))
    .toHaveValue('WP_SIT_2');
  expect(useEditorStore.getState().getFileState('test.d')!.semanticModel).toBe(moved);
});
