import type { DialogCondition } from '../src/shared/types';
import {
  evaluateCondition,
  evaluateConditions,
  evaluateRawCondition
} from '../src/renderer/simulator/domain/conditionEvaluator';
import type { SimState, SimulatorModel, UnknownValue } from '../src/renderer/simulator/domain/types';

const unknown = (expression: string): UnknownValue => ({ kind: 'unknown', expression });

const state = (overrides: Partial<SimState> = {}): SimState => ({
  misVars: new Map(),
  assumedMisVars: new Set(),
  knownInfos: new Set(),
  transcript: [],
  pendingChoices: [],
  status: 'running',
  ...overrides
});

const model = (constants: ReadonlyMap<string, string | number | boolean> = new Map()): SimulatorModel => ({
  functions: new Map(),
  dialogs: [],
  declaredMisVariables: new Set(),
  constants
});

describe('simulator condition evaluator', () => {
  it.each([
    ['AND', ['true', 'unknown'], 'unknown'],
    ['AND', ['false', 'unknown'], 'false'],
    ['AND', ['true', 'false'], 'false'],
    ['OR', ['false', 'unknown'], 'unknown'],
    ['OR', ['true', 'unknown'], 'true'],
    ['OR', ['false', 'true'], 'true']
  ] as const)('uses three-valued %s truth tables', (operator, values, expected) => {
    const conditions = values.map((value, index) => ({
      type: 'VariableCondition' as const,
      variableName: `MIS_${index}`,
      operator: '==',
      value: value === 'unknown' ? 'MISSING_CONSTANT' : 1,
      negated: false,
    }));
    const simulationState = state({
      misVars: new Map(values.map((value, index) => [`mis_${index}`, value === 'true' ? 1 : 0]))
    });

    expect(evaluateConditions(conditions, operator, simulationState, model()).value).toBe(expected);
  });

  it('evaluates variable conditions case-insensitively, including TOPIC-to-MIS and LOG status aliases', () => {
    const simulationState = state({ misVars: new Map([['mis_test', 2]]) });

    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'TOPIC_TEST', operator: '==', value: 'LOG_SUCCESS', negated: false
    }, simulationState, model()).value).toBe('true');
    expect(evaluateCondition({
      type: 'QuestStateCondition', questVariable: 'topic_test', state: 'LOG_SUCCESS'
    }, simulationState, model()).value).toBe('true');
  });

  it.each([
    ['LOG_RUNNING', 1],
    ['LOG_SUCCESS', 2],
    ['LOG_FAILED', 3],
    ['LOG_OBSOLETE', 4]
  ] as const)('recognizes %s as numeric state %i', (status, numericValue) => {
    expect(evaluateCondition({
      type: 'QuestStateCondition', questVariable: 'MIS_STATUS', state: status
    }, state({ misVars: new Map([['mis_status', numericValue]]) }), model()).value).toBe('true');
  });

  it('supports numeric comparisons and propagates negation without converting unknown to false', () => {
    const simulationState = state({ misVars: new Map([['mis_score', 4], ['mis_unknown', unknown('some helper')]]) });

    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_SCORE', operator: '>=', value: 3, negated: false
    }, simulationState, model()).value).toBe('true');
    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_SCORE', operator: '<', value: 3, negated: true
    }, simulationState, model()).value).toBe('true');
    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_UNKNOWN', operator: '==', value: 1, negated: true
    }, simulationState, model())).toMatchObject({ value: 'unknown' });
  });

  it('resolves constants case-insensitively and reports unresolved values as unknown', () => {
    const simulationState = state({ misVars: new Map([['mis_score', 7]]) });
    const constants = new Map<string, string | number | boolean>([['Required_Score', 7]]);

    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_SCORE', operator: '==', value: 'REQUIRED_SCORE', negated: false
    }, simulationState, model(constants)).value).toBe('true');
    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_SCORE', operator: '==', value: 'UNKNOWN_CONSTANT', negated: false
    }, simulationState, model())).toMatchObject({ value: 'unknown' });
  });

  it('treats TRUE/FALSE and boolean constants as Gothic numeric flags', () => {
    const simulationState = state({ misVars: new Map([['mis_enabled', 1], ['mis_disabled', 0]]) });
    const constants = new Map<string, string | number | boolean>([['enabled_flag', true]]);

    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_ENABLED', operator: '==', value: 'TRUE', negated: false
    }, simulationState, model()).value).toBe('true');
    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_DISABLED', operator: '==', value: false, negated: false
    }, simulationState, model()).value).toBe('true');
    expect(evaluateCondition({
      type: 'VariableCondition', variableName: 'MIS_ENABLED', operator: '==', value: 'ENABLED_FLAG', negated: false
    }, simulationState, model(constants)).value).toBe('true');
  });

  it('evaluates known-info checks case-insensitively and reports world checks as unknown', () => {
    const simulationState = state({ knownInfos: new Set(['dia_met_guard']) });

    expect(evaluateCondition({
      type: 'NpcKnowsInfoCondition', npc: 'self', dialogRef: 'DIA_MET_GUARD'
    }, simulationState, model()).value).toBe('true');
    expect(evaluateCondition({
      type: 'NpcIsDeadCondition', npc: 'Guard', negated: true
    }, simulationState, model())).toMatchObject({ value: 'unknown' });
  });

  it('inverts a negated known-info check', () => {
    const simulationState = state({ knownInfos: new Set(['dia_met_guard']) });

    expect(evaluateCondition({
      type: 'NpcKnowsInfoCondition', npc: 'self', dialogRef: 'DIA_MET_GUARD', negated: true
    }, simulationState, model()).value).toBe('false');
    expect(evaluateCondition({
      type: 'NpcKnowsInfoCondition', npc: 'self', dialogRef: 'DIA_UNHEARD', negated: true
    }, simulationState, model()).value).toBe('true');
  });

  it('evaluates codec-structured raw expressions but preserves malformed and generic expressions as unknown', () => {
    const simulationState = state({
      misVars: new Map([['mis_test', 1]]),
      knownInfos: new Set(['dia_start'])
    });

    expect(evaluateRawCondition('MIS_TEST == LOG_RUNNING && Npc_KnowsInfo(self, DIA_START)', simulationState, model()).value).toBe('true');
    expect(evaluateRawCondition('MIS_TEST == LOG_RUNNING || Npc_IsDead(Guard)', simulationState, model()).value).toBe('true');
    expect(evaluateRawCondition('MIS_TEST == && Npc_KnowsInfo(self, DIA_START)', simulationState, model())).toMatchObject({ value: 'unknown' });
    expect(evaluateRawCondition('Custom_Helper() || Other_Helper()', simulationState, model())).toMatchObject({ value: 'unknown' });
    expect(evaluateRawCondition('MIS_TEST == 1 && Npc_KnowsInfo(self, DIA_START) || MIS_TEST == 0', simulationState, model())).toMatchObject({ value: 'unknown' });
  });

  it('evaluates raw generic Condition entries exactly once', () => {
    const condition: DialogCondition = { type: 'Condition', condition: 'MIS_TEST != LOG_FAILED' };
    expect(evaluateCondition(condition, state({ misVars: new Map([['mis_test', 1]]) }), model()).value).toBe('true');
  });
});
