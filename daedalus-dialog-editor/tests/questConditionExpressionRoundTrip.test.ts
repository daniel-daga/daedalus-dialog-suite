import { buildQuestGraph } from '../src/renderer/quest/domain/graph';
import { executeQuestGraphCommand } from '../src/renderer/quest/domain/commands';
import {
  parseConditionExpressionToConditions,
  serializeConditionsToExpression
} from '../src/renderer/quest/domain/commands/conditionExpressionCodec';
import type { DialogCondition, SemanticModel } from '../src/renderer/types/global';

const createMockModel = (functions: any[], dialogs: any[]): SemanticModel => {
  const funcMap: Record<string, any> = {};
  functions.forEach((f) => (funcMap[f.name] = f));
  const dialogMap: Record<string, any> = {};
  dialogs.forEach((d) => (dialogMap[d.name] = d));
  return {
    functions: funcMap,
    dialogs: dialogMap,
    variables: {},
    constants: {},
    instances: {}
  } as SemanticModel;
};

// A dialog whose gating conditions live in a *separate* condition function, with
// the info function carrying no conditions of its own. This is the exact shape
// that previously (a) prefilled the inspector with non-parseable pretty labels
// ("Bloodwyn is alive") and (b) wholesale-copied the condition function's
// conditions onto the info function on apply.
const OWNER_CONDITIONS: DialogCondition[] = [
  { type: 'VariableCondition', variableName: 'MIS_Q', operator: '==', value: 'LOG_RUNNING', negated: false },
  { type: 'NpcKnowsInfoCondition', npc: 'self', dialogRef: 'DIA_Other' },
  { type: 'NpcIsDeadCondition', npc: 'Bloodwyn', negated: true }
] as DialogCondition[];

const buildSeparateConditionFunctionModel = (): SemanticModel => {
  const functions = [
    {
      name: 'DIA_Q_Info',
      conditions: [],
      actions: [{ type: 'CreateTopic', topic: 'TOPIC_Q', topicType: 'LOG_MISSION' }]
    },
    {
      name: 'DIA_Q_Cond',
      conditions: OWNER_CONDITIONS.map((c) => ({ ...c }))
    }
  ];
  const dialogs = [
    {
      name: 'DIA_Q',
      properties: { information: 'DIA_Q_Info', condition: 'DIA_Q_Cond', npc: 'NPC_Q' }
    }
  ];
  return createMockModel(functions, dialogs);
};

const getDialogNodeData = (model: SemanticModel): any => {
  const { nodes } = buildQuestGraph(model, 'TOPIC_Q');
  const node = nodes.find((candidate) => candidate.id === 'DIA_Q_Info');
  expect(node).toBeDefined();
  return (node as any).data;
};

