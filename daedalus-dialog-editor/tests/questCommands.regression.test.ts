import { executeQuestGraphCommand } from '../src/renderer/quest/domain/commands';
import type { SemanticModel } from '../src/renderer/types/global';

const createBranchHeavyModel = (): SemanticModel => ({
  dialogs: {},
  functions: {
    DIA_Dragon_Start_Info: {
      name: 'DIA_Dragon_Start_Info',
      returnType: 'VOID',
      actions: [
        { type: 'Choice', dialogRef: 'self', text: 'Continue hunt', targetFunction: 'DIA_Dragon_Run_Info' },
        { type: 'Choice', dialogRef: 'self', text: 'Report success', targetFunction: 'DIA_Dragon_Success_Info' },
        { type: 'Choice', dialogRef: 'self', text: 'Report failure', targetFunction: 'DIA_Dragon_Fail_Info' }
      ],
      conditions: [],
      calls: []
    },
    DIA_Dragon_Run_Info: {
      name: 'DIA_Dragon_Run_Info',
      returnType: 'VOID',
      actions: [],
      conditions: [],
      calls: []
    },
    DIA_Dragon_Success_Info: {
      name: 'DIA_Dragon_Success_Info',
      returnType: 'VOID',
      actions: [],
      conditions: [
        { type: 'NpcKnowsInfoCondition', npc: 'self', dialogRef: 'DIA_Dragon_Start' },
        { type: 'NpcKnowsInfoCondition', npc: 'hero', dialogRef: 'DIA_Dragon_Start' },
        { type: 'NpcKnowsInfoCondition', npc: 'self', dialogRef: 'DIA_OtherQuest_Start' },
        { type: 'VariableCondition', variableName: 'MIS_DRAGONHUNT', operator: '==', value: 'LOG_RUNNING', negated: false },
        { type: 'VariableCondition', variableName: 'MIS_DRAGONHUNT', operator: '==', value: 'LOG_SUCCESS', negated: false }
      ],
      calls: []
    },
    DIA_Dragon_Fail_Info: {
      name: 'DIA_Dragon_Fail_Info',
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

describe('quest commands regression fixtures', () => {
  it('removeTransition removes only the targeted branch edge in branch-heavy graphs', () => {
    const model = createBranchHeavyModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_DRAGONHUNT', model },
      {
        type: 'removeTransition',
        sourceFunctionName: 'DIA_Dragon_Start_Info',
        targetFunctionName: 'DIA_Dragon_Success_Info'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const choices = (result.updatedModel.functions.DIA_Dragon_Start_Info.actions || []).filter((action) => action.type === 'Choice');
    expect(choices).toHaveLength(2);
    expect(choices.some((action) => action.type === 'Choice' && action.targetFunction === 'DIA_Dragon_Success_Info')).toBe(false);
    expect(choices.some((action) => action.type === 'Choice' && action.targetFunction === 'DIA_Dragon_Fail_Info')).toBe(true);
    expect(choices.some((action) => action.type === 'Choice' && action.targetFunction === 'DIA_Dragon_Run_Info')).toBe(true);
  });

  it('updateTransitionText updates only the intended target branch label', () => {
    const model = createBranchHeavyModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_DRAGONHUNT', model },
      {
        type: 'updateTransitionText',
        sourceFunctionName: 'DIA_Dragon_Start_Info',
        targetFunctionName: 'DIA_Dragon_Fail_Info',
        text: 'Report failure to Andre'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updatedChoices = result.updatedModel.functions.DIA_Dragon_Start_Info.actions || [];
    const failureChoice = updatedChoices.find((action) => action.type === 'Choice' && action.targetFunction === 'DIA_Dragon_Fail_Info');
    const successChoice = updatedChoices.find((action) => action.type === 'Choice' && action.targetFunction === 'DIA_Dragon_Success_Info');

    expect(failureChoice).toMatchObject({ type: 'Choice', text: 'Report failure to Andre' });
    expect(successChoice).toMatchObject({ type: 'Choice', text: 'Report success' });
  });

  it('add/remove knows-info requirement operates by exact npc+dialogRef match', () => {
    const model = createBranchHeavyModel();

    const addResult = executeQuestGraphCommand(
      { questName: 'TOPIC_DRAGONHUNT', model },
      {
        type: 'addKnowsInfoRequirement',
        targetFunctionName: 'DIA_Dragon_Success_Info',
        dialogRef: 'DIA_Dragon_Start',
        npc: 'self'
      }
    );
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    const conditionsAfterAdd = addResult.updatedModel.functions.DIA_Dragon_Success_Info.conditions || [];
    const selfStartMatchesAfterAdd = conditionsAfterAdd.filter(
      (condition) => condition.type === 'NpcKnowsInfoCondition' && condition.npc === 'self' && condition.dialogRef === 'DIA_Dragon_Start'
    );
    expect(selfStartMatchesAfterAdd).toHaveLength(1);

    const removeResult = executeQuestGraphCommand(
      { questName: 'TOPIC_DRAGONHUNT', model: addResult.updatedModel },
      {
        type: 'removeKnowsInfoRequirement',
        targetFunctionName: 'DIA_Dragon_Success_Info',
        dialogRef: 'DIA_Dragon_Start',
        npc: 'self'
      }
    );
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;

    const conditionsAfterRemove = removeResult.updatedModel.functions.DIA_Dragon_Success_Info.conditions || [];
    expect(conditionsAfterRemove.some(
      (condition) => condition.type === 'NpcKnowsInfoCondition' && condition.npc === 'self' && condition.dialogRef === 'DIA_Dragon_Start'
    )).toBe(false);
    expect(conditionsAfterRemove.some(
      (condition) => condition.type === 'NpcKnowsInfoCondition' && condition.npc === 'hero' && condition.dialogRef === 'DIA_Dragon_Start'
    )).toBe(true);
    expect(conditionsAfterRemove.some(
      (condition) => condition.type === 'NpcKnowsInfoCondition' && condition.npc === 'self' && condition.dialogRef === 'DIA_OtherQuest_Start'
    )).toBe(true);
  });

  it('removeConditionLink removes only the exact variable-value branch guard', () => {
    const model = createBranchHeavyModel();
    const result = executeQuestGraphCommand(
      { questName: 'TOPIC_DRAGONHUNT', model },
      {
        type: 'removeConditionLink',
        targetFunctionName: 'DIA_Dragon_Success_Info',
        variableName: 'MIS_DRAGONHUNT',
        value: 'LOG_RUNNING'
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const remainingConditions = result.updatedModel.functions.DIA_Dragon_Success_Info.conditions || [];
    expect(remainingConditions.some(
      (condition) => condition.type === 'VariableCondition' && condition.variableName === 'MIS_DRAGONHUNT' && String(condition.value) === 'LOG_RUNNING'
    )).toBe(false);
    expect(remainingConditions.some(
      (condition) => condition.type === 'VariableCondition' && condition.variableName === 'MIS_DRAGONHUNT' && String(condition.value) === 'LOG_SUCCESS'
    )).toBe(true);
  });
});
