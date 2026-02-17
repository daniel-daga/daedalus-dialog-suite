import { executeQuestGraphCommand } from '../src/renderer/components/QuestEditor/commands';
import type { SemanticModel } from '../src/renderer/types/global';

const createModel = (): SemanticModel => ({
  dialogs: {},
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
});

describe('quest commands', () => {
  it('appends a topic status action', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'addTopicStatus',
        functionName: 'DIA_Test_Info',
        topic: 'TOPIC_TEST',
        status: 'LOG_SUCCESS'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actions = result.updatedModel.functions.DIA_Test_Info.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'LogSetTopicStatus',
      topic: 'TOPIC_TEST',
      status: 'LOG_SUCCESS'
    });
  });

  it('appends a log entry action', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'addLogEntry',
        functionName: 'DIA_Test_Info',
        topic: 'TOPIC_TEST',
        text: 'Journal updated'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actions = result.updatedModel.functions.DIA_Test_Info.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'LogEntry',
      topic: 'TOPIC_TEST',
      text: 'Journal updated'
    });
  });

  it('adds a SetVariableAction when missing', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'setMisState',
        functionName: 'DIA_Test_Info',
        variableName: 'MIS_TEST',
        value: 'LOG_RUNNING'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actions = result.updatedModel.functions.DIA_Test_Info.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'SetVariableAction',
      variableName: 'MIS_TEST',
      operator: '=',
      value: 'LOG_RUNNING'
    });
  });

  it('updates an existing MIS assignment', () => {
    const model = createModel();
    model.functions.DIA_Test_Info.actions.push({
      type: 'SetVariableAction',
      variableName: 'MIS_TEST',
      operator: '=',
      value: 'LOG_RUNNING'
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'setMisState',
        functionName: 'DIA_Test_Info',
        variableName: 'MIS_TEST',
        value: 'LOG_SUCCESS'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actions = result.updatedModel.functions.DIA_Test_Info.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'SetVariableAction',
      variableName: 'MIS_TEST',
      operator: '=',
      value: 'LOG_SUCCESS'
    });
  });

  it('returns actionable validation errors', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'setMisState',
        functionName: 'DIA_Missing',
        variableName: 'NOT_MIS',
        value: 'LOG_RUNNING'
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('INVALID_VARIABLE_NAME');
  });

  it('validates addTopicStatus input', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'addTopicStatus',
        functionName: 'DIA_Test_Info',
        topic: 'TOPIC_TEST',
        status: '   '
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('INVALID_STATUS');
  });

  it('validates addLogEntry input', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'addLogEntry',
        functionName: 'DIA_Test_Info',
        topic: 'TOPIC_TEST',
        text: '   '
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('INVALID_TEXT');
  });

  it('creates a transition using connectCondition', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'connectCondition',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info',
        choiceText: 'Go'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actions = result.updatedModel.functions.DIA_Test_Info.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'Choice',
      targetFunction: 'DIA_Target_Info',
      text: 'Go'
    });
  });

  it('creates a condition link using connectCondition in requires mode', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'connectCondition',
        mode: 'requires',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info',
        variableName: 'MIS_TEST',
        value: 'LOG_RUNNING'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const conditions = result.updatedModel.functions.DIA_Target_Info.conditions;
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toMatchObject({
      type: 'VariableCondition',
      variableName: 'MIS_TEST',
      operator: '==',
      value: 'LOG_RUNNING',
      negated: false
    });
  });

  it('rejects duplicate transitions', () => {
    const model = createModel();
    model.functions.DIA_Test_Info.actions.push({
      type: 'Choice',
      dialogRef: 'self',
      text: 'Continue',
      targetFunction: 'DIA_Target_Info'
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'connectCondition',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info'
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('TRANSITION_ALREADY_EXISTS');
  });

  it('allows transition creation when target function is outside active file model', () => {
    const model = createModel();
    delete model.functions.DIA_Target_Info;

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'connectCondition',
        mode: 'transition',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info',
        choiceText: 'Continue'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'Choice',
      targetFunction: 'DIA_Target_Info'
    });
  });

  it('allows requires-link creation when source function is outside active file model', () => {
    const model = createModel();
    delete model.functions.DIA_Test_Info;

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'connectCondition',
        mode: 'requires',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info',
        variableName: 'MIS_TEST',
        value: 'LOG_RUNNING'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Target_Info.conditions[0]).toMatchObject({
      type: 'VariableCondition',
      variableName: 'MIS_TEST',
      operator: '==',
      value: 'LOG_RUNNING'
    });
  });

  it('adds NpcKnowsInfo requirement to target function', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'addKnowsInfoRequirement',
        targetFunctionName: 'DIA_Target_Info',
        dialogRef: 'DIA_Test',
        npc: 'self'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Target_Info.conditions[0]).toMatchObject({
      type: 'NpcKnowsInfoCondition',
      npc: 'self',
      dialogRef: 'DIA_Test'
    });
  });

  it('deduplicates identical NpcKnowsInfo requirements', () => {
    const model = createModel();
    model.functions.DIA_Target_Info.conditions.push({
      type: 'NpcKnowsInfoCondition',
      npc: 'self',
      dialogRef: 'DIA_Test'
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'addKnowsInfoRequirement',
        targetFunctionName: 'DIA_Target_Info',
        dialogRef: 'DIA_Test',
        npc: 'self'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Target_Info.conditions).toHaveLength(1);
  });

  it('removes existing NpcKnowsInfo requirement from target function', () => {
    const model = createModel();
    model.functions.DIA_Target_Info.conditions.push({
      type: 'NpcKnowsInfoCondition',
      npc: 'self',
      dialogRef: 'DIA_Test'
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'removeKnowsInfoRequirement',
        targetFunctionName: 'DIA_Target_Info',
        dialogRef: 'DIA_Test',
        npc: 'self'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Target_Info.conditions).toHaveLength(0);
  });

  it('removes a transition using removeTransition', () => {
    const model = createModel();
    model.functions.DIA_Test_Info.actions.push({
      type: 'Choice',
      dialogRef: 'self',
      text: 'Continue',
      targetFunction: 'DIA_Target_Info'
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'removeTransition',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Test_Info.actions).toHaveLength(0);
  });

  it('updates transition text via updateTransitionText', () => {
    const model = createModel();
    model.functions.DIA_Test_Info.actions.push({
      type: 'Choice',
      dialogRef: 'self',
      text: 'Old Text',
      targetFunction: 'DIA_Target_Info'
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'updateTransitionText',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info',
        text: 'New Text'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'Choice',
      targetFunction: 'DIA_Target_Info',
      text: 'New Text'
    });
  });

  it('removes a condition link via removeConditionLink', () => {
    const model = createModel();
    model.functions.DIA_Target_Info.conditions.push({
      type: 'VariableCondition',
      variableName: 'MIS_TEST',
      operator: '==',
      value: 'LOG_RUNNING',
      negated: false
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'removeConditionLink',
        targetFunctionName: 'DIA_Target_Info',
        variableName: 'MIS_TEST',
        value: 'LOG_RUNNING'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Target_Info.conditions).toHaveLength(0);
  });

  it('updates a condition link via updateConditionLink', () => {
    const model = createModel();
    model.functions.DIA_Target_Info.conditions.push({
      type: 'VariableCondition',
      variableName: 'MIS_TEST',
      operator: '==',
      value: 'LOG_RUNNING',
      negated: false
    });

    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'updateConditionLink',
        targetFunctionName: 'DIA_Target_Info',
        oldVariableName: 'MIS_TEST',
        oldValue: 'LOG_RUNNING',
        variableName: 'MIS_TEST',
        value: 'LOG_SUCCESS'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedModel.functions.DIA_Target_Info.conditions[0]).toMatchObject({
      type: 'VariableCondition',
      variableName: 'MIS_TEST',
      operator: '==',
      value: 'LOG_SUCCESS',
      negated: false
    });
  });

  it('returns clear error when removing missing transition', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'removeTransition',
        sourceFunctionName: 'DIA_Test_Info',
        targetFunctionName: 'DIA_Target_Info'
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('TRANSITION_NOT_FOUND');
  });

  it('accepts moveNode for known function nodes without mutating semantic content', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'moveNode',
        nodeId: 'DIA_Test_Info',
        position: { x: 120, y: 340 }
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affectedFunctionNames).toEqual(['DIA_Test_Info']);
    expect(result.updatedModel.functions.DIA_Test_Info.actions).toHaveLength(0);
  });

  it('rejects moveNode for unknown non-external nodes', () => {
    const model = createModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_TEST', model },
      {
        type: 'moveNode',
        nodeId: 'DIA_Unknown',
        position: { x: 1, y: 2 }
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('FUNCTION_NOT_FOUND');
  });
});
