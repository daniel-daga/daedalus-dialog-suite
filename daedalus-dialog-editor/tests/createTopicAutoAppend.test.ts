/**
 * TDD: createTopic auto-append behaviour
 *
 * When a CreateTopic action is added, a LogSetTopicStatus (LOG_RUNNING) should
 * be inserted directly after it, followed by a LogEntry.
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
// addActionAfter – createTopic inserts logSetTopicStatus + logEntry
// ---------------------------------------------------------------------------

describe('useActionManagement – addActionAfter createTopic', () => {
  test('inserts LogSetTopicStatus(LOG_RUNNING) directly after CreateTopic, then LogEntry', () => {
    const existingAction: DialogAction = { type: 'DialogLine', speaker: 'other', text: 'Hello', id: 'DIA_Test_15_00' };
    const { result, getActions } = renderManagement([existingAction]);

    act(() => {
      result.current.addActionAfter([0], 'createTopic');
    });

    const actions = getActions();
    // Should be: [existingAction, CreateTopic, LogSetTopicStatus, LogEntry]
    expect(actions).toHaveLength(4);
    expect(actions[0]).toMatchObject({ type: 'DialogLine' });
    expect(actions[1]).toMatchObject({ type: 'CreateTopic' });
    expect(actions[2]).toMatchObject({ type: 'LogSetTopicStatus', status: 'LOG_RUNNING' });
    expect(actions[3]).toMatchObject({ type: 'LogEntry' });
  });

  test('LogSetTopicStatus topic matches the CreateTopic topic', () => {
    const existingAction: DialogAction = { type: 'DialogLine', speaker: 'other', text: 'Hello', id: 'DIA_Test_15_00' };
    const { result, getActions } = renderManagement([existingAction]);

    act(() => {
      result.current.addActionAfter([0], 'createTopic');
    });

    const actions = getActions();
    const createTopic = actions[1] as { type: string; topic: string };
    const logSetStatus = actions[2] as { type: string; topic: string };
    expect(createTopic.topic).toBe(logSetStatus.topic);
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
