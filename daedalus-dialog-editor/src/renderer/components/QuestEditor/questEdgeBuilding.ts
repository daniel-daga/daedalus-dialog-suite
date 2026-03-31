/**
 * EdgeBuilder — edge construction for the quest graph.
 *
 * Owns the edge-factory functions (one per edge kind) and the main
 * `buildQuestEdges` pass that walks the node map and emits all edges.
 */

import { MarkerType } from 'reactflow';
import type { DialogAction, SemanticModel } from '../../types/global';
import type { QuestGraphConditionType, QuestGraphEdge, QuestGraphProvenance } from '../../types/questGraph';
import {
  CHOICE_EDGE_COLOR,
  CONDITION_EDGE_COLOR,
  ENTRY_EDGE_COLOR,
  KNOWS_EDGE_COLOR,
  VARIABLE_EDGE_COLOR,
} from './constants/questGraphConstants';
import type { EdgeBuildResult, InternalNodeData, ProducerMap } from './questGraphInternalTypes';
import {
  buildGeneratedConditionNodeId,
  buildGeneratedExternalEntryNodeId,
  getConditionExpression,
  getConditionNodeLabel,
  getEffectiveConditionEntriesForFunction,
  getFunctionFilePath,
  inferConditionType,
  isNegatedCondition,
  isStateNode,
  normalizeQuestStateValue,
  shortenExpression,
} from './questGraphSharedHelpers';

// ── Edge factories ────────────────────────────────────────────────────────────

export const buildChoiceEdge = (
  consumerId: string,
  targetFunc: string,
  actionIndex: number,
  actionText: string | undefined,
  sourceHandle: string,
  targetHandle: string,
  provenance: QuestGraphProvenance
): QuestGraphEdge => ({
  id: `choice-${consumerId}-${targetFunc}-${actionIndex}`,
  source: consumerId,
  target: targetFunc,
  sourceHandle,
  targetHandle,
  label: actionText,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: CHOICE_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '5,5' },
  labelStyle: { fill: CHOICE_EDGE_COLOR, fontSize: 10 },
  data: { kind: 'transitions', choiceIndex: actionIndex, inferred: false, provenance }
});

export const buildConditionEdge = (
  conditionNodeId: string,
  consumerId: string,
  conditionPosition: number,
  expression: string,
  conditionLabel: string,
  conditionType: QuestGraphConditionType,
  cond: { operator?: '==' | '!=' | '<' | '>' | '<=' | '>=' },
  ownerFunctionName: string,
  provenance: QuestGraphProvenance
): QuestGraphEdge => ({
  id: `condition-edge-${conditionNodeId}-${consumerId}`,
  source: conditionNodeId,
  target: consumerId,
  sourceHandle: 'out-bool',
  targetHandle: `in-condition-${conditionPosition}`,
  label: `requires ${shortenExpression(expression || conditionLabel, 40)}`,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: CONDITION_EDGE_COLOR, strokeWidth: 2 },
  labelStyle: { fill: CONDITION_EDGE_COLOR, fontSize: 10 },
  data: {
    kind: 'requires',
    inferred: false,
    expression,
    operator: conditionType === 'VariableCondition' ? cond.operator : undefined,
    provenance: { functionName: ownerFunctionName, dialogName: provenance.dialogName }
  }
});

export const buildKnowsEdge = (
  producerFunc: string,
  consumerId: string,
  conditionPosition: number,
  producerDialogName: string,
  inferred: boolean,
  ownerFunctionName: string,
  provenance: QuestGraphProvenance
): QuestGraphEdge => ({
  id: `knows-${producerFunc}-${consumerId}`,
  source: producerFunc,
  target: consumerId,
  sourceHandle: 'out-finished',
  targetHandle: `in-condition-${conditionPosition}`,
  label: `requires knows ${producerDialogName}`,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: KNOWS_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '3,3' },
  labelStyle: { fill: KNOWS_EDGE_COLOR, fontSize: 10 },
  data: {
    kind: 'requires',
    inferred,
    expression: `Npc_KnowsInfo(..., ${producerDialogName})`,
    provenance: { functionName: ownerFunctionName, dialogName: provenance.dialogName }
  }
});

