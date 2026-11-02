/**
 * A save from the routine editor, the quest diary or the NPC editor is an edit
 * like any other: it must push its history snapshot before it replaces the
 * model. Calling `fileStore.updateModel` directly reached disk without one, so
 * the newest snapshot stayed an older, unrelated model — and the next Ctrl+Z
 * restored that, which auto-save then wrote to disk (#452).
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { seedMockFile, resetMockFileSystem } from '../src/renderer/utils/mockAPI';
import { saveRoutine, createRoutine } from '../src/renderer/components/routineSave';
import { readRoutine } from '../src/renderer/routines/routineEntries';
import { saveDiaryEntryText } from '../src/renderer/components/questDiarySave';
import NpcEditorDialog from '../src/renderer/components/NpcEditorDialog';

// The bind-pose preview is a three.js view with nothing to do with the save.
jest.mock('../src/renderer/components/NpcVisualPreview', () => ({
  __esModule: true,
  default: () => null,
}));

const layouts = { TA_SLEEP: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 } };

const source = `INSTANCE NPC_TEST (C_NPC)
{
	id = 11;
	name = "Test";
	daily_routine = Rtn_Start_10;
};

FUNC VOID Rtn_Start_10 ()
{
	TA_Sleep (22,00,07,00,"BED");
};

FUNC VOID DIA_Test_Info ()
{
	AI_Output (self, other, "DIA_TEST_15_00");
	Log_CreateTopic ("MIS_TEST", LOG_MISSION);
	Log_AddEntry ("MIS_TEST", "An entry");
};
`;

beforeEach(() => {
  resetMockFileSystem();
  useEditorStore.setState({ openFiles: new Map(), activeFile: null } as never);
  useHistoryStore.setState({ editHistory: new Map() } as never);
  useProjectStore.setState({
    npcFileIndex: { NPC_TEST: 'test.d' },
    routineSiteIndex: [{ routine: 'RTN_START_10', filePath: 'test.d' }],
    routineLayoutIndex: layouts,
  } as never);
  jest.spyOn(useProjectStore.getState(), 'reindexFiles').mockResolvedValue(new Map());
});

describe('a surface save records one undo step', () => {
  test('saveRoutine (#452)', async () => {
    seedMockFile('test.d', source);
    await useEditorStore.getState().openFile('test.d');
    const before = useEditorStore.getState().getFileState('test.d')!.semanticModel;
    const read = readRoutine(before.functions.Rtn_Start_10.actions, layouts);

    await saveRoutine('test.d', 'Rtn_Start_10', [
      { state: 'TA_Sleep', startMinute: 22 * 60, endMinute: 7 * 60, waypoint: 'BED2' },
    ], read);

    const after = useEditorStore.getState().getFileState('test.d')!.semanticModel;
    expect(after).not.toBe(before);
    const history = useHistoryStore.getState().editHistory.get('test.d')!;
    expect(history.past.map((snapshot) => snapshot.model)).toEqual([before]);
    expect(history.future).toEqual([]);

    useHistoryStore.getState().undo('test.d');
    expect(useEditorStore.getState().getFileState('test.d')!.semanticModel).toBe(before);
  });

  test('createRoutine (#452)', async () => {
    seedMockFile('test.d', source);
    await useEditorStore.getState().openFile('test.d');
    const before = useEditorStore.getState().getFileState('test.d')!.semanticModel;

    await createRoutine('NPC_TEST', null, [
      { state: 'TA_Sleep', startMinute: 22 * 60, endMinute: 7 * 60, waypoint: 'BED2' },
    ]);

    const after = useEditorStore.getState().getFileState('test.d')!.semanticModel;
    expect(after).not.toBe(before);
    const history = useHistoryStore.getState().editHistory.get('test.d')!;
    expect(history.past.map((snapshot) => snapshot.model)).toEqual([before]);

    useHistoryStore.getState().undo('test.d');
    expect(useEditorStore.getState().getFileState('test.d')!.semanticModel).toBe(before);
  });

  test('saveDiaryEntryText (#452)', async () => {
    seedMockFile('test.d', source);
    // The mock parser reads no `Log_AddEntry`, so the diary's function is
    // handed to the store as the parsed model the quest page works from.
    const built = {
      dialogs: {},
      functions: {
        DIA_Test_Info: {
          name: 'DIA_Test_Info',
          returnType: 'VOID',
          calls: [],
          actions: [{ type: 'LogEntry', topic: 'MIS_TEST', text: 'An entry' }],
        },
      },
      hasErrors: false,
      errors: [],
    } as never;
    await useEditorStore.getState().openFile('test.d', { model: built });
    const before = useEditorStore.getState().getFileState('test.d')!.semanticModel;

    await saveDiaryEntryText(
      {
        kind: 'entry',
        functionName: 'DIA_Test_Info',
        filePath: 'test.d',
        path: [0],
        text: 'An entry',
        editable: true,
      },
      'A rewritten entry',
    );

    const after = useEditorStore.getState().getFileState('test.d')!.semanticModel;
    expect(after).not.toBe(before);
    const history = useHistoryStore.getState().editHistory.get('test.d')!;
    expect(history.past.map((snapshot) => snapshot.model)).toEqual([before]);

    useHistoryStore.getState().undo('test.d');
    expect(useEditorStore.getState().getFileState('test.d')!.semanticModel).toBe(before);
  });

  test('the NPC editor save (#452)', async () => {
    seedMockFile('test.d', source);
    await useEditorStore.getState().openFile('test.d');
    const before = useEditorStore.getState().getFileState('test.d')!.semanticModel;
    const onClose = jest.fn();

    render(<NpcEditorDialog npcName="NPC_TEST" filePath="test.d" onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const after = useEditorStore.getState().getFileState('test.d')!.semanticModel;
    expect(after).not.toBe(before);
    const history = useHistoryStore.getState().editHistory.get('test.d')!;
    expect(history.past.map((snapshot) => snapshot.model)).toEqual([before]);

    useHistoryStore.getState().undo('test.d');
    expect(useEditorStore.getState().getFileState('test.d')!.semanticModel).toBe(before);
  });
});
