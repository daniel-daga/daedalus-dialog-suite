/**
 * Condition saving (U6 / N4).
 *
 * Two guards:
 *   1. Regression pin — the updater-based edit flow (`updateDialogConditionFunction`
 *      + `updateDialogWithNormalizedProperties` + `updateFunction`, exactly as
 *      `useDialogEditorCommands` dispatches them) preserves every interleaved
 *      edit. This is green today; it locks in that the stale-whole-model-closure
 *      class of bug (the old `[BUG DEMO]`) cannot regress.
 *   2. Debounce-vs-save (N4) — an edit still pending in the 300 ms condition
 *      debounce when the user hits Save must be serialized. Red before the
 *      `flushAllPendingEdits()` save-entry wiring, green after.
 */

import { describe, test, expect, beforeEach, jest, afterEach } from '@jest/globals';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEditorStore } from '../src/renderer/store/editorStore';
import * as historyActions from '../src/renderer/store/historyActions';
import ConditionEditor from '../src/renderer/components/ConditionEditor';
import { useDialogEditorCommands } from '../src/renderer/components/hooks/useDialogEditorCommands';

const FILE_PATH = 'conditions.d';
const DIALOG_NAME = 'TestDialog';

const seedModel = () => ({
  dialogs: {
    [DIALOG_NAME]: {
      properties: {
        npc: 'TestNPC',
        information: 'TestInfo',
        condition: 'TestCondition',
      },
    },
  },
  functions: {
    TestInfo: {
      name: 'TestInfo',
      returnType: 'VOID',
      actions: [],
      conditions: [],
      calls: [],
    },
    TestCondition: {
      name: 'TestCondition',
      returnType: 'INT',
      actions: [],
      conditions: [
        { type: 'VariableCondition', variableName: 'ORIGINAL', negated: false },
      ],
      calls: [],
    },
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
});

const seedStore = () => {
  useEditorStore.setState({
    openFiles: new Map([[FILE_PATH, {
      filePath: FILE_PATH,
      semanticModel: seedModel(),
      isDirty: false,
      lastSaved: new Date(),
    }]]),
    activeFile: FILE_PATH,
    codeSettings: {
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: true,
    },
  } as any);
};

const getModel = () => useEditorStore.getState().getFileState(FILE_PATH)!.semanticModel as any;

describe('Condition saving — regression pin (updater flow)', () => {
  beforeEach(() => {
    seedStore();
  });

  test('interleaved condition / dialog / function edits are all preserved', () => {
    // Exactly the three mutations useDialogEditorCommands dispatches, interleaved.
    act(() => {
      historyActions.updateDialogConditionFunction(FILE_PATH, DIALOG_NAME, (fn) => ({
        ...fn,
        conditions: [{ type: 'VariableCondition', variableName: 'MODIFIED', negated: true }],
      }));
    });

    act(() => {
      historyActions.updateDialogWithNormalizedProperties(FILE_PATH, DIALOG_NAME, (dialog) => ({
        ...dialog,
        properties: { ...dialog.properties, description: 'Updated description' },
      }));
    });

    act(() => {
      historyActions.updateFunction(FILE_PATH, 'TestInfo', {
        name: 'TestInfo',
        returnType: 'VOID',
        actions: [{ type: 'DialogLine', speaker: 'hero', text: 'New line' }],
        conditions: [],
        calls: [],
      } as any);
    });

    const model = getModel();
    expect(model.functions.TestCondition.conditions[0].variableName).toBe('MODIFIED');
    expect(model.dialogs.TestDialog.properties.description).toBe('Updated description');
    expect(model.functions.TestInfo.actions).toHaveLength(1);
  });
});

/**
 * Harness: wires ConditionEditor's condition edits and a Save button through the
 * real `useDialogEditorCommands` hook, mirroring the shipped DialogDetailsEditor
 * plumbing (handleConditionFunctionUpdate → updateDialogConditionFunction;
 * handleSave → store.saveFile).
 */
const ConditionSaveHarness: React.FC = () => {
  const saveFile = useEditorStore((s) => s.saveFile);
  const model = useEditorStore((s) => s.getFileState(FILE_PATH)?.semanticModel);
  const commands = useDialogEditorCommands({
    dialogName: DIALOG_NAME,
    filePath: FILE_PATH,
    currentFunctionName: 'TestInfo',
    saveFile: saveFile as any,
    setIsSaving: () => {},
    setIsResetting: () => {},
    setSnackbar: () => {},
    setValidationDialog: () => {},
  });

  return (
    <div>
      <ConditionEditor
        conditionFunction={(model as any).functions.TestCondition}
        onUpdateFunction={commands.handleConditionFunctionUpdate}
        filePath={FILE_PATH}
        dialogName={DIALOG_NAME}
      />
      <button onClick={() => commands.handleSave()}>Save</button>
    </div>
  );
};

describe('Condition saving — debounce vs save (N4)', () => {
  let saveSpy: jest.SpiedFunction<typeof window.editorAPI.saveFile>;

  beforeEach(() => {
    jest.useFakeTimers();
    seedStore();
    saveSpy = jest.spyOn(window.editorAPI, 'saveFile');
    saveSpy.mockResolvedValue({ success: true } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    saveSpy.mockRestore();
  });

  test('a condition edit pending in the 300 ms debounce is serialized on Save', async () => {
    render(<ConditionSaveHarness />);

    // Expand the condition list and edit the variable name (debounced 300 ms).
    fireEvent.click(screen.getByText('Conditions'));
    const field = screen.getByLabelText('Variable Name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'MODIFIED' } });

    // The store still holds ORIGINAL — the debounce has NOT fired.
    expect(getModel().functions.TestCondition.conditions[0].variableName).toBe('ORIGINAL');

    // Save WITHOUT advancing the debounce timer. The save entry must flush the
    // pending edit before serializing the model.
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedModel = saveSpy.mock.calls[0][1] as any;
    expect(savedModel.functions.TestCondition.conditions[0].variableName).toBe('MODIFIED');
  });
});