export const buildVariableEdge = (
  producerFunc: string,
  consumerId: string,
  conditionPosition: number,
  variableName: string,
  rawValue: string,
  operator: string,
  inferred: boolean,
  ownerFunctionName: string,
  provenance: QuestGraphProvenance
): QuestGraphEdge => ({
  id: `var-${variableName}-${producerFunc}-${consumerId}`,
  source: producerFunc,
  target: consumerId,
  sourceHandle: 'out-state',
  targetHandle: `in-condition-${conditionPosition}`,
  label: `requires ${variableName} == ${rawValue}`,
  type: 'smoothstep',
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: VARIABLE_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '3,3' },
  labelStyle: { fill: VARIABLE_EDGE_COLOR, fontSize: 10 },
  data: {
    kind: 'requires',
    inferred,
    expression: `${variableName} ${operator} ${rawValue}`,
    operator: operator as '==' | '!=' | '<' | '>' | '<=' | '>=' | undefined,
    provenance: { functionName: ownerFunctionName, dialogName: provenance.dialogName }
  }
});

export const buildExternalEntryEdge = (
  externalId: string,
  consumerId: string,
  entryReason: string,
  provenance: QuestGraphProvenance
): QuestGraphEdge => ({
  id: `external-entry-edge-${externalId}-${consumerId}`,
  source: externalId,
  target: consumerId,
  sourceHandle: 'out-bool',
  targetHandle: 'in-condition-0',
  label: 'requires entry trigger',
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: ENTRY_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '3,3' },
  labelStyle: { fill: ENTRY_EDGE_COLOR, fontSize: 10 },
  data: {
    kind: 'requires',
    inferred: true,
    expression: entryReason || 'entry trigger',
    provenance: { functionName: consumerId, dialogName: provenance.dialogName }
  }
});

// ── Main edge-building pass ───────────────────────────────────────────────────

