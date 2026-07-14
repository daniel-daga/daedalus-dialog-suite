/**
 * NodeIdentifier — node creation and identification for the quest graph.
 *
 * Owns the two-pass algorithm that walks the semantic model and collects every
 * function that is relevant to a given quest (direct writes/reads, transitive
 * knows-info chains, and transitive variable-producer chains).
 */

import type { DialogAction, DialogCondition, SemanticModel } from '../../types/global';
import type { QuestGraphNodeKind } from '../../types/questGraph';
import type {
  EffectiveConditionEntry,
  IdentifyResult,
  InternalNodeData,
  ProducerMap,
} from './questGraphInternalTypes';
import {
  getConditionSummaryForFunction,
  getDialogContextForFunction,
  getEffectiveConditionEntriesForFunction,
  getFunctionFilePath,
  inferConditionType,
  inferFunctionSourceKind,
  normalizeQuestStateValue,
} from './questGraphSharedHelpers';

// ── Node factory ─────────────────────────────────────────────────────────────

/**
 * Build the `InternalNodeData` object for a function that has been drawn into
 * the graph as an *inferred indirect prerequisite* (i.e. it does not directly
 * touch the selected quest but is reachable via knows-info or variable-value
 * chains).  Centralises a block that was previously duplicated twice.
 */
const buildInferredFunctionNodeData = (
  funcName: string,
  context: { npc: string; dialogName?: string },
  conditionSummary: ReturnType<typeof getConditionSummaryForFunction>,
  filePath: string | undefined
): InternalNodeData => ({
  id: funcName,
  type: 'check',
  label: context.dialogName || funcName,
  npc: context.npc,
  description: 'Indirect prerequisite',
  nodeKind: 'function',
  kind: 'dialog',
  sourceKind: inferFunctionSourceKind(funcName, Boolean(context.dialogName), filePath),
  conditionExpression: conditionSummary.conditionExpression,
  conditionCount: conditionSummary.conditionCount,
  conditionMode: conditionSummary.conditionMode,
  editableConditionExpression: conditionSummary.editableConditionExpression,
  conditionOwnerFunctionName: conditionSummary.conditionOwnerFunctionName,
  entrySurface: false,
  latentEntry: false,
  entryReason: undefined,
  inferred: true,
  touchesSelectedQuest: false,
  provenance: {
    filePath,
    functionName: funcName,
    dialogName: context.dialogName
  }
});

// ── Main identification pass ──────────────────────────────────────────────────

