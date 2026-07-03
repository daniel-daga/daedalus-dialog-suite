import { executeQuestGraphCommand } from '../src/renderer/quest/domain/commands';
import type { QuestGraphCommand } from '../src/renderer/quest/domain/commands';
import type { SemanticModel } from '../src/renderer/types/global';

// Mirrors the fixture shape used by questCommands.setMisState.test.ts, with a
// populated `dialogs` subtree so reference-sharing of untouched subtrees is
// meaningful to assert.
const createModel = (): SemanticModel => ({
  dialogs: {
    DIA_Test: { name: 'DIA_Test', npc: 'self', nr: 1, condition: '', information: '', permanent: false, important: false }
  },
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [],
      conditions: [],
      calls: []
    },
    DIA_Target_Info: {
      name: 'DIA_Target_Info',
      returnType: 'VOID',
      actions: [],
      conditions: [],
      calls: []
    }
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
} as unknown as SemanticModel);

interface Scenario {
  name: string;
  setup?: (model: SemanticModel) => void;
  command: QuestGraphCommand;
  touched: string;
  untouched: string;
}

const scenarios: Scenario[] = [
  {
    name: 'setMisState',
    command: {
      type: 'setMisState',
      functionName: 'DIA_Test_Info',
      variableName: 'MIS_TEST',
      value: 'LOG_RUNNING'
    },
    touched: 'DIA_Test_Info',
    untouched: 'DIA_Target_Info'
  },
  {
    name: 'addTopicStatus',
    command: {
      type: 'addTopicStatus',
      functionName: 'DIA_Test_Info',
      topic: 'TOPIC_TEST',
      status: 'LOG_SUCCESS'
    },
    touched: 'DIA_Test_Info',
    untouched: 'DIA_Target_Info'
  },
  {
    name: 'addLogEntry',
    command: {
      type: 'addLogEntry',
      functionName: 'DIA_Test_Info',
      topic: 'TOPIC_TEST',
      text: 'Journal updated'
    },
    touched: 'DIA_Test_Info',
    untouched: 'DIA_Target_Info'
  },
  {
    name: 'connectCondition (transition)',
    command: {
      type: 'connectCondition',
      sourceFunctionName: 'DIA_Test_Info',
      targetFunctionName: 'DIA_Target_Info',
      choiceText: 'Go'
    },
    touched: 'DIA_Test_Info',
    untouched: 'DIA_Target_Info'
  },
  {
    name: 'connectCondition (requires)',
    command: {
      type: 'connectCondition',
      mode: 'requires',
      sourceFunctionName: 'DIA_Test_Info',
      targetFunctionName: 'DIA_Target_Info',
      variableName: 'MIS_TEST',
      value: 'LOG_RUNNING'
    },
    touched: 'DIA_Target_Info',
    untouched: 'DIA_Test_Info'
  },
  {
    name: 'addKnowsInfoRequirement',
    command: {
      type: 'addKnowsInfoRequirement',
      targetFunctionName: 'DIA_Target_Info',
      dialogRef: 'DIA_Test',
      npc: 'self'
    },
    touched: 'DIA_Target_Info',
    untouched: 'DIA_Test_Info'
  },
  {
    name: 'removeKnowsInfoRequirement',
    setup: (model) => {
      model.functions.DIA_Target_Info.conditions!.push({
        type: 'NpcKnowsInfoCondition',
        npc: 'self',
        dialogRef: 'DIA_Test'
      });
    },
    command: {
      type: 'removeKnowsInfoRequirement',
      targetFunctionName: 'DIA_Target_Info',
      dialogRef: 'DIA_Test',
      npc: 'self'
    },
    touched: 'DIA_Target_Info',
    untouched: 'DIA_Test_Info'
  },
  {
    name: 'removeTransition',
    setup: (model) => {
      model.functions.DIA_Test_Info.actions!.push({
        type: 'Choice',
        dialogRef: 'self',
        text: 'Continue',
        targetFunction: 'DIA_Target_Info'
      });
    },
    command: {
      type: 'removeTransition',
      sourceFunctionName: 'DIA_Test_Info',
      targetFunctionName: 'DIA_Target_Info'
    },
    touched: 'DIA_Test_Info',
    untouched: 'DIA_Target_Info'
  },
  {
    name: 'updateTransitionText',
    setup: (model) => {
      model.functions.DIA_Test_Info.actions!.push({
        type: 'Choice',
        dialogRef: 'self',
        text: 'Old Text',
        targetFunction: 'DIA_Target_Info'
      });
    },
    command: {
      type: 'updateTransitionText',
      sourceFunctionName: 'DIA_Test_Info',
      targetFunctionName: 'DIA_Target_Info',
      text: 'New Text'
    },
    touched: 'DIA_Test_Info',
    untouched: 'DIA_Target_Info'
  },
  {
    name: 'updateConditionLink',
    setup: (model) => {
      model.functions.DIA_Target_Info.conditions!.push({
        type: 'VariableCondition',
        variableName: 'MIS_TEST',
        operator: '==',
        value: 'LOG_RUNNING',
        negated: false
      });
    },
    command: {
      type: 'updateConditionLink',
      targetFunctionName: 'DIA_Target_Info',
      oldVariableName: 'MIS_TEST',
      oldValue: 'LOG_RUNNING',
      variableName: 'MIS_TEST',
      value: 'LOG_SUCCESS'
    },
    touched: 'DIA_Target_Info',
    untouched: 'DIA_Test_Info'
  },
  {
    name: 'setConditionExpression',
    command: {
      type: 'setConditionExpression',
      targetFunctionName: 'DIA_Target_Info',
      expression: 'MIS_TEST == LOG_RUNNING'
    },
    touched: 'DIA_Target_Info',
    untouched: 'DIA_Test_Info'
  }
];

describe('quest command copy-on-write structural sharing', () => {
  it.each(scenarios)('$name shares untouched subtrees by reference', ({ setup, command, touched, untouched }) => {
    const model = createModel();
    setup?.(model);

    const result = executeQuestGraphCommand({ questName: 'TOPIC_TEST', model }, command);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The untouched sibling function is reference-shared with the input model.
    expect(result.updatedModel.functions[untouched]).toBe(model.functions[untouched]);
    // Unrelated subtrees (dialogs map) are reference-shared with the input model.
    expect(result.updatedModel.dialogs).toBe(model.dialogs);
    // The mutated function is a fresh clone, so the input model is not mutated in place.
    expect(result.updatedModel.functions[touched]).not.toBe(model.functions[touched]);
  });

  it('moveNode returns the input model unchanged (no clone at all)', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      { type: 'moveNode', nodeId: 'DIA_Test_Info', position: { x: 120, y: 340 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel).toBe(model);
    expect(result.affectedFunctionNames).toEqual(['DIA_Test_Info']);
  });
});
