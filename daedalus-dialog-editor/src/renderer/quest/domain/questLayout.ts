/**
 * LayoutCalculator — graph filtering and Dagre layout for the quest graph.
 *
 * Owns two responsibilities:
 * - `filterGraph`: prunes nodes/edges according to display options before layout
 * - `calculateDagreLayout`: runs the Dagre algorithm and converts internal node
 *   data to the `QuestGraphNode` array consumed by the canvas
 */

import dagre from 'dagre';
import type { SemanticModel } from '../../types/global';
import type { QuestGraphBuildOptions, QuestGraphEdge, QuestGraphNode } from '../../types/questGraph';
import {
  DAGRE_LAYOUT,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './questGraphConstants';
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

// ── Dagre layout ──────────────────────────────────────────────────────────────

export const calculateDagreLayout = (
  semanticModel: SemanticModel,
  nodeDataMap: Map<string, InternalNodeData>,
  edges: QuestGraphEdge[],
  misVarName: string
): QuestGraphNode[] => {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph(DAGRE_LAYOUT);
  g.setDefaultEdgeLabel(() => ({}));

  const npcNodes = new Map<string, string[]>();

  nodeDataMap.forEach((data, id) => {
    if (!npcNodes.has(data.npc)) {
      npcNodes.set(data.npc, []);
    }
    npcNodes.get(data.npc)!.push(id);
  });

  npcNodes.forEach((_, npc) => {
    const clusterId = `swimlane-${npc}`;
    g.setNode(clusterId, { label: npc, clusterLabelPos: 'top' });
  });

  nodeDataMap.forEach((data, id) => {
    const clusterId = `swimlane-${data.npc}`;
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    g.setParent(id, clusterId);
  });

  edges.forEach((edge) => {
    if (nodeDataMap.has(edge.source) && nodeDataMap.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  const nodes: QuestGraphNode[] = [];
  g.nodes().forEach((nodeId: string) => {
    const node = g.node(nodeId);
    if (nodeId.startsWith('swimlane-')) {
      nodes.push({
        id: nodeId,
        type: 'group',
        position: { x: node.x - node.width / 2, y: node.y - node.height / 2 },
        style: {
          width: node.width,
          height: node.height,
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px dashed #444',
          zIndex: -1,
          padding: 10,
          color: '#666'
        },
        data: {
          label: nodeId.replace('swimlane-', ''),
          npc: nodeId.replace('swimlane-', ''),
          kind: 'dialog'
        },
        selectable: false,
        draggable: false
      });
      return;
    }

    const data = nodeDataMap.get(nodeId);
    if (!data) return;

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
      position: { x: node.x - node.width / 2, y: node.y - node.height / 2 },
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