export const identifyQuestNodes = (
  semanticModel: SemanticModel,
  questName: string,
  misVarName: string
): IdentifyResult => {
  const nodeDataMap = new Map<string, InternalNodeData>();
  const producersByVariableAndValue: ProducerMap = new Map();

  const addProducer = (variable: string, value: string, funcName: string) => {
    if (!producersByVariableAndValue.has(variable)) {
      producersByVariableAndValue.set(variable, new Map());
    }
    const valueMap = producersByVariableAndValue.get(variable)!;
    if (!valueMap.has(value)) {
      valueMap.set(value, new Set());
    }
    valueMap.get(value)!.add(funcName);
  };

  Object.values(semanticModel.functions || {}).forEach((func) => {
    const context = getDialogContextForFunction(func.name, semanticModel);
    const effectiveConditionEntries = getEffectiveConditionEntriesForFunction(func.name, semanticModel);
    let isRelevant = false;
    let type: InternalNodeData['type'] = 'check';
    let description = '';
    let kind: QuestGraphNodeKind = 'dialog';
    let touchesSelectedQuest = false;
    let writesSelectedQuest = false;
    let hasQuestPrecondition = false;
    let hasNonQuestPrecondition = false;
    const nonQuestConditionKinds = new Set<string>();

    func.actions?.forEach((action: DialogAction) => {
      if (action.type === 'SetVariableAction' && action.operator === '=') {
        const value = String(action.value);
        addProducer(action.variableName, value, func.name);
      }

      if ('topic' in action && action.topic === questName) {
        isRelevant = true;
        touchesSelectedQuest = true;
        writesSelectedQuest = true;

        if (action.type === 'CreateTopic') {
          type = 'start';
          description = 'Start Quest';
          kind = 'topic';
          addProducer(misVarName, '1', func.name);
        } else if (action.type === 'LogSetTopicStatus') {
          const status = String(action.status);
          kind = 'topicStatus';
          if (status.includes('SUCCESS') || status === '2') {
            type = 'success';
            description = 'Set LOG_SUCCESS';
            addProducer(misVarName, '2', func.name);
          } else if (status.includes('FAILED') || status === '3') {
            type = 'failed';
            description = 'Set LOG_FAILED';
            addProducer(misVarName, '3', func.name);
          } else if (status.includes('RUNNING') || status === '1') {
            type = 'update';
            description = 'Set LOG_RUNNING';
            addProducer(misVarName, '1', func.name);
          } else {
            type = 'update';
            description = `Set Status: ${status}`;
            addProducer(misVarName, status, func.name);
          }
        } else if (action.type === 'LogEntry') {
          if (type === 'check') type = 'update';
          if (!description) {
            description = `Log Entry: ${action.text || '(empty)'}`;
          }
          if (kind === 'dialog') {
            kind = 'logEntry';
          }
        }
      }

      if (action.type === 'SetVariableAction' && action.variableName === misVarName) {
        isRelevant = true;
        touchesSelectedQuest = true;
        writesSelectedQuest = true;
        kind = 'misState';
        if (action.operator === '=') {
          description = `Set ${misVarName} = ${String(action.value)}`;
        }
      }
    });

    effectiveConditionEntries.forEach(({ condition: cond }: EffectiveConditionEntry) => {
      const conditionType = inferConditionType(cond);
      if (conditionType === 'VariableCondition' && 'variableName' in cond && cond.variableName === misVarName) {
        isRelevant = true;
        touchesSelectedQuest = true;
        hasQuestPrecondition = true;
        return;
      }
      hasNonQuestPrecondition = true;
      nonQuestConditionKinds.add(conditionType || 'Condition');
    });

    if (isRelevant) {
      const sourceKind = inferFunctionSourceKind(
        func.name,
        Boolean(context.dialogName),
        getFunctionFilePath(func)
      );
      const entrySurface = writesSelectedQuest && !hasQuestPrecondition;
      const latentEntry = entrySurface && (sourceKind !== 'dialog' || hasNonQuestPrecondition);
      let entryReason: string | undefined;
      if (entrySurface) {
        const reasonParts: string[] = [];
        if (sourceKind !== 'dialog') {
          reasonParts.push(`source=${sourceKind}`);
        }
        if (hasNonQuestPrecondition) {
          const preconditionKinds = Array.from(nonQuestConditionKinds.values());
          if (preconditionKinds.length > 0) {
            reasonParts.push(`gated by ${preconditionKinds.join(', ')}`);
          } else {
            reasonParts.push('gated by non-quest condition(s)');
          }
        } else {
          reasonParts.push('no selected-quest precondition');
        }
        entryReason = reasonParts.join('; ');
      }

      const conditionSummary = getConditionSummaryForFunction(func.name, semanticModel);
      nodeDataMap.set(func.name, {
        id: func.name,
        type,
        label: context.dialogName || func.name,
        npc: context.npc,
        description,
        nodeKind: 'function',
        kind,
        sourceKind,
        conditionExpression: conditionSummary.conditionExpression,
        conditionCount: conditionSummary.conditionCount,
        conditionMode: conditionSummary.conditionMode,
        editableConditionExpression: conditionSummary.editableConditionExpression,
        conditionOwnerFunctionName: conditionSummary.conditionOwnerFunctionName,
        entrySurface,
        latentEntry,
        entryReason,
        inferred: false,
        touchesSelectedQuest,
        provenance: {
          filePath: getFunctionFilePath(func),
          functionName: func.name,
          dialogName: context.dialogName
        }
      });
    }
  });

  // Expand via knows-info references.
  let addedAny = true;
  while (addedAny) {
    addedAny = false;
    Object.values(semanticModel.functions || {}).forEach((func) => {
      if (nodeDataMap.has(func.name)) return;
      let isRelevantByKnows = false;

      func.conditions?.forEach((cond: DialogCondition) => {
        if (inferConditionType(cond) !== 'NpcKnowsInfoCondition' || !('dialogRef' in cond)) return;
        for (const relevantNode of nodeDataMap.values()) {
          if (relevantNode.label === cond.dialogRef) {
            isRelevantByKnows = true;
            break;
          }
        }
      });

      if (isRelevantByKnows) {
        const context = getDialogContextForFunction(func.name, semanticModel);
        const conditionSummary = getConditionSummaryForFunction(func.name, semanticModel);
        nodeDataMap.set(
          func.name,
          buildInferredFunctionNodeData(func.name, context, conditionSummary, getFunctionFilePath(func))
        );
        addedAny = true;
      }
    });
  }

  // Expand via variable producers that satisfy checks in relevant functions.
  addedAny = true;
  while (addedAny) {
    addedAny = false;

    nodeDataMap.forEach((_, consumerId) => {
      const consumerFunc = semanticModel.functions?.[consumerId];
      if (!consumerFunc) return;

      consumerFunc.conditions?.forEach((cond: DialogCondition) => {
        if (inferConditionType(cond) !== 'VariableCondition' || !('variableName' in cond) || cond.operator !== '==') return;
        const valueMap = producersByVariableAndValue.get(cond.variableName);
        if (!valueMap) return;

        let checkValue = String(cond.value);
        if (cond.variableName === misVarName) {
          checkValue = normalizeQuestStateValue(checkValue);
        }

        const producers = valueMap.get(checkValue);
        if (!producers) return;

        producers.forEach((producerId) => {
          if (nodeDataMap.has(producerId)) return;
          const producerFunc = semanticModel.functions?.[producerId];
          if (!producerFunc) return;

          const context = getDialogContextForFunction(producerId, semanticModel);
          const conditionSummary = getConditionSummaryForFunction(producerId, semanticModel);
          nodeDataMap.set(
            producerId,
            buildInferredFunctionNodeData(producerId, context, conditionSummary, getFunctionFilePath(producerFunc))
          );
          addedAny = true;
        });
      });
    });
  }

  return { nodeDataMap, producersByVariableAndValue };
};
