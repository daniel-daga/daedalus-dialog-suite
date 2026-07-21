import { getDialogAvailability } from '../src/renderer/simulator/domain/dialogAvailability';
import type { DialogFunction } from '../src/shared/types';
import type { SimDialogEntry, SimState, SimulatorModel } from '../src/renderer/simulator/domain/types';

const emptyState = (misVars: Array<[string, number]> = []): SimState => ({
  misVars: new Map(misVars),
  assumedMisVars: new Set(),
  knownInfos: new Set(),
  transcript: [],
  pendingChoices: [],
  status: 'running'
});

const conditionFunction = (name: string, value: number): DialogFunction => ({
  name,
  returnType: 'INT',
  calls: [],
  conditionOperator: 'AND',
  conditions: [{ type: 'VariableCondition', variableName: 'MIS_Ready', operator: '==', value, negated: false }],
  actions: []
});

const dialog = (name: string, overrides: Partial<SimDialogEntry> = {}): SimDialogEntry => ({
  name,
  npc: 'NPC_Test',
  nr: 0,
  conditionFunction: `${name}_Condition`,
  informationFunction: `${name}_Info`,
  important: false,
  permanent: false,
  sourceOrder: 0,
  ...overrides
});

const model = (dialogs: SimDialogEntry[], functions: DialogFunction[] = []): SimulatorModel => ({
  dialogs,
  functions: new Map(functions.map((func) => [func.name.toLowerCase(), func])),
  constants: new Map(),
  declaredMisVariables: new Set(['mis_ready'])
});

describe('getDialogAvailability', () => {
  test('evaluates conditions and returns case-insensitive NPC matches in stable nr/source order', () => {
    const entries = [
      dialog('DIA_Later', { nr: 2, sourceOrder: 4 }),
      dialog('DIA_First', { nr: 1, sourceOrder: 9 }),
      dialog('DIA_FirstTie', { nr: 1, sourceOrder: 10, npc: 'npc_test' }),
      dialog('DIA_OtherNpc', { nr: 0, npc: 'NPC_Other' })
    ];
    const functions = [
      conditionFunction('DIA_Later_Condition', 1),
      conditionFunction('DIA_First_Condition', 1),
      conditionFunction('DIA_FirstTie_Condition', 1),
      conditionFunction('DIA_OtherNpc_Condition', 1)
    ];

    const result = getDialogAvailability(model(entries, functions), emptyState([['mis_ready', 1]]), ' NPC_TEST ', false);

    expect(result.map((item) => item.entry.name)).toEqual(['DIA_First', 'DIA_FirstTie', 'DIA_Later']);
    expect(result.every((item) => item.value === 'true' && item.visible && !item.assumedAvailable)).toBe(true);
  });

  test('excludes known non-permanent dialogs before evaluating them but retains known permanent dialogs', () => {
    const transient = dialog('DIA_Transient');
    const permanent = dialog('DIA_Permanent', { permanent: true, sourceOrder: 1 });
    const state = emptyState([['mis_ready', 1]]);
    state.knownInfos.add('dia_transient');
    state.knownInfos.add('dia_permanent');

    const result = getDialogAvailability(model([transient, permanent], [
      conditionFunction('DIA_Transient_Condition', 1),
      conditionFunction('DIA_Permanent_Condition', 1)
    ]), state, 'npc_test', false);

    expect(result).toEqual([
      expect.objectContaining({ entry: permanent, value: 'true', visible: true, assumedAvailable: false })
    ]);
  });

  test('reports missing condition references as visible unknown entries and exposes the unknown policy', () => {
    const entry = dialog('DIA_MissingCondition', { conditionFunction: undefined });

    const assumedFalse = getDialogAvailability(model([entry]), emptyState(), 'NPC_Test', false);
    const assumedTrue = getDialogAvailability(model([entry]), emptyState(), 'NPC_Test', true);

    expect(assumedFalse[0]).toEqual(expect.objectContaining({
      value: 'unknown', visible: true, assumedAvailable: false
    }));
    expect(assumedFalse[0].reason).toMatch(/missing condition/i);
    expect(assumedTrue[0]).toEqual(expect.objectContaining({
      value: 'unknown', visible: true, assumedAvailable: true
    }));
  });

  test('reports an unresolved condition target as unknown instead of passing it', () => {
    const entry = dialog('DIA_UnresolvedCondition', { conditionFunction: 'DIA_Missing_Target' });

    const [availability] = getDialogAvailability(model([entry]), emptyState(), 'npc_test', false);

    expect(availability).toEqual(expect.objectContaining({
      value: 'unknown', visible: true, assumedAvailable: false
    }));
    expect(availability.reason).toMatch(/not found/i);
  });
});
