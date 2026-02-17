import type { DialogAction, DialogCondition, SemanticModel } from '../../types/global';
import {
  getCanonicalQuestKey,
  getQuestMisVariableName,
  isCaseInsensitiveMatch,
  normalizeQuestLifecycleState
} from '../../utils/questIdentity';

export interface QuestGuardrailWarning {
  id: string;
  message: string;
  provenance?: {
    functionNames?: string[];
    variables?: string[];
  };
}

export interface QuestGuardrailWarningPolicy {
  blocking: boolean;
}

export const QUEST_GUARDRAIL_WARNING_POLICY_BY_ID: Record<string, QuestGuardrailWarningPolicy> = {
  'failure-status-preservation': { blocking: true },
  'failure-status-regression': { blocking: true }
};

export const getQuestGuardrailWarningPolicy = (warningId: string): QuestGuardrailWarningPolicy => {
  return QUEST_GUARDRAIL_WARNING_POLICY_BY_ID[warningId] || { blocking: false };
};

export const isQuestGuardrailWarningBlocking = (warningId: string): boolean => {
  return getQuestGuardrailWarningPolicy(warningId).blocking;
};

const isFailedOrObsoleteLifecycle = (value: unknown): boolean => {
  const lifecycleState = normalizeQuestLifecycleState(value);
  return lifecycleState === 'failed' || lifecycleState === 'obsolete';
};

const touchesQuest = (actions: DialogAction[] | undefined, conditions: DialogCondition[] | undefined, questName: string, misVarName: string): boolean => {
  const actionTouch = (actions || []).some((action) => {
    if ('topic' in action && isCaseInsensitiveMatch(action.topic, questName)) {
      return true;
    }
    if (action.type === 'SetVariableAction' && isCaseInsensitiveMatch(action.variableName, misVarName)) {
      return true;
    }
    return false;
  });
  const conditionTouch = (conditions || []).some(
    (condition) => condition.type === 'VariableCondition' && isCaseInsensitiveMatch(condition.variableName, misVarName)
  );
  return actionTouch || conditionTouch;
};

const getFailureOrObsoleteStatusFunctions = (semanticModel: SemanticModel, questName: string): string[] => {
  const misVarName = getQuestMisVariableName(questName);
  const functionNames = new Set<string>();

  Object.values(semanticModel.functions || {}).forEach((func) => {
    if (!touchesQuest(func.actions, func.conditions, questName, misVarName)) return;

    const hasFailureStatus = (func.actions || []).some((action) => {
      if (
        action.type === 'LogSetTopicStatus' &&
        isCaseInsensitiveMatch(action.topic, questName)
      ) {
        return isFailedOrObsoleteLifecycle(action.status);
      }
      if (
        action.type === 'SetVariableAction' &&
        action.operator === '=' &&
        isCaseInsensitiveMatch(action.variableName, misVarName)
      ) {
        return isFailedOrObsoleteLifecycle(action.value);
      }
      return false;
    });

    if (hasFailureStatus) {
      functionNames.add(func.name);
    }
  });

  return Array.from(functionNames);
};

