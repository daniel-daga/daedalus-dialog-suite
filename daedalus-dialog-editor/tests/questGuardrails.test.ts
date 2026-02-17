import {
  analyzeQuestGuardrails,
  getQuestGuardrailDeltaWarnings,
  getNewQuestGuardrailWarnings,
  isQuestGuardrailWarningBlocking
} from '../src/renderer/components/QuestEditor/questGuardrails';
import type { SemanticModel } from '../src/renderer/types/global';

const createModel = (functions: Record<string, any>): SemanticModel => ({
  dialogs: {},
  functions,
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

describe('questGuardrails', () => {
  it('warns when quest-related function mutates multiple topics', () => {
    const model = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' },
          { type: 'LogSetTopicStatus', topic: 'TOPIC_OTHER', status: 'LOG_RUNNING' }
        ],
        conditions: [],
        calls: []
      }
    });

    const warnings = analyzeQuestGuardrails(model, 'TOPIC_TEST');
    const warning = warnings.find((entry) => entry.id === 'multi-topic-side-effects');
    expect(warning).toBeDefined();
    expect(warning?.provenance?.functionNames).toContain('DIA_Test_Info');
  });

  it('warns when quest path depends on shared MIS variable', () => {
    const model = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' }
        ],
        conditions: [
          { type: 'VariableCondition', variableName: 'MIS_OTHER', operator: '==', value: 'LOG_RUNNING', negated: false }
        ],
        calls: []
      }
    });

    const warnings = analyzeQuestGuardrails(model, 'TOPIC_TEST');
    const warning = warnings.find((entry) => entry.id === 'shared-mis-dependencies');
    expect(warning).toBeDefined();
    expect(warning?.provenance?.variables).toContain('MIS_OTHER');
    expect(warning?.provenance?.functionNames).toContain('DIA_Test_Info');
  });

  it('warns when failure or obsolete statuses are present', () => {
    const model = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_FAILED' }
        ],
        conditions: [],
        calls: []
      }
    });

    const warnings = analyzeQuestGuardrails(model, 'TOPIC_TEST');
    expect(warnings.some((warning) => warning.id === 'failure-status-preservation')).toBe(true);
  });

  it('warns when failure or obsolete MIS assignments are present', () => {
    const model = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'SetVariableAction', variableName: 'MIS_TEST', operator: '=', value: 'LOG_OBSOLETE' }
        ],
        conditions: [],
        calls: []
      }
    });

    const warnings = analyzeQuestGuardrails(model, 'TOPIC_TEST');
    expect(warnings.some((warning) => warning.id === 'failure-status-preservation')).toBe(true);
  });

  it('computes newly introduced warnings between model revisions', () => {
    const baseModel = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' }
        ],
        conditions: [],
        calls: []
      }
    });
    const nextModel = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' }
        ],
        conditions: [
          { type: 'VariableCondition', variableName: 'MIS_OTHER', operator: '==', value: 'LOG_RUNNING', negated: false }
        ],
        calls: []
      }
    });

    const beforeWarnings = analyzeQuestGuardrails(baseModel, 'TOPIC_TEST');
    const afterWarnings = analyzeQuestGuardrails(nextModel, 'TOPIC_TEST');
    const addedWarnings = getNewQuestGuardrailWarnings(beforeWarnings, afterWarnings);

    expect(addedWarnings).toHaveLength(1);
    expect(addedWarnings[0].id).toBe('shared-mis-dependencies');
  });

  it('maps blocking behavior through warning policy by id', () => {
    expect(isQuestGuardrailWarningBlocking('failure-status-preservation')).toBe(true);
    expect(isQuestGuardrailWarningBlocking('failure-status-regression')).toBe(true);
    expect(isQuestGuardrailWarningBlocking('shared-mis-dependencies')).toBe(false);
    expect(isQuestGuardrailWarningBlocking('some-future-warning')).toBe(false);
  });

  it('flags failure-status regression when failed/obsolete paths are removed', () => {
    const beforeModel = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_FAILED' }
        ],
        conditions: [],
        calls: []
      }
    });
    const afterModel = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' }
        ],
        conditions: [],
        calls: []
      }
    });

    const deltaWarnings = getQuestGuardrailDeltaWarnings(beforeModel, afterModel, 'TOPIC_TEST');
    const regressionWarning = deltaWarnings.find((warning) => warning.id === 'failure-status-regression');

    expect(regressionWarning).toBeDefined();
    expect(regressionWarning?.provenance?.functionNames).toContain('DIA_Test_Info');
  });

  it('flags failure-status regression when MIS failed/obsolete paths are removed', () => {
    const beforeModel = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'SetVariableAction', variableName: 'MIS_TEST', operator: '=', value: 'LOG_FAILED' }
        ],
        conditions: [],
        calls: []
      }
    });
    const afterModel = createModel({
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'VOID',
        actions: [
          { type: 'SetVariableAction', variableName: 'MIS_TEST', operator: '=', value: 'LOG_RUNNING' }
        ],
        conditions: [],
        calls: []
      }
    });

    const deltaWarnings = getQuestGuardrailDeltaWarnings(beforeModel, afterModel, 'TOPIC_TEST');
    const regressionWarning = deltaWarnings.find((warning) => warning.id === 'failure-status-regression');

    expect(regressionWarning).toBeDefined();
    expect(regressionWarning?.provenance?.functionNames).toContain('DIA_Test_Info');
  });
});
