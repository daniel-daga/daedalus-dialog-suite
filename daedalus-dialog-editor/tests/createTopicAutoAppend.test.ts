/**
 * Quest lines from the add-action menu (#322), and the raw CreateTopic card's
 * topic sync and #278 topic-type switch.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useActionManagement } from '../src/renderer/components/hooks/useActionManagement';
import type { DialogAction, DialogFunction } from '../src/renderer/types/global';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFunction(actions: DialogAction[]): DialogFunction {
  return {
    name: 'DIA_Test_Info',
    returnType: 'VOID',
    actions,
    conditions: [],
    calls: []
  };
}

function renderManagement(initialActions: DialogAction[] = []) {
  let currentFunc = makeFunction(initialActions);
  const focusAction = jest.fn();

  const setFunction = jest.fn((updater: unknown) => {
    if (typeof updater === 'function') {
      currentFunc = (updater as (prev: DialogFunction) => DialogFunction)(currentFunc);
    } else {
      currentFunc = updater as DialogFunction;
    }
  });

  const { result } = renderHook(() =>
    useActionManagement({
      setFunction: setFunction as Parameters<typeof useActionManagement>[0]['setFunction'],
      focusAction,
      contextName: 'DIA_Test',
    })
  );

  return { result, getActions: () => currentFunc.actions, focusAction };
}

// ---------------------------------------------------------------------------
// addActionAfter – #322: the quest menu entries write the vanilla lines; the
// raw Create Topic entry writes only its own line
// ---------------------------------------------------------------------------

describe('useActionManagement – addActionAfter quest steps', () => {
  const existingAction: DialogAction = { type: 'DialogLine', speaker: 'other', text: 'Hello', id: 'DIA_Test_15_00' };
  const types = (actions: DialogAction[] | undefined) => (actions ?? []).map((a) => a.type);

  test('Create Topic inserts the raw Log_CreateTopic line alone', () => {
    const { result, getActions } = renderManagement([existingAction]);
    act(() => { result.current.addActionAfter([0], 'createTopic'); });
    expect(types(getActions())).toEqual(['DialogLine', 'CreateTopic']);
  });

  test('Start Quest inserts the vanilla start lines, each with an id, and focuses the first', () => {
    jest.useFakeTimers();
    try {
      const { result, getActions, focusAction } = renderManagement([existingAction]);
      act(() => { result.current.addActionAfter([0], 'questStart'); });
      act(() => { jest.runAllTimers(); });

      const actions = getActions();
      expect(types(actions)).toEqual(['DialogLine', 'CreateTopic', 'LogSetTopicStatus', 'LogEntry', 'SetVariableAction']);
      expect(actions[4]).toMatchObject({ variableName: 'MIS_', operator: '=', value: 'LOG_RUNNING' });
      for (const action of actions.slice(1)) expect((action as { id?: string }).id).toMatch(/^action_/);
      expect(focusAction).toHaveBeenCalledWith([1], true);
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    ['questComplete', ['SetVariableAction', 'LogSetTopicStatus'], 'LOG_SUCCESS'],
    ['questFail', ['SetVariableAction', 'LogSetTopicStatus'], 'LOG_FAILED'],
    ['questCancel', ['SetVariableAction', 'LogSetTopicStatus'], 'LOG_OBSOLETE']
  ] as const)('%s inserts the MIS_ and status lines for its state', (actionType, expected, state) => {
    const { result, getActions } = renderManagement([existingAction]);
    act(() => { result.current.addActionAfter([0], actionType); });
    expect(types(getActions()).slice(1)).toEqual(expected);
    expect(getActions()[2]).toMatchObject({ status: state });
  });

  test('Start Quest after an If block writes its lines beside it, not into its branch', () => {
    const ifBlock = { type: 'ConditionalAction', condition: 'x', thenActions: [existingAction], elseActions: [] } as unknown as DialogAction;
    const { result, getActions } = renderManagement([ifBlock]);
    act(() => { result.current.addActionAfter([0], 'questStart'); });
    expect(types(getActions())).toEqual(['ConditionalAction', 'CreateTopic', 'LogSetTopicStatus', 'LogEntry', 'SetVariableAction']);
    expect((getActions()[0] as unknown as { thenActions: DialogAction[] }).thenActions).toEqual([existingAction]);
  });

  test('Note inserts a LOG_NOTE topic and its entry, with no status or MIS_', () => {
    const { result, getActions } = renderManagement([existingAction]);
    act(() => { result.current.addActionAfter([0], 'questNote'); });
    expect(types(getActions()).slice(1)).toEqual(['CreateTopic', 'LogEntry']);
    expect(getActions()[1]).toMatchObject({ topicType: 'LOG_NOTE' });
  });
});

// ---------------------------------------------------------------------------
// updateAction – topic sync propagates to LogSetTopicStatus sibling
// ---------------------------------------------------------------------------

describe('useActionManagement – updateAction topic sync', () => {
  test('syncs LogSetTopicStatus topic when CreateTopic topic is changed', () => {
    const initialActions: DialogAction[] = [
      { type: 'CreateTopic', topic: 'TOPIC_OLD', topicType: 'LOG_MISSION' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_OLD', status: 'LOG_RUNNING' },
      { type: 'LogEntry', topic: 'TOPIC_OLD', text: '' },
    ];
    const { result, getActions } = renderManagement(initialActions);

    act(() => {
      result.current.updateAction([0], { type: 'CreateTopic', topic: 'TOPIC_NEW', topicType: 'LOG_MISSION' });
    });

    const actions = getActions();
    expect((actions[1] as { topic: string }).topic).toBe('TOPIC_NEW');
    expect((actions[2] as { topic: string }).topic).toBe('TOPIC_NEW');
  });
});

// ---------------------------------------------------------------------------
// updateAction – #278: a LOG_NOTE has no Running/Success/Failed status
// ---------------------------------------------------------------------------

describe('useActionManagement – updateAction topic type', () => {
  test('switching to LOG_NOTE removes the status row that follows the topic', () => {
    const initialActions: DialogAction[] = [
      { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_MISSION' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Mine', status: 'LOG_RUNNING' },
      { type: 'LogEntry', topic: 'TOPIC_Mine', text: 'Ore' },
    ];
    const { result, getActions } = renderManagement(initialActions);

    act(() => {
      result.current.updateAction([0], { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_NOTE' });
    });

    expect(getActions()).toEqual([
      { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_NOTE' },
      { type: 'LogEntry', topic: 'TOPIC_Mine', text: 'Ore' },
    ]);
  });

  test('switching to LOG_NOTE leaves a status row for a different topic alone', () => {
    const initialActions: DialogAction[] = [
      { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_MISSION' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Other', status: 'LOG_SUCCESS' },
    ];
    const { result, getActions } = renderManagement(initialActions);

    act(() => {
      result.current.updateAction([0], { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_NOTE' });
    });

    expect(getActions()).toHaveLength(2);
    expect(getActions()[1]).toMatchObject({ type: 'LogSetTopicStatus', topic: 'TOPIC_Other' });
  });

  test('switching back to LOG_MISSION restores a LOG_RUNNING status row after the topic', () => {
    const initialActions: DialogAction[] = [
      { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_NOTE' },
      { type: 'LogEntry', topic: 'TOPIC_Mine', text: 'Ore' },
    ];
    const { result, getActions } = renderManagement(initialActions);

    act(() => {
      result.current.updateAction([0], { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_MISSION' });
    });

    expect(getActions()).toMatchObject([
      { type: 'CreateTopic', topic: 'TOPIC_Mine', topicType: 'LOG_MISSION' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Mine', status: 'LOG_RUNNING' },
      { type: 'LogEntry', topic: 'TOPIC_Mine', text: 'Ore' },
    ]);
  });
});