describe('quest dialog condition-expression editing does not round-trip display strings', () => {
  it('exposes a codec-parseable editable expression and the true owner function on dialog nodes', () => {
    const model = buildSeparateConditionFunctionModel();
    const data = getDialogNodeData(model);

    // The owner is the dialog's separate condition function, not the info node id.
    expect(data.conditionOwnerFunctionName).toBe('DIA_Q_Cond');

    // The editable text is codec-parseable back into the exact structured conditions
    // (no degradation to a raw generic Condition holding a pretty label).
    const parsed = parseConditionExpressionToConditions(data.editableConditionExpression);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.mode).toBe('structured');
    expect(parsed.conditions).toEqual(OWNER_CONDITIONS);
  });

  it('applies an unedited prefill as a no-op: owner conditions preserved, info function untouched', () => {
    const model = buildSeparateConditionFunctionModel();
    const data = getDialogNodeData(model);

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_Q', model },
      {
        type: 'setConditionExpression',
        targetFunctionName: data.conditionOwnerFunctionName,
        expression: data.editableConditionExpression
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No degradation: the condition function still holds the exact structured conditions.
    expect(result.updatedModel.functions.DIA_Q_Cond.conditions).toEqual(OWNER_CONDITIONS);

    // No duplication: the info function is untouched (reference-shared) and still has no
    // conditions copied onto it.
    expect(result.updatedModel.functions.DIA_Q_Info).toBe(model.functions.DIA_Q_Info);
    expect(result.updatedModel.functions.DIA_Q_Info.conditions).toEqual([]);
  });

  it('editing one clause preserves the other conditions unchanged', () => {
    const model = buildSeparateConditionFunctionModel();
    const data = getDialogNodeData(model);

    const editedExpression = String(data.editableConditionExpression).replace('LOG_RUNNING', 'LOG_SUCCESS');
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_Q', model },
      {
        type: 'setConditionExpression',
        targetFunctionName: data.conditionOwnerFunctionName,
        expression: editedExpression
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = result.updatedModel.functions.DIA_Q_Cond.conditions;
    expect(updated[0]).toEqual({
      type: 'VariableCondition',
      variableName: 'MIS_Q',
      operator: '==',
      value: 'LOG_SUCCESS',
      negated: false
    });
    // Untouched siblings survive intact.
    expect(updated[1]).toEqual(OWNER_CONDITIONS[1]);
    expect(updated[2]).toEqual(OWNER_CONDITIONS[2]);

    // The info function is still free of any copied conditions.
    expect(result.updatedModel.functions.DIA_Q_Info.conditions).toEqual([]);
  });
});

describe('serializeConditionsToExpression is a strict inverse of the condition codec', () => {
  const roundTrips = (conditions: DialogCondition[], conditionOperator?: 'AND' | 'OR') => {
    const serialized = serializeConditionsToExpression(conditions, conditionOperator);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error('expected serializable');
    const parsed = parseConditionExpressionToConditions(serialized.expression);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected parseable');
    return parsed;
  };

  it('round-trips supported condition types (&&)', () => {
    const parsed = roundTrips(OWNER_CONDITIONS);
    expect(parsed.mode).toBe('structured');
    expect(parsed.conditions).toEqual(OWNER_CONDITIONS);
  });

  it('round-trips numeric and boolean values without coercion drift', () => {
    const conditions: DialogCondition[] = [
      { type: 'VariableCondition', variableName: 'MIS_A', operator: '==', value: 3, negated: false },
      { type: 'VariableCondition', variableName: 'MIS_B', operator: '!=', value: true, negated: false }
    ] as DialogCondition[];
    const parsed = roundTrips(conditions);
    expect(parsed.conditions).toEqual(conditions);
  });

  it('round-trips OR groups preserving the operator', () => {
    const conditions: DialogCondition[] = [
      { type: 'VariableCondition', variableName: 'MIS_A', operator: '==', value: 1, negated: false },
      { type: 'VariableCondition', variableName: 'MIS_B', operator: '==', value: 2, negated: false }
    ] as DialogCondition[];
    const parsed = roundTrips(conditions, 'OR');
    expect(parsed.conditionOperator).toBe('OR');
    expect(parsed.conditions).toEqual(conditions);
  });

  it('serializes an empty condition list to an empty string', () => {
    expect(serializeConditionsToExpression([], undefined)).toEqual({ ok: true, expression: '' });
    expect(serializeConditionsToExpression(undefined, undefined)).toEqual({ ok: true, expression: '' });
  });

  it('refuses condition types the codec cannot re-parse (read-only in the inspector)', () => {
    expect(
      serializeConditionsToExpression([
        { type: 'NpcHasItemsCondition', npc: 'self', item: 'ItMi_Gold', value: 1 } as DialogCondition
      ]).ok
    ).toBe(false);
  });

  it('refuses negated variable conditions (codec always parses negated:false)', () => {
    expect(
      serializeConditionsToExpression([
        { type: 'VariableCondition', variableName: 'MIS_A', operator: '==', value: 1, negated: true } as DialogCondition
      ]).ok
    ).toBe(false);
  });

  it('refuses string values that would coerce to number/boolean on re-parse', () => {
    expect(
      serializeConditionsToExpression([
        { type: 'VariableCondition', variableName: 'MIS_A', operator: '==', value: '5', negated: false } as DialogCondition
      ]).ok
    ).toBe(false);
    expect(
      serializeConditionsToExpression([
        { type: 'VariableCondition', variableName: 'MIS_A', operator: '==', value: 'TRUE', negated: false } as DialogCondition
      ]).ok
    ).toBe(false);
  });
});
