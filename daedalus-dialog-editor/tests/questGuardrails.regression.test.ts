import { analyzeQuestGuardrails, getQuestGuardrailDeltaWarnings } from '../src/renderer/quest/domain/guardrails';
import type { SemanticModel } from '../src/renderer/types/global';

const createBaseMdkLikeModel = (): SemanticModel => ({
  dialogs: {},
  functions: {
    DIA_DragonHunt_Start: {
      name: 'DIA_DragonHunt_Start',
      returnType: 'VOID',
      actions: [
        { type: 'CreateTopic', topic: 'TOPIC_DRAGONHUNT', topicType: 'LOG_MISSION' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_RUNNING' },
        { type: 'Choice', dialogRef: 'self', text: 'Report failure', targetFunction: 'DIA_DragonHunt_Fail' },
        { type: 'Choice', dialogRef: 'self', text: 'Report success', targetFunction: 'DIA_DragonHunt_Success' }
      ],
      conditions: [],
      calls: []
    },
    DIA_DragonHunt_Fail: {
      name: 'DIA_DragonHunt_Fail',
      returnType: 'VOID',
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_FAILED' }
      ],
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_GUILD', operator: '==', value: 'LOG_RUNNING', negated: false }
      ],
      calls: []
    },
    DIA_DragonHunt_Success: {
      name: 'DIA_DragonHunt_Success',
      returnType: 'VOID',
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_SUCCESS' }
      ],
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_GUILD', operator: '==', value: 'LOG_RUNNING', negated: false }
      ],
      calls: []
    },
    DIA_SharedQuestHub: {
      name: 'DIA_SharedQuestHub',
      returnType: 'VOID',
      actions: [
        { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_RUNNING' },
        { type: 'LogSetTopicStatus', topic: 'TOPIC_GUILDJOIN', status: 'LOG_RUNNING' }
      ],
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_GUILDJOIN', operator: '==', value: 'LOG_SUCCESS', negated: false }
      ],
      calls: []
    }
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

describe('questGuardrails regression fixtures', () => {
  it('flags mixed-topic side effects and shared MIS deps in branch-heavy quest patterns', () => {
    const warnings = analyzeQuestGuardrails(createBaseMdkLikeModel(), 'TOPIC_DRAGONHUNT');
    const warningIds = warnings.map((warning) => warning.id);

    expect(warningIds).toContain('multi-topic-side-effects');
    expect(warningIds).toContain('shared-mis-dependencies');
    expect(warningIds).toContain('failure-status-preservation');

    const multiTopicWarning = warnings.find((warning) => warning.id === 'multi-topic-side-effects');
    expect(multiTopicWarning?.provenance?.functionNames).toContain('DIA_SharedQuestHub');

    const sharedMisWarning = warnings.find((warning) => warning.id === 'shared-mis-dependencies');
    expect(sharedMisWarning?.provenance?.variables).toContain('MIS_GUILD');
    expect(sharedMisWarning?.provenance?.variables).toContain('MIS_GUILDJOIN');
  });

  it('detects failure-status regression when branch outcomes lose failed/obsolete paths', () => {
    const beforeModel = createBaseMdkLikeModel();
    const afterModel = createBaseMdkLikeModel();
    afterModel.functions.DIA_DragonHunt_Fail.actions = [
      { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_RUNNING' }
    ];

    const deltaWarnings = getQuestGuardrailDeltaWarnings(beforeModel, afterModel, 'TOPIC_DRAGONHUNT');
    const regression = deltaWarnings.find((warning) => warning.id === 'failure-status-regression');

    expect(regression).toBeDefined();
    expect(regression?.provenance?.functionNames).toContain('DIA_DragonHunt_Fail');
  });

  it('does not flag regression when failed/obsolete coverage is preserved via relocation', () => {
    const beforeModel = createBaseMdkLikeModel();
    const afterModel = createBaseMdkLikeModel();
    afterModel.functions.DIA_DragonHunt_Fail.actions = [
      { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_RUNNING' }
    ];
    afterModel.functions.DIA_SharedQuestHub.actions = [
      ...afterModel.functions.DIA_SharedQuestHub.actions,
      { type: 'LogSetTopicStatus', topic: 'TOPIC_DRAGONHUNT', status: 'LOG_OBSOLETE' }
    ];

    const deltaWarnings = getQuestGuardrailDeltaWarnings(beforeModel, afterModel, 'TOPIC_DRAGONHUNT');
    expect(deltaWarnings.some((warning) => warning.id === 'failure-status-regression')).toBe(false);
    expect(deltaWarnings.some((warning) => warning.id === 'failure-status-preservation')).toBe(false);
  });

  it('detects MIS-driven failure regression when terminal MIS assignment is removed', () => {
    const beforeModel = createBaseMdkLikeModel();
    beforeModel.functions.DIA_DragonHunt_Fail.actions = [
      { type: 'SetVariableAction', variableName: 'MIS_DRAGONHUNT', operator: '=', value: 'LOG_OBSOLETE' }
    ];

    const afterModel = createBaseMdkLikeModel();
    afterModel.functions.DIA_DragonHunt_Fail.actions = [
      { type: 'SetVariableAction', variableName: 'MIS_DRAGONHUNT', operator: '=', value: 'LOG_RUNNING' }
    ];

    const deltaWarnings = getQuestGuardrailDeltaWarnings(beforeModel, afterModel, 'TOPIC_DRAGONHUNT');
    expect(deltaWarnings.some((warning) => warning.id === 'failure-status-regression')).toBe(true);
  });
});
