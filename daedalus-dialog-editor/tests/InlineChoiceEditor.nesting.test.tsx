import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import InlineChoiceEditor from '../src/renderer/components/InlineChoiceEditor';
import type { SemanticModel, DialogFunction } from '../src/renderer/types/global';

/**
 * Issue #182: when working inside a dropdown-expanded sub-dialog (the choice
 * accordion), "Add Dialog Line" and the trash icon must operate at that nesting
 * level — i.e. on the choice's own function — not on the top-level dialog.
 *
 * These tests render the REAL ActionsList / ActionCard / renderers (not mocked)
 * so the add "+" menu and the line's delete button go through the genuine
 * useActionManagement wiring. The discriminating assertion is that the editor
 * store is updated for the choice sub-function ('DIA_Test_Yes') and that the
 * produced updater adds / removes a line from that function.
 */

const updateFunction = jest.fn();
const updateFunctionWithUpdater = jest.fn();
const renameFunction = jest.fn();

jest.mock('../src/renderer/store/editorStore', () => ({
  useEditorStore: (selector: (s: unknown) => unknown) =>
    selector({ updateFunction, updateFunctionWithUpdater, renameFunction }),
}));

const SUB_FUNCTION_NAME = 'DIA_Test_Yes';
const FILE_PATH = '/test/file.d';

function makeSubFunction(): DialogFunction {
  return {
    name: SUB_FUNCTION_NAME,
    returnType: 'VOID',
    actions: [
      { type: 'DialogLine', speaker: 'other', text: 'Existing sub line', id: 'DIA_Test_Yes_other_1_0' },
    ],
    conditions: [],
    calls: [],
  } as DialogFunction;
}

function makeModel(subFunction: DialogFunction): SemanticModel {
  return {
    dialogs: {},
    functions: { [SUB_FUNCTION_NAME]: subFunction },
    hasErrors: false,
    errors: [],
  } as SemanticModel;
}

function renderInline(subFunction: DialogFunction) {
  return render(
    <InlineChoiceEditor
      targetFunctionName={SUB_FUNCTION_NAME}
      dialogName="DIA_Test"
      filePath={FILE_PATH}
      semanticModel={makeModel(subFunction)}
      npcName="TestNPC"
    />
  );
}

describe('InlineChoiceEditor add/delete operate on the choice sub-dialog (issue #182)', () => {
  beforeEach(() => {
    updateFunction.mockClear();
    updateFunctionWithUpdater.mockClear();
    renameFunction.mockClear();
  });

  test('"Add Dialog Line" inside the dropdown inserts into the choice sub-dialog, not the top level', () => {
    const subFunction = makeSubFunction();
    renderInline(subFunction);

    // Open the per-line "+" menu rendered inside the expanded choice and pick Dialog Line.
    fireEvent.click(screen.getByRole('button', { name: 'Add new action' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dialog Line' }));

    // The update must target the CHOICE sub-function (nesting level), not the parent.
    expect(updateFunctionWithUpdater).toHaveBeenCalledWith(
      FILE_PATH,
      SUB_FUNCTION_NAME,
      expect.any(Function)
    );

    // Applying the produced updater appends a dialog line to that sub-function.
    const updater = updateFunctionWithUpdater.mock.calls[0][2] as (f: DialogFunction) => DialogFunction;
    const next = updater(subFunction);
    expect(next.actions).toHaveLength(2);
    expect(next.actions[1].type).toBe('DialogLine');
  });

  test('the trash icon deletes a line shown inside the dropdown (from the sub-dialog)', () => {
    const subFunction = makeSubFunction();
    renderInline(subFunction);

    fireEvent.click(screen.getByRole('button', { name: 'Delete dialog line' }));

    expect(updateFunctionWithUpdater).toHaveBeenCalledWith(
      FILE_PATH,
      SUB_FUNCTION_NAME,
      expect.any(Function)
    );

    const updater = updateFunctionWithUpdater.mock.calls[0][2] as (f: DialogFunction) => DialogFunction;
    const next = updater(subFunction);
    expect(next.actions).toHaveLength(0);
  });
});

/**
 * Issue #118: pressing Tab in the Choice Text field should dive into the
 * choice's sub-dialog. ChoiceRenderer drives that by expanding this editor and
 * bumping `focusFirstActionNonce`; the editor must then move focus to the first
 * line of the sub-dialog so the user can type straight away.
 */
describe('InlineChoiceEditor focuses the first sub-dialog line on request (issue #118)', () => {
  beforeEach(() => {
    updateFunction.mockClear();
    updateFunctionWithUpdater.mockClear();
    renameFunction.mockClear();
  });

  test('a positive focusFirstActionNonce focuses the first line of the sub-dialog', () => {
    const subFunction = makeSubFunction();
    render(
      <InlineChoiceEditor
        targetFunctionName={SUB_FUNCTION_NAME}
        dialogName="DIA_Test"
        filePath={FILE_PATH}
        semanticModel={makeModel(subFunction)}
        npcName="TestNPC"
        focusFirstActionNonce={1}
      />
    );

    expect(screen.getByLabelText('Text')).toHaveFocus();
  });

  test('a zero nonce (mouse expand) leaves focus untouched', () => {
    const subFunction = makeSubFunction();
    render(
      <InlineChoiceEditor
        targetFunctionName={SUB_FUNCTION_NAME}
        dialogName="DIA_Test"
        filePath={FILE_PATH}
        semanticModel={makeModel(subFunction)}
        npcName="TestNPC"
        focusFirstActionNonce={0}
      />
    );

    expect(screen.getByLabelText('Text')).not.toHaveFocus();
  });
});
