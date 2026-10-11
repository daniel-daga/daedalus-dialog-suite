/**
 * Graph filtering and node materialization for the quest graph.
 *
 * Owns two responsibilities:
 * - `filterGraph`: prunes nodes/edges according to display options
 * - `materializeQuestNodes`: converts internal node data to the
 *   `QuestGraphNode` array of the public graph model
 *
 * Positions are not computed: the litegraph Flow view (the only consumer of
 * visual layout) was removed, so every node carries a zero position and the
 * graph is a pure structural model (nodes + edges).
 */

import type { SemanticModel } from '../../types/global';
import type { QuestGraphBuildOptions, QuestGraphEdge, QuestGraphNode } from '../../types/questGraph';
import type { InternalNodeData } from './questGraphInternalTypes';
import { isStateNode } from './questGraphSharedHelpers';

// ── Graph filter ──────────────────────────────────────────────────────────────

export const filterGraph = (
  nodes: Map<string, InternalNodeData>,
  edges: QuestGraphEdge[],
  options?: QuestGraphBuildOptions
): { nodeDataMap: Map<string, InternalNodeData>; edges: QuestGraphEdge[] } => {
  const {
    onlySelectedQuest = false,
    hideInferredEdges = false,
    showConditions = true,
    showEntrySurfacesOnly = false
  } = options || {};

  const selectedNodeDataMap = new Map(nodes);
  let selectedEdges = [...edges];

  if (hideInferredEdges) {
    selectedEdges = selectedEdges.filter((edge) => !edge.data?.inferred);
  }

  if (!showConditions) {
    for (const [id, data] of selectedNodeDataMap.entries()) {
      if (data.kind === 'condition' || data.kind === 'logical') {
        selectedNodeDataMap.delete(id);
      }
    }
    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  if (onlySelectedQuest) {
    for (const [id, data] of selectedNodeDataMap.entries()) {
      if (!data.touchesSelectedQuest && data.kind !== 'condition' && data.kind !== 'logical') {
        selectedNodeDataMap.delete(id);
      }
    }
    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  if (showEntrySurfacesOnly) {
    const keepNodeIds = new Set<string>();
    for (const [nodeId, data] of selectedNodeDataMap.entries()) {
      if (data.entrySurface) {
        keepNodeIds.add(nodeId);
      }
    }

    selectedEdges.forEach((edge) => {
      if (keepNodeIds.has(edge.source) || keepNodeIds.has(edge.target)) {
        keepNodeIds.add(edge.source);
        keepNodeIds.add(edge.target);
      }
    });

    for (const nodeId of Array.from(selectedNodeDataMap.keys())) {
      if (!keepNodeIds.has(nodeId)) {
        selectedNodeDataMap.delete(nodeId);
      }
    }

    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  const incidentNodeIds = new Set<string>();
  selectedEdges.forEach((edge) => {
    incidentNodeIds.add(edge.source);
    incidentNodeIds.add(edge.target);
  });

  for (const [nodeId, data] of selectedNodeDataMap.entries()) {
    if ((data.kind === 'condition' || data.kind === 'logical') && !incidentNodeIds.has(nodeId)) {
      selectedNodeDataMap.delete(nodeId);
    }
  }

  selectedEdges = selectedEdges.filter(
    (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
  );

  return { nodeDataMap: selectedNodeDataMap, edges: selectedEdges };
};

// ── Node materialization ──────────────────────────────────────────────────────

export const materializeQuestNodes = (
  semanticModel: SemanticModel,
  nodeDataMap: Map<string, InternalNodeData>,
  misVarName: string
): QuestGraphNode[] => {
  const nodes: QuestGraphNode[] = [];
  nodeDataMap.forEach((data, nodeId) => {
    let nodeType: 'dialog' | 'questState' | 'condition' | 'logical' = 'dialog';
    if (data.kind === 'condition') {
      nodeType = 'condition';
    } else if (data.kind === 'logical') {
      nodeType = 'logical';
    } else if (
      data.kind === 'topic' ||
      data.kind === 'topicStatus' ||
      data.kind === 'misState' ||
      data.kind === 'logEntry' ||
      isStateNode(data.type, data.description)
    ) {
      nodeType = 'questState';
    }

    nodes.push({
      id: nodeId,
      position: { x: 0, y: 0 },
      type: nodeType,
      data: {
        label: data.label,
        npc: data.npc,
        description: data.description,
        expression: data.expression,
        operator: data.operator,
        negated: data.negated,
        type: data.type,
        conditionType: data.conditionType,
        status: data.description,
        variableName: semanticModel.variables?.[misVarName] ? misVarName : undefined,
        conditionExpression: data.conditionExpression,
        conditionCount: data.conditionCount,
        conditionMode: data.conditionMode,
        editableConditionExpression: data.editableConditionExpression,
        conditionOwnerFunctionName: data.conditionOwnerFunctionName,
        condition: data.condition,
        conditionIndex: data.conditionIndex,
        kind: data.kind,
        sourceKind: data.sourceKind,
        entrySurface: data.entrySurface,
        latentEntry: data.latentEntry,
        entryReason: data.entryReason,
        inferred: data.inferred,
        touchesSelectedQuest: data.touchesSelectedQuest,
        provenance: data.provenance
      }
    });
  });

  return nodes;
};
