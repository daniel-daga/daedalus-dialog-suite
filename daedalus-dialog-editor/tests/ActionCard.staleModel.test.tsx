/**
 * fix-07 §2.8 / test 8 (C3): ActionCard's memo comparator ignores model data and
 * every function prop on purpose. This proves the two honesty guarantees that
 * make that safe:
 *   (a) model-derived data no longer crosses the memo boundary — ChoiceRenderer
 *       reads its target function from the store, so a memo-blocked card still
 *       reflects a store update to functions[targetFunction] (no stale model).
 *   (b) function props crossing the boundary are identity-stable wrappers, so a
 *       swapped handler implementation is picked up by a memo-blocked card.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionsList from '../src/renderer/components/ActionsList';
import DialogActionsSection from '../src/renderer/components/DialogActionsSection';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useFileStore } from '../src/renderer/store/fileStore';

const filePath = 'C:/tmp/choice.d';
const targetFunction = 'DIA_Test_GoLeft';

const makeFunction = (actionCount: number) => ({
  name: targetFunction,
  returnType: 'VOID',
  actions: Array.from({ length: actionCount }, (_, i) => ({
    type: 'DialogLine',
    speaker: 'self',
    text: `line ${i}`,
    id: `${targetFunction}_self_${i}_0`,
  })),
  conditions: [],
  calls: [],
});

const makeModel = (actionCount: number) => ({
  dialogs: {},
  functions: { [targetFunction]: makeFunction(actionCount) },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
});

const choiceAction = {
  type: 'Choice',
  text: 'Go left',
  targetFunction,
  dialogRef: 'DIA_Test',
};

const badgeText = (container: HTMLElement): string | undefined =>
  container.querySelector('.MuiBadge-badge')?.textContent ?? undefined;

const emptyModel = {
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, hasErrors: false, errors: [],
};

describe('ActionCard stale-model / stable-handler honesty (C3)', () => {
  beforeEach(() => {
    useProjectStore.setState({ mergedSemanticModel: { ...emptyModel } } as never);
    useFileStore.setState({ openFiles: new Map(), activeFile: null } as never);
  });

  test('(a) badge reflects a store update to functions[targetFunction] without any prop change', () => {
    act(() => {
      useProjectStore.setState({ mergedSemanticModel: makeModel(2) } as never);
    });

    const { container } = render(
      <ActionsList
        actions={[choiceAction] as never}
        npcName="TestNPC"
        updateActionAtPath={jest.fn()}
        deleteActionAtPath={jest.fn()}
        focusActionAtPath={jest.fn()}
        addDialogLineAfterPath={jest.fn()}
        deleteActionAndFocusPrevAtPath={jest.fn()}
        addActionAfterPath={jest.fn()}
        moveAction={jest.fn()}
        registerActionRef={jest.fn()}
        getVisibleActionPaths={() => []}
        onNavigateToFunction={jest.fn()}
        onRenameFunction={jest.fn()}
        dialogContextName="DIA_Test"
        filePath={filePath}
      />
    );

    // Badge shows the resolved function's action count (2), proving the renderer
    // reads the store, not a threaded model prop (none is passed).
    expect(badgeText(container)).toBe('2');

    // Mutate only the store: a new functions[targetFunction] ref with 3 actions.
    // No ActionsList/ActionCard prop changed, so the card is memo-blocked — the
    // badge must still update via the leaf's own narrow subscription.
    act(() => {
      useProjectStore.setState({ mergedSemanticModel: makeModel(3) } as never);
    });

    expect(badgeText(container)).toBe('3');
  });

  test('(b) a swapped delete handler is picked up by a memo-blocked card', () => {
    // Keep the function (and therefore its actions array) referentially stable
    // so ActionsList/ActionCard bail out of re-rendering across the swap.
    const currentFunction = {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [choiceAction],
      conditions: [],
      calls: [],
    };

    const stableProps = {
      dialogName: 'DIA_Test',
      currentFunction: currentFunction as never,
      npcName: 'TestNPC',
      updateActionAtPath: jest.fn(),
      deleteActionAndFocusPrevAtPath: jest.fn(),
      addDialogLineAfterPath: jest.fn(),
      addActionAfterPath: jest.fn(),
      addActionToBranchEnd: jest.fn(),
      moveAction: jest.fn(),
      focusActionAtPath: jest.fn(),
      registerActionRef: jest.fn(),
      getVisibleActionPaths: () => [],
      onNavigateToFunction: jest.fn(),
      onRenameFunction: jest.fn(),
      onAddActionToEnd: jest.fn(),
      filePath,
    };

    const del1 = jest.fn();
    const del2 = jest.fn();

    const { rerender } = render(
      <DialogActionsSection {...stableProps} deleteActionAtPath={del1} />
    );

    fireEvent.click(screen.getByLabelText('Delete choice'));
    expect(del1).toHaveBeenCalledTimes(1);

    // Swap only the delete implementation; the function/actions refs are stable
    // so the card is memo-blocked. The stable-handler wrapper must route the
    // click to del2, not the captured del1 (stale closure pre-fix).
    rerender(<DialogActionsSection {...stableProps} deleteActionAtPath={del2} />);

    fireEvent.click(screen.getByLabelText('Delete choice'));
    expect(del2).toHaveBeenCalledTimes(1);
    expect(del1).toHaveBeenCalledTimes(1);
  });
});
