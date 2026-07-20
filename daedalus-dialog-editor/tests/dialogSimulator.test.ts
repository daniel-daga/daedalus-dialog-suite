/** @jest-environment node */
import { createDialogSimulation, selectSimulationChoice } from '../src/renderer/utils/dialogSimulator';
import type { SemanticModel } from '../src/shared/types';

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {
    DIA_Start: { name: 'DIA_Start', parent: 'C_INFO', properties: { information: 'DIA_Start_Info' }, actions: [] }
  },
  functions: {
    DIA_Start_Info: {
      name: 'DIA_Start_Info', returnType: 'void', calls: [], conditionOperator: 'AND', conditions: [], actions: [
        { type: 'DialogLine', speaker: 'other', text: 'What do you need?', id: 'START_00' },
        { type: 'SetVariableAction', variableName: 'MIS_Test', operator: '=', value: 1 },
        { type: 'Choice', dialogRef: 'DIA_Start', text: 'Tell me more.', targetFunction: 'DIA_More_Info' },
        { type: 'Choice', dialogRef: 'DIA_Start', text: 'Goodbye.', targetFunction: 'DIA_End_Info' }
      ]
    },
    DIA_More_Info: {
      name: 'DIA_More_Info', returnType: 'void', calls: [], conditionOperator: 'AND', conditions: [], actions: [
        { type: 'ClearChoicesAction', dialog: 'DIA_Start' },
        { type: 'DialogLine', speaker: 'self', text: 'I need a map.', id: 'MORE_00' },
        { type: 'SetVariableAction', variableName: 'MIS_Test', operator: '+=', value: 2 },
        { type: 'ConditionalAction', condition: 'MIS_Test >= 3', thenActions: [
          { type: 'DialogLine', speaker: 'other', text: 'Then take this one.', id: 'MORE_01' }
        ], elseActions: [] }
      ]
    },
    DIA_End_Info: { name: 'DIA_End_Info', returnType: 'void', calls: [], conditionOperator: 'AND', conditions: [], actions: [] }
  },
  ...overrides
});

describe('dialog simulator', () => {
  test('runs info actions, tracks scratch variables, and follows a selected choice', () => {
    const initial = createDialogSimulation(model(), 'DIA_Start');

    expect(initial.transcript).toEqual([{ speaker: 'other', text: 'What do you need?', id: 'START_00' }]);
    expect(initial.choices.map((choice) => choice.text)).toEqual(['Tell me more.', 'Goodbye.']);
    expect(initial.variables).toEqual({ MIS_Test: 1 });
    expect(initial.knownDialogs).toEqual(['DIA_Start']);

    const next = selectSimulationChoice(model(), initial, 0);

    expect(next.transcript).toEqual([
      { speaker: 'other', text: 'What do you need?', id: 'START_00' },
      { speaker: 'self', text: 'I need a map.', id: 'MORE_00' },
      { speaker: 'other', text: 'Then take this one.', id: 'MORE_01' }
    ]);
    expect(next.choices).toEqual([]);
    expect(next.variables).toEqual({ MIS_Test: 3 });
  });

  test('only exposes dialogs whose structured conditions are true', () => {
    const gated = model({
      dialogs: {
        DIA_Start: { name: 'DIA_Start', parent: 'C_INFO', properties: { information: 'DIA_Start_Info' }, actions: [] }
      },
      functions: {
        ...model().functions,
        DIA_Start_Condition: {
          name: 'DIA_Start_Condition', returnType: 'int', calls: [], conditionOperator: 'AND',
          conditions: [{ type: 'VariableCondition', variableName: 'MIS_Ready', operator: '==', value: 1, negated: false }], actions: []
        }
      }
    });
    gated.dialogs.DIA_Start.properties.condition = 'DIA_Start_Condition';

    expect(createDialogSimulation(gated, 'DIA_Start').status).toBe('unavailable');
    expect(createDialogSimulation(gated, 'DIA_Start', { MIS_Ready: 1 }).status).toBe('active');
  });
});
