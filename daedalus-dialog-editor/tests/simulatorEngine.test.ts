/** @jest-environment node */
import type { DialogAction, DialogFunction } from '../src/shared/types';
import { createSimState, executeFunction } from '../src/renderer/simulator/domain/engine';
import type { SimulatorModel, UnknownValue } from '../src/renderer/simulator/domain/types';

const func = (name: string, actions: DialogAction[]): DialogFunction => ({
  name,
  returnType: 'VOID',
  actions,
  conditions: [],
  calls: []
});

const simulatorModel = (
  functions: DialogFunction[],
  declaredMisVariables: string[] = [],
  constants: Array<[string, string | number | boolean]> = []
): SimulatorModel => ({
  functions: new Map(functions.map((entry) => [entry.name.trim().toLowerCase(), entry])),
  dialogs: [],
  declaredMisVariables: new Set(declaredMisVariables.map((name) => name.trim().toLowerCase())),
  constants: new Map(constants.map(([name, value]) => [name.trim().toLowerCase(), value]))
});

describe('simulator engine', () => {
  test('creates assumed-zero state and executes numeric MIS assignments without mutating its input', () => {
    const model = simulatorModel([
      func('DIA_Test_Info', [
        { type: 'DialogLine', speaker: 'other', text: 'Start', id: 'START_00' },
        { type: 'SetVariableAction', variableName: 'mis_score', operator: '=', value: 2 },
        { type: 'SetVariableAction', variableName: 'MIS_SCORE', operator: '+=', value: 3 },
        { type: 'SetVariableAction', variableName: 'MIS_SCORE', operator: '-=', value: 1 },
        { type: 'SetVariableAction', variableName: 'MIS_SCORE', operator: '*=', value: 2 },
        { type: 'SetVariableAction', variableName: 'MIS_SCORE', operator: '/=', value: 4 }
      ])
    ], ['MIS_Score', 'MIS_Unchanged']);
    const initial = createSimState(model);

    const result = executeFunction(model, initial, '  dia_TEST_info  ');

    expect(initial.misVars).toEqual(new Map([['mis_score', 0], ['mis_unchanged', 0]]));
    expect(initial.assumedMisVars).toEqual(new Set(['mis_score', 'mis_unchanged']));
    expect(initial.transcript).toEqual([]);
    expect(result).not.toBe(initial);
    expect(result.misVars.get('mis_score')).toBe(2);
    expect(result.assumedMisVars).toEqual(new Set(['mis_unchanged']));
    expect(result.transcript[0]).toEqual({
      kind: 'line', speaker: 'other', text: 'Start', id: 'START_00'
    });
    expect(result.transcript.filter((entry) => entry.kind === 'side-effect')).toHaveLength(5);
    expect(result.status).toBe('ended');
  });

  test.each([
    ['unresolved symbol', '=', 'UNKNOWN_CONST'],
    ['unsupported operator', '%=', 2],
    ['division by zero', '/=', 0]
  ])('stores an UnknownValue for %s', (_label, operator, value) => {
    const model = simulatorModel([
      func('Target', [
        { type: 'SetVariableAction', variableName: 'MIS_Value', operator, value }
      ])
    ], ['MIS_Value']);

    const result = executeFunction(model, createSimState(model), 'TARGET');
    const stored = result.misVars.get('mis_value') as UnknownValue;

    expect(stored.kind).toBe('unknown');
    expect(stored.expression).toContain('MIS_Value');
    expect(result.assumedMisVars.has('mis_value')).toBe(false);
  });

  test('resolves numeric, boolean, log-state, and case-insensitive constants', () => {
    const model = simulatorModel([
      func('Target', [
        { type: 'SetVariableAction', variableName: 'MIS_A', operator: '=', value: 'answer' },
        { type: 'SetVariableAction', variableName: 'MIS_B', operator: '=', value: true },
        { type: 'SetVariableAction', variableName: 'MIS_C', operator: '=', value: 'LOG_SUCCESS' }
      ])
    ], ['MIS_A', 'MIS_B', 'MIS_C'], [['ANSWER', 42]]);

    const result = executeFunction(model, createSimState(model), 'target');

    expect(result.misVars).toEqual(new Map([
      ['mis_a', 42], ['mis_b', 1], ['mis_c', 2]
    ]));
  });

  test('propagates nested stop and records an unknown-condition assumption', () => {
    const model = simulatorModel([
      func('Target', [
        {
          type: 'ConditionalAction',
          condition: 'World_Check(hero)',
          thenActions: [
            { type: 'DialogLine', speaker: 'other', text: 'Before stop', id: 'STOP_00' },
            { type: 'StopProcessInfosAction', target: 'self' },
            { type: 'DialogLine', speaker: 'other', text: 'After stop', id: 'STOP_01' }
          ],
          elseActions: []
        },
        { type: 'DialogLine', speaker: 'other', text: 'Outer sibling', id: 'STOP_02' }
      ])
    ]);

    const result = executeFunction(model, createSimState(model), 'target', { assumeUnknown: true });

    expect(result.transcript).toContainEqual(expect.objectContaining({
      kind: 'condition-note', condition: 'World_Check(hero)', assumed: true
    }));
    expect(result.transcript.filter((entry) => entry.kind === 'line')).toEqual([
      { kind: 'line', speaker: 'other', text: 'Before stop', id: 'STOP_00' }
    ]);
    expect(result.status).toBe('ended');
  });

  test('uses one action budget across nested execution and ends visibly when exhausted', () => {
    const model = simulatorModel([
      func('Target', [
        { type: 'DialogLine', speaker: 'other', text: 'First', id: 'BUDGET_00' },
        {
          type: 'ConditionalAction',
          condition: 'MIS_Flag == 0',
          thenActions: [{ type: 'DialogLine', speaker: 'other', text: 'Nested', id: 'BUDGET_01' }],
          elseActions: []
        }
      ])
    ], ['MIS_Flag']);

    const result = executeFunction(model, createSimState(model), 'target', { actionBudget: 2 });

    expect(result.transcript.filter((entry) => entry.kind === 'line')).toEqual([
      { kind: 'line', speaker: 'other', text: 'First', id: 'BUDGET_00' }
    ]);
    expect(result.transcript).toContainEqual(expect.objectContaining({
      kind: 'side-effect', text: expect.stringMatching(/budget/i)
    }));
    expect(result.status).toBe('ended');
  });
});