export const analyzeQuestGuardrails = (semanticModel: SemanticModel, questName: string | null): QuestGuardrailWarning[] => {
  if (!questName) return [];

  const misVarName = getQuestMisVariableName(questName);
  const warnings: QuestGuardrailWarning[] = [];
  const multiTopicFunctions: string[] = [];
  const sharedMisDeps = new Set<string>();
  const sharedMisFunctionNames = new Set<string>();
  const failedOrObsoleteFunctions = new Set<string>();

  Object.values(semanticModel.functions || {}).forEach((func) => {
    const isQuestRelated = touchesQuest(func.actions, func.conditions, questName, misVarName);
    if (!isQuestRelated) return;

    const topics = new Set<string>();
    (func.actions || []).forEach((action) => {
      if ('topic' in action && action.topic) {
        topics.add(getCanonicalQuestKey(action.topic));
      }

      if (action.type === 'LogSetTopicStatus' && isCaseInsensitiveMatch(action.topic, questName)) {
        if (isFailedOrObsoleteLifecycle(action.status)) {
          failedOrObsoleteFunctions.add(func.name);
        }
      }

      if (
        action.type === 'SetVariableAction' &&
        action.operator === '=' &&
        isCaseInsensitiveMatch(action.variableName, misVarName)
      ) {
        if (isFailedOrObsoleteLifecycle(action.value)) {
          failedOrObsoleteFunctions.add(func.name);
        }
      }
    });

    if (topics.size > 1) {
      multiTopicFunctions.push(func.name);
    }

    (func.conditions || []).forEach((condition) => {
      if (
        condition.type === 'VariableCondition' &&
        /^MIS_/i.test(condition.variableName) &&
        !isCaseInsensitiveMatch(condition.variableName, misVarName)
      ) {
        sharedMisDeps.add(condition.variableName);
        sharedMisFunctionNames.add(func.name);
      }
    });
  });

  if (multiTopicFunctions.length > 0) {
    warnings.push({
      id: 'multi-topic-side-effects',
      message: `Quest logic shares functions with other topics: ${multiTopicFunctions.slice(0, 4).join(', ')}${multiTopicFunctions.length > 4 ? '...' : ''}.`,
      provenance: {
        functionNames: multiTopicFunctions
      }
    });
  }

  if (sharedMisDeps.size > 0) {
    warnings.push({
      id: 'shared-mis-dependencies',
      message: `Quest branches depend on shared state variables: ${Array.from(sharedMisDeps).slice(0, 4).join(', ')}${sharedMisDeps.size > 4 ? '...' : ''}.`,
      provenance: {
        functionNames: Array.from(sharedMisFunctionNames),
        variables: Array.from(sharedMisDeps)
      }
    });
  }

  if (failedOrObsoleteFunctions.size > 0) {
    warnings.push({
      id: 'failure-status-preservation',
      message: 'Quest contains LOG_FAILED/LOG_OBSOLETE status paths. Preserve these paths during edits.',
      provenance: {
        functionNames: Array.from(failedOrObsoleteFunctions)
      }
    });
  }

  return warnings;
};

export const getNewQuestGuardrailWarnings = (
  before: QuestGuardrailWarning[],
  after: QuestGuardrailWarning[]
): QuestGuardrailWarning[] => {
  const beforeBySignature = new Set(
    before.map((warning) => {
      return `${warning.id}:${warning.provenance?.functionNames?.join('|') || ''}:${warning.provenance?.variables?.join('|') || ''}`;
    })
  );

  return after.filter((warning) => {
    const signature = `${warning.id}:${warning.provenance?.functionNames?.join('|') || ''}:${warning.provenance?.variables?.join('|') || ''}`;
    return !beforeBySignature.has(signature);
  });
};

export const getQuestGuardrailDeltaWarnings = (
  beforeModel: SemanticModel,
  afterModel: SemanticModel,
  questName: string | null
): QuestGuardrailWarning[] => {
  if (!questName) return [];

  const warningsBefore = analyzeQuestGuardrails(beforeModel, questName);
  const warningsAfter = analyzeQuestGuardrails(afterModel, questName);
  const beforeWarningIds = new Set(warningsBefore.map((warning) => warning.id));
  const introducedWarnings = getNewQuestGuardrailWarnings(warningsBefore, warningsAfter).filter((warning) => {
    // Preserve-status warnings should not be treated as "new" if the warning already existed
    // and only shifted provenance across functions.
    if (warning.id === 'failure-status-preservation' && beforeWarningIds.has('failure-status-preservation')) {
      return false;
    }
    return true;
  });

  const beforeFailureFunctions = getFailureOrObsoleteStatusFunctions(beforeModel, questName);
  const afterFailureFunctions = new Set(getFailureOrObsoleteStatusFunctions(afterModel, questName));
  const removedFailureFunctions = beforeFailureFunctions.filter((functionName) => !afterFailureFunctions.has(functionName));
  const failureCoverageDropped = afterFailureFunctions.size < beforeFailureFunctions.length;

  if (removedFailureFunctions.length > 0 && failureCoverageDropped) {
    introducedWarnings.push({
      id: 'failure-status-regression',
      message: 'Quest edits removed LOG_FAILED/LOG_OBSOLETE status paths. Preserve non-happy-path outcomes.',
      provenance: {
        functionNames: removedFailureFunctions
      }
    });
  }

  return introducedWarnings;
};
