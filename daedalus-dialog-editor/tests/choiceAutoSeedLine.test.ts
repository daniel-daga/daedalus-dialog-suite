/**
 * TDD: auto-seed + mirror dialog line for a new Choice (issue #181)
 *
 * When a Choice is added, its sub-dialog (target function) should be seeded
 * with a single Hero dialog line so the dropdown is never empty. When the
 * Choice Text is later edited, that seeded line's text should mirror it — as
 * long as the user hasn't manually changed the line away from the choice text.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useActionManagement } from '../src/renderer/components/hooks/useActionManagement';
import type { DialogAction, DialogFunction, SemanticModel } from '../src/renderer/types/global';

function makeFunction(name: string, actions: DialogAction[]): DialogFunction {
  return { name, returnType: 'VOID', actions, conditions: [], calls: [] };
}

function renderManagement(initialActions: DialogAction[] = []) {
  let currentFunc = makeFunction('DIA_Test_Info', initialActions);
  const model: SemanticModel = { dialogs: {}, functions: {} };
  const focusAction = jest.fn();

  const setFunction = jest.fn((updater: unknown) => {
    if (typeof updater === 'function') {
      currentFunc = (updater as (prev: DialogFunction) => DialogFunction)(currentFunc);
    } else {
      currentFunc = updater as DialogFunction;
    }
  });

  const onUpdateSemanticModel = jest.fn((name: string, func: DialogFunction) => {
    model.functions![name] = func;
  });

  const { result, rerender } = renderHook(() =>
    useActionManagement({
      setFunction: setFunction as Parameters<typeof useActionManagement>[0]['setFunction'],
      focusAction,
      semanticModel: model,
      onUpdateSemanticModel,
      contextName: 'DIA_Test',
    })
  );

  return {
    result,
    rerender,
    model,
    getActions: () => currentFunc.actions,
    setActions: (actions: DialogAction[]) => { currentFunc = makeFunction('DIA_Test_Info', actions); },
  };
}

describe('useActionManagement – choice auto-seeded sub-dialog line (#181)', () => {
  test('addActionAfter seeds the target function with one Hero dialog line', () => {
    const existing: DialogAction = { type: 'DialogLine', speaker: 'other', text: 'Hi', id: 'DIA_Test_15_00' };
    const { result, getActions, model } = renderManagement([existing]);

    act(() => {
      result.current.addActionAfter([0], 'choice');
    });

    const choice = getActions()[1] as { type: string; targetFunction: string };
    expect(choice.type).toBe('Choice');

    const target = model.functions![choice.targetFunction];
    expect(target).toBeDefined();
    expect(target.actions).toHaveLength(1);
    const seeded = target.actions![0] as { type: string; speaker: string; id: string };
    expect(seeded).toMatchObject({ type: 'DialogLine', speaker: 'other' });
    // The seeded line must not reuse the parent line's id (would emit duplicate
    // AI_Output sound names on codegen).
    expect(seeded.id).not.toBe('DIA_Test_15_00');
  });

  test('editing Choice Text mirrors into the seeded line while it still matches', () => {
    const targetName = 'DIA_Test_Choice_1';
    const { result, model, setActions } = renderManagement();

    // Pre-existing choice + seeded line both carrying the same text 'Hello'.
    model.functions![targetName] = makeFunction(targetName, [
      { type: 'DialogLine', speaker: 'other', text: 'Hello', id: 'DIA_Test_15_00' },
    ]);
    setActions([
      { type: 'Choice', dialogRef: 'DIA_Test', text: 'Hello', targetFunction: targetName },
    ]);

    act(() => {
      result.current.updateAction([0], {
        type: 'Choice', dialogRef: 'DIA_Test', text: 'Hello world', targetFunction: targetName,
      });
    });

    expect((model.functions![targetName].actions![0] as { text: string }).text).toBe('Hello world');
  });

  test('does not clobber a line the user has manually edited away from the choice text', () => {
    const targetName = 'DIA_Test_Choice_1';
    const { result, model, setActions } = renderManagement();

    model.functions![targetName] = makeFunction(targetName, [
      { type: 'DialogLine', speaker: 'other', text: 'Custom spoken line', id: 'DIA_Test_15_00' },
    ]);
    setActions([
      { type: 'Choice', dialogRef: 'DIA_Test', text: 'Hello', targetFunction: targetName },
    ]);

    act(() => {
      result.current.updateAction([0], {
        type: 'Choice', dialogRef: 'DIA_Test', text: 'Hello world', targetFunction: targetName,
      });
    });

    expect((model.functions![targetName].actions![0] as { text: string }).text).toBe('Custom spoken line');
  });
});
