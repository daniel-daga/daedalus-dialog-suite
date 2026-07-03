import { QuestEditingService } from '../src/renderer/quest/application/QuestEditingService';
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

const withTopicStatus = (status: string): SemanticModel =>
  createModel({
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status }],
      conditions: [],
      calls: []
    }
  });

const withSharedMisDependency = (): SemanticModel =>
  createModel({
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'LogSetTopicStatus', topic: 'TOPIC_TEST', status: 'LOG_RUNNING' }],
      conditions: [
        { type: 'VariableCondition', variableName: 'MIS_OTHER', operator: '==', value: 'LOG_RUNNING', negated: false }
      ],
      calls: []
    }
  });

describe('QuestEditingService.applyQuestUpdates', () => {
  it('refuses to apply and returns blocking warnings when an update introduces a blocking delta', () => {
    const currentModel = withTopicStatus('LOG_FAILED');
    const updatedModel = withTopicStatus('LOG_RUNNING');
    const applyQuestModelsWithHistory = jest.fn();

    const result = QuestEditingService.applyQuestUpdates(
      'TOPIC_TEST',
      [{ filePath: 'C:/tmp/test.d', updatedModel }],
      {
        getCurrentModel: () => currentModel,
        applyQuestModelsWithHistory
      }
    );

    expect(result.ok).toBe(false);
    expect(result.blockingWarnings.map((warning) => warning.id)).toContain('failure-status-regression');
    expect(applyQuestModelsWithHistory).not.toHaveBeenCalled();
  });

  it('applies when only non-blocking warnings are introduced', () => {
    const currentModel = withTopicStatus('LOG_RUNNING');
    const updatedModel = withSharedMisDependency();
    const applyQuestModelsWithHistory = jest.fn();

    const result = QuestEditingService.applyQuestUpdates(
      'TOPIC_TEST',
      [{ filePath: 'C:/tmp/test.d', updatedModel }],
      {
        getCurrentModel: () => currentModel,
        applyQuestModelsWithHistory
      }
    );

    expect(result.ok).toBe(true);
    expect(result.blockingWarnings).toEqual([]);
    expect(applyQuestModelsWithHistory).toHaveBeenCalledTimes(1);
    expect(applyQuestModelsWithHistory).toHaveBeenCalledWith([
      { filePath: 'C:/tmp/test.d', model: updatedModel }
    ]);
  });

  it('validates against apply-time file state, not the stale preview model (TOCTOU)', () => {
    // The update was previewed against a model whose DIA had LOG_RUNNING, so the
    // preview-time delta produced no blocking warning.
    const previewModel = withTopicStatus('LOG_RUNNING');
    const updatedModel = withTopicStatus('LOG_RUNNING');

    // Sanity: the stale preview delta is non-blocking (nothing to guard against).
    const staleWouldPass = QuestEditingService.applyQuestUpdates(
      'TOPIC_TEST',
      [{ filePath: 'C:/tmp/test.d', updatedModel }],
      {
        getCurrentModel: () => previewModel,
        applyQuestModelsWithHistory: jest.fn()
      }
    );
    expect(staleWouldPass.ok).toBe(true);

    // But the CURRENT fileStore model has since changed to carry a LOG_FAILED path.
    // Applying the same update now regresses failure coverage and must be refused.
    const currentModel = withTopicStatus('LOG_FAILED');
    const applyQuestModelsWithHistory = jest.fn();

    const result = QuestEditingService.applyQuestUpdates(
      'TOPIC_TEST',
      [{ filePath: 'C:/tmp/test.d', updatedModel }],
      {
        getCurrentModel: () => currentModel,
        applyQuestModelsWithHistory
      }
    );

    expect(result.ok).toBe(false);
    expect(result.blockingWarnings.map((warning) => warning.id)).toContain('failure-status-regression');
    expect(applyQuestModelsWithHistory).not.toHaveBeenCalled();
  });
});
