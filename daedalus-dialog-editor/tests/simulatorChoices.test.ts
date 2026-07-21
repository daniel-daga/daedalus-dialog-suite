/** @jest-environment node */
import type { DialogAction, DialogFunction } from '../src/shared/types';
import { createSimState, executeFunction, selectChoice } from '../src/renderer/simulator/domain/engine';
import type { SimulatorModel } from '../src/renderer/simulator/domain/types';

const func = (name: string, actions: DialogAction[]): DialogFunction => ({
  name,
  returnType: 'VOID',
  actions,
  conditions: [],
  calls: []
});

const modelOf = (...functions: DialogFunction[]): SimulatorModel => ({
  functions: new Map(functions.map((entry) => [entry.name.toLowerCase(), entry])),
  dialogs: [],
  declaredMisVariables: new Set(['mis_flag']),
  constants: new Map()
});

const menuActions: DialogAction[] = [
  { type: 'Choice', dialogRef: 'DIA_Start', text: 'Again', targetFunction: 'DIA_Again' },
  { type: 'Choice', dialogRef: 'DIA_Start', text: 'Replace', targetFunction: 'DIA_Replace' },
  { type: 'Choice', dialogRef: 'DIA_Start', text: 'Leave', targetFunction: 'DIA_Leave' }
];

describe('simulator persistent choices', () => {
  test('keeps the menu when the target does not clear it and permits repeated revisits', () => {
    const model = modelOf(
      func('DIA_Start_Info', menuActions),
      func('DIA_Again', [{ type: 'DialogLine', speaker: 'other', text: 'Still here.', id: 'AGAIN_00' }]),
      func('DIA_Replace', []),
      func('DIA_Leave', [])
    );
    const initial = executeFunction(model, createSimState(model), 'DIA_Start_Info');

    const once = selectChoice(model, initial, 0);
    const twice = selectChoice(model, once, 0);

    expect(initial.pendingChoices.map((choice) => choice.text)).toEqual(['Again', 'Replace', 'Leave']);
    expect(once.pendingChoices).toEqual(initial.pendingChoices);
    expect(twice.pendingChoices).toEqual(initial.pendingChoices);
    expect(twice.pendingChoices).not.toBe(initial.pendingChoices);
    expect(twice.transcript.filter((entry) => entry.kind === 'choice')).toHaveLength(2);
    expect(twice.transcript.filter((entry) => entry.kind === 'line')).toHaveLength(2);
    expect(twice.status).toBe('awaiting-choice');
  });

  test('clear removes the menu while clear-then-add replaces it', () => {
    const model = modelOf(
      func('DIA_Start_Info', menuActions),
      func('DIA_Again', []),
      func('DIA_Leave', [{ type: 'ClearChoicesAction', dialog: 'DIA_Start' }]),
      func('DIA_Replace', [
        { type: 'ClearChoicesAction', dialog: 'DIA_Start' },
        { type: 'Choice', dialogRef: 'DIA_Start', text: 'New option', targetFunction: 'DIA_New' }
      ]),
      func('DIA_New', [])
    );
    const initial = executeFunction(model, createSimState(model), 'DIA_Start_Info');

    const cleared = selectChoice(model, initial, 2);
    const replaced = selectChoice(model, initial, 1);

    expect(cleared.pendingChoices).toEqual([]);
    expect(cleared.status).toBe('ended');
    expect(replaced.pendingChoices).toEqual([
      { dialogRef: 'DIA_Start', text: 'New option', targetFunction: 'DIA_New' }
    ]);
    expect(replaced.status).toBe('awaiting-choice');
  });

  test('reaches choices nested inside conditional branches', () => {
    const model = modelOf(func('Nested', [
      { type: 'SetVariableAction', variableName: 'MIS_Flag', operator: '=', value: 1 },
      {
        type: 'ConditionalAction',
        condition: 'MIS_Flag == 1',
        thenActions: [
          { type: 'Choice', dialogRef: 'DIA_Start', text: 'Nested option', targetFunction: 'Nested_Target' }
        ],
        elseActions: []
      }
    ]));

    const result = executeFunction(model, createSimState(model), 'nested');

    expect(result.pendingChoices.map((choice) => choice.text)).toEqual(['Nested option']);
    expect(result.status).toBe('awaiting-choice');
  });

  test('resolves target functions case-insensitively', () => {
    const model = modelOf(
      func('Start', [{ type: 'Choice', dialogRef: 'DIA_Start', text: 'Go', targetFunction: '  mixed_CASE  ' }]),
      func('Mixed_Case', [{ type: 'DialogLine', speaker: 'self', text: 'Found it.', id: 'CASE_00' }])
    );
    const initial = executeFunction(model, createSimState(model), 'START');

    const result = selectChoice(model, initial, 0);

    expect(result.transcript).toContainEqual({
      kind: 'line', speaker: 'self', text: 'Found it.', id: 'CASE_00'
    });
    expect(result.pendingChoices).toEqual(initial.pendingChoices);
  });

  test('reports a missing target without destroying the still-usable menu', () => {
    const model = modelOf(func('Start', [
      { type: 'Choice', dialogRef: 'DIA_Start', text: 'Broken', targetFunction: 'Missing_Target' }
    ]));
    const initial = executeFunction(model, createSimState(model), 'start');

    const result = selectChoice(model, initial, 0);

    expect(result.pendingChoices).toEqual(initial.pendingChoices);
    expect(result.status).toBe('awaiting-choice');
    expect(result.transcript).toContainEqual(expect.objectContaining({
      kind: 'side-effect', text: expect.stringMatching(/Missing_Target/)
    }));
  });

  test('does not execute retained choices after the simulation has ended', () => {
    const model = modelOf(
      func('Start', [
        { type: 'Choice', dialogRef: 'DIA_Start', text: 'Too late', targetFunction: 'After_Stop' },
        { type: 'StopProcessInfosAction', target: 'self' }
      ]),
      func('After_Stop', [{ type: 'DialogLine', speaker: 'other', text: 'Must not run', id: 'STOPPED_01' }])
    );
    const ended = executeFunction(model, createSimState(model), 'Start');

    const result = selectChoice(model, ended, 0);

    expect(ended.status).toBe('ended');
    expect(ended.pendingChoices).toHaveLength(1);
    expect(result).toEqual(ended);
    expect(result).not.toBe(ended);
    expect(result.transcript).not.toContainEqual(expect.objectContaining({ text: 'Must not run' }));
  });
});
