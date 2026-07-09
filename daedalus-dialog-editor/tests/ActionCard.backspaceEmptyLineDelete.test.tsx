/**
 * Backspace in an EMPTY dialog line must delete that line — and nothing else.
 *
 * The race: handleDeleteAndFocusPrev removes the action from the store and then
 * focusAction() synchronously focuses the previous card's input (its ref is
 * already registered) — still inside the same keydown dispatch, BEFORE React
 * re-renders. Moving focus fires a native blur on the deleted line's TextField
 * (onBlur={flushUpdate}), and flushUpdate writes the deleted action back to its
 * old path. updateActionAtPath has no bounds check, so:
 *   - LAST line:   the array just shrank; assigning index n APPENDS the deleted
 *                  line back (line "cannot be deleted").
 *   - MIDDLE line: it OVERWRITES the line that shifted into the deleted slot
 *                  (silent data loss of the following line).
 *
 * Secondary vector: a pending 300 ms debounce (user typed, then cleared the
 * line) fires after the delete and re-adds the line the same way.
 *
 * jsdom dispatches blur/focusout synchronously on .focus(), so the exact
 * production race is reproducible here with the real ActionCard +
 * useActionManagement + useFocusNavigation wiring.
 */

import React, { useCallback, useEffect, useReducer } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionCard from '../src/renderer/components/ActionCard';
import { useActionManagement } from '../src/renderer/components/hooks/useActionManagement';
import { useFocusNavigation } from '../src/renderer/components/hooks/useFocusNavigation';
import { flattenActionPaths } from '../src/renderer/components/nestedActionUtils';
import type { FunctionUpdater } from '../src/renderer/components/dialogTypes';
import type { DialogAction, DialogFunction, DialogLineAction } from '../src/renderer/types/global';

function makeFunction(actions: DialogAction[]): DialogFunction {
  return { name: 'DIA_Test_Info', returnType: 'VOID', actions, conditions: [], calls: [] };
}

function line(id: string, speaker: 'self' | 'other', text: string): DialogLineAction {
  return { type: 'DialogLine', speaker, text, id };
}

/**
 * Minimal but faithful stand-in for DialogDetailsEditor's wiring: the function
 * lives in an external mutable ref and setFunction executes updaters
 * synchronously (exactly like the zustand-backed
 * historyActions.updateFunctionWithUpdater), then triggers a re-render.
 */
function createHarness(initialActions: DialogAction[]) {
  const funcRef = { current: makeFunction(initialActions) };

  const Harness: React.FC = () => {
    const [, forceRender] = useReducer((x: number) => x + 1, 0);

    const setFunction = useCallback((updater: FunctionUpdater) => {
      funcRef.current = typeof updater === 'function' ? updater(funcRef.current) : updater;
      forceRender();
    }, []);

    const { registerActionRef, focusAction, trimRefs } = useFocusNavigation();

    const {
      updateAction,
      deleteAction,
      deleteActionAndFocusPrev,
      addDialogLineAfter,
      addActionAfter,
      addActionToBranchEnd,
      moveAction
    } = useActionManagement({
      setFunction,
      focusAction,
      contextName: 'DIA_Test'
    });

    const actions = funcRef.current.actions || [];
    const visiblePaths = flattenActionPaths(actions);

    useEffect(() => {
      trimRefs(visiblePaths);
    });

    return (
      <>
        {actions.map((action, idx) => (
          <ActionCard
            key={(action as DialogLineAction).id ?? idx}
            action={action}
            path={[idx]}
            index={idx}
            totalActions={actions.length}
            npcName="Arog"
            updateActionAtPath={updateAction}
            deleteActionAtPath={deleteAction}
            focusActionAtPath={focusAction}
            addDialogLineAfterPath={addDialogLineAfter}
            deleteActionAndFocusPrevAtPath={deleteActionAndFocusPrev}
            addActionAfterPath={addActionAfter}
            addActionToBranchEnd={addActionToBranchEnd}
            moveAction={moveAction}
            registerActionRef={registerActionRef}
            getVisibleActionPaths={() => flattenActionPaths(funcRef.current.actions || [])}
            dialogContextName="DIA_Test"
          />
        ))}
      </>
    );
  };

  return { funcRef, Harness };
}

const texts = (funcRef: { current: DialogFunction }) =>
  (funcRef.current.actions || []).map((a) => (a as DialogLineAction).text);

describe('ActionCard Backspace-delete of an empty dialog line (blur-flush race)', () => {
  test('empty MIDDLE line: Backspace deletes it and must NOT overwrite the following line', () => {
    const { funcRef, Harness } = createHarness([
      line('DIA_Test_15_00', 'self', 'Hello'),
      line('DIA_Test_15_01', 'other', ''),
      line('DIA_Test_15_02', 'self', 'World')
    ]);
    render(<Harness />);

    const inputs = screen.getAllByLabelText('Text');
    expect(inputs).toHaveLength(3);

    // Focus the empty middle line and press Backspace — the real user gesture.
    act(() => {
      inputs[1].focus();
    });
    fireEvent.keyDown(inputs[1], { key: 'Backspace' });

    // The following line must survive intact — before the fix the blur-flush
    // overwrote it with the deleted empty line (data loss).
    expect(texts(funcRef)).toEqual(['Hello', 'World']);
    // Focus moved to the previous line's text field.
    expect(inputs[0]).toHaveFocus();
  });

  test('empty LAST line: Backspace removes it (blur-flush must not re-append it)', () => {
    const { funcRef, Harness } = createHarness([
      line('DIA_Test_15_00', 'self', 'Hello'),
      line('DIA_Test_15_01', 'other', '')
    ]);
    render(<Harness />);

    const inputs = screen.getAllByLabelText('Text');
    expect(inputs).toHaveLength(2);

    act(() => {
      inputs[1].focus();
    });
    fireEvent.keyDown(inputs[1], { key: 'Backspace' });

    // Before the fix the blur-flush re-appended the deleted line (length 2).
    expect(texts(funcRef)).toEqual(['Hello']);
    expect(inputs[0]).toHaveFocus();
  });

  test('typed-then-cleared line: the pending debounce must not resurrect it after the delete', () => {
    jest.useFakeTimers();
    try {
      const { funcRef, Harness } = createHarness([
        line('DIA_Test_15_00', 'self', 'Hello'),
        line('DIA_Test_15_01', 'other', ''),
        line('DIA_Test_15_02', 'self', 'World')
      ]);
      render(<Harness />);

      const inputs = screen.getAllByLabelText('Text');

      // Type into the middle line, then clear it — a 300 ms debounce is now pending.
      act(() => {
        inputs[1].focus();
      });
      fireEvent.change(inputs[1], { target: { value: 'x' } });
      fireEvent.change(inputs[1], { target: { value: '' } });

      // Backspace within the debounce window deletes the (empty) line.
      fireEvent.keyDown(inputs[1], { key: 'Backspace' });

      expect(texts(funcRef)).toEqual(['Hello', 'World']);

      // The pending debounce timer must not write the deleted line back.
      act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(texts(funcRef)).toEqual(['Hello', 'World']);
      expect(inputs[0]).toHaveFocus();
    } finally {
      jest.useRealTimers();
    }
  });
});
