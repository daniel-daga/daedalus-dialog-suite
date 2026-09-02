/**
 * One add-action seeding path (2026-07 review, 3.3): appending an action is
 * inserting it after the last one, so `addActionToEnd` and `addActionAfter`
 * cannot seed companions (choice sub-function, createTopic's log pair,
 * dialog-line ids) differently.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useActionManagement } from '../src/renderer/components/hooks/useActionManagement';
import type { ActionTypeId } from '../src/renderer/components/actionTypes';
import type { DialogAction, DialogFunction, SemanticModel } from '../src/renderer/types/global';

function makeFunction(actions: DialogAction[]): DialogFunction {
  return { name: 'DIA_Test_Info', returnType: 'VOID', actions, conditions: [], calls: [] };
}

function renderManagement(initialActions: DialogAction[]) {
  let currentFunc = makeFunction(initialActions);
  const model: SemanticModel = { dialogs: {}, functions: {} };
  const focusAction = jest.fn();

  const setFunction = (updater: unknown) => {
    currentFunc = typeof updater === 'function'
      ? (updater as (prev: DialogFunction) => DialogFunction)(currentFunc)
      : (updater as DialogFunction);
  };
  const onUpdateSemanticModel = (name: string, func: DialogFunction) => {
    model.functions![name] = func;
  };

  const { result } = renderHook(() =>
    useActionManagement({
      setFunction: setFunction as Parameters<typeof useActionManagement>[0]['setFunction'],
      focusAction,
      semanticModel: model,
      onUpdateSemanticModel,
      contextName: 'DIA_Test'
    })
  );

  return { result, model, focusAction, getActions: () => currentFunc.actions };
}

/** The factory stamps every non-line action with a fresh `action_<uuid>`; only dialog-line ids are deterministic. */
function withoutRandomIds(actions: DialogAction[] | undefined): unknown[] {
  return (actions ?? []).map((action) => {
    const { id, ...rest } = action as { id?: string };
    return typeof id === 'string' && id.startsWith('action_') ? rest : action;
  });
}

const START: DialogAction[] = [
  { type: 'DialogLine', speaker: 'other', text: 'Hi', id: 'DIA_Test_15_00' }
];

describe('useActionManagement – addActionToEnd matches addActionAfter', () => {
  const SEEDED: ActionTypeId[] = ['dialogLine', 'choice', 'createTopic', 'clearChoicesAction'];

  test.each(SEEDED)('%s: appending equals inserting after the last action', (actionType) => {
    const append = renderManagement([...START]);
    const insert = renderManagement([...START]);

    act(() => { append.result.current.addActionToEnd(actionType); });
    act(() => { insert.result.current.addActionAfter([0], actionType); });

    expect(withoutRandomIds(append.getActions())).toEqual(withoutRandomIds(insert.getActions()));
    expect(append.model.functions).toEqual(insert.model.functions);
  });

  test('createTopic appended to an empty function seeds its log pair and focuses the topic', () => {
    jest.useFakeTimers();
    try {
      const { result, getActions, focusAction } = renderManagement([]);

      act(() => { result.current.addActionToEnd('createTopic'); });
      act(() => { jest.runAllTimers(); });

      expect(getActions().map((a) => a.type)).toEqual(['CreateTopic', 'LogSetTopicStatus', 'LogEntry']);
      expect(focusAction).toHaveBeenCalledWith([0], true);
    } finally {
      jest.useRealTimers();
    }
  });
});