export const buildQuestEdges = (
  semanticModel: SemanticModel,
  nodeDataMap: Map<string, InternalNodeData>,
  producersByVariableAndValue: ProducerMap,
  misVarName: string
): EdgeBuildResult => {
  const edges: QuestGraphEdge[] = [];
  const unresolvedConditionNodes = new Map<string, InternalNodeData>();
  const adjacency = new Map<string, string[]>();

  const addAdjacency = (sourceId: string, targetId: string) => {
    if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
    adjacency.get(sourceId)!.push(targetId);
  };

  nodeDataMap.forEach((_, funcName) => {
    if (!adjacency.has(funcName)) adjacency.set(funcName, []);
  });

  nodeDataMap.forEach((consumerData, consumerId) => {
    const func = semanticModel.functions[consumerId];
    if (!func) return;
    const effectiveConditionEntries = getEffectiveConditionEntriesForFunction(consumerId, semanticModel);
    let addedConditionEdge = false;

    func.actions?.forEach((action: DialogAction, actionIndex: number) => {
      if (action.type !== 'Choice') return;
      const targetFunc = (action as { targetFunction?: string }).targetFunction;
      if (!targetFunc || !nodeDataMap.has(targetFunc)) return;
      const targetData = nodeDataMap.get(targetFunc)!;

      const sourceHandle = isStateNode(consumerData.type, consumerData.description)
        ? 'out-state'
        : 'out-finished';
      const targetHandle = isStateNode(targetData.type, targetData.description)
        ? 'in-trigger'
        : 'in-condition-0';

      edges.push(buildChoiceEdge(
        consumerId,
        targetFunc,
        actionIndex,
        (action as { text?: string }).text,
        sourceHandle,
        targetHandle,
        { functionName: consumerId, dialogName: consumerData.provenance?.dialogName }
      ));
      addAdjacency(consumerId, targetFunc);
    });

    effectiveConditionEntries.forEach(({ condition: cond, ownerFunctionName, ownerConditionIndex }, conditionPosition) => {
      const conditionType = inferConditionType(cond) || 'Condition';
      const expression = getConditionExpression(cond).trim();
      const conditionNodeId = buildGeneratedConditionNodeId(
        consumerId,
        ownerFunctionName,
        ownerConditionIndex,
        expression,
        conditionType
      );
      const conditionLabel = getConditionNodeLabel(conditionType, expression);
      const ownerFilePath = getFunctionFilePath(semanticModel.functions?.[ownerFunctionName]);

      if (!unresolvedConditionNodes.has(conditionNodeId)) {
        unresolvedConditionNodes.set(conditionNodeId, {
          id: conditionNodeId,
          type: 'check',
          label: conditionLabel,
          npc: 'External/World',
          description: `${conditionLabel} prerequisite`,
          nodeKind: 'external-condition',
          expression,
          kind: 'condition',
          conditionType,
          negated: isNegatedCondition(cond),
          sourceKind: 'external',
          entrySurface: false,
          latentEntry: false,
          entryReason: undefined,
          inferred: false,
          touchesSelectedQuest: false,
          condition: cond,
          conditionIndex: ownerConditionIndex,
          provenance: {
            filePath: ownerFilePath,
            functionName: ownerFunctionName,
            dialogName: consumerData.provenance?.dialogName
          }
        });
      }

      edges.push(buildConditionEdge(
        conditionNodeId,
        consumerId,
        conditionPosition,
        expression,
        conditionLabel,
        conditionType,
        cond as { operator?: '==' | '!=' | '<' | '>' | '<=' | '>=' },
        ownerFunctionName,
        { functionName: ownerFunctionName, dialogName: consumerData.provenance?.dialogName }
      ));
      addedConditionEdge = true;
      addAdjacency(conditionNodeId, consumerId);

      if (conditionType === 'NpcKnowsInfoCondition' && 'dialogRef' in cond) {
        const producerDialogName = cond.dialogRef;
        const producerDialog = semanticModel.dialogs[producerDialogName];
        let producerFunc: string | null = null;
        if (producerDialog) {
          const info = producerDialog.properties.information;
          if (typeof info === 'string') producerFunc = info;
          else if (typeof info === 'object' && info?.name) producerFunc = info.name;
        }

        if (producerFunc && nodeDataMap.has(producerFunc)) {
          edges.push(buildKnowsEdge(
            producerFunc,
            consumerId,
            conditionPosition,
            producerDialogName,
            nodeDataMap.get(producerFunc)?.inferred || false,
            ownerFunctionName,
            { functionName: ownerFunctionName, dialogName: consumerData.provenance?.dialogName }
          ));
          addAdjacency(producerFunc, consumerId);
        }
        return;
      }

      if (conditionType === 'VariableCondition' && 'variableName' in cond) {
        const variableName = cond.variableName;
        const operator = cond.operator || (cond.negated ? '!=' : '==');
        if (operator !== '==') return;

        const rawValue = String(cond.value);
        const normalizedValue =
          variableName === misVarName ? normalizeQuestStateValue(rawValue) : rawValue;
        const valueMap = producersByVariableAndValue.get(variableName);
        if (!valueMap) return;

        const producers = valueMap.get(normalizedValue) || new Set<string>();
        producers.forEach((producerId) => {
          if (producerId === consumerId || !nodeDataMap.has(producerId)) return;
          const producerNode = nodeDataMap.get(producerId)!;
          edges.push(buildVariableEdge(
            producerId,
            consumerId,
            conditionPosition,
            variableName,
            rawValue,
            operator,
            producerNode.inferred,
            ownerFunctionName,
            { functionName: ownerFunctionName, dialogName: consumerData.provenance?.dialogName }
          ));
          addAdjacency(producerId, consumerId);
        });
      }
    });

    if (consumerData.entrySurface && !addedConditionEdge) {
      const externalId = buildGeneratedExternalEntryNodeId(
        consumerId,
        consumerData.entryReason || consumerData.sourceKind || 'world_trigger'
      );
      if (!unresolvedConditionNodes.has(externalId)) {
        const triggerLabel = consumerData.sourceKind === 'item'
          ? 'Item Trigger'
          : consumerData.sourceKind === 'event'
            ? 'Event Trigger'
            : consumerData.sourceKind === 'startup'
              ? 'Startup Trigger'
              : 'World Trigger';
        unresolvedConditionNodes.set(externalId, {
          id: externalId,
          type: 'check',
          label: triggerLabel,
          npc: 'External/World',
          description: consumerData.entryReason || 'Implicit entry trigger',
          nodeKind: 'external-condition',
          expression: consumerData.entryReason || triggerLabel,
          kind: 'condition',
          conditionType: 'ExternalTriggerCondition',
          negated: false,
          sourceKind: 'external',
          entrySurface: false,
          latentEntry: false,
          entryReason: undefined,
          inferred: true,
          touchesSelectedQuest: false
        });
      }

      edges.push(buildExternalEntryEdge(
        externalId,
        consumerId,
        consumerData.entryReason || 'entry trigger',
        { functionName: consumerId, dialogName: consumerData.provenance?.dialogName }
      ));
      addAdjacency(externalId, consumerId);
    }
  });

  unresolvedConditionNodes.forEach((nodeData, nodeId) => {
    if (!nodeDataMap.has(nodeId)) {
      nodeDataMap.set(nodeId, nodeData);
    }
    if (!adjacency.has(nodeId)) adjacency.set(nodeId, []);
  });

  return { edges, adjacency };
};
