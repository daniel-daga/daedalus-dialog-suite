/**
 * Quest-graph build pipeline — public entry point.
 *
 * Orchestrates the four pipeline stages:
 *   1. NodeIdentifier  (`questNodeIdentification`) — walk the semantic model and
 *      collect every function relevant to the selected quest
 *   2. EdgeBuilder     (`questEdgeBuilding`)       — emit edges between those nodes
 *   3. LayoutFilter    (`questLayout.filterGraph`) — prune nodes/edges per options
 *   4. LayoutCalculator(`questLayout.calculateDagreLayout`) — run Dagre and produce
 *      React Flow node positions
 *
 * Only `buildQuestGraph` and `getNpcForFunction` are public exports; all internal
 * types and helpers live in the sibling modules.
 */

import type { SemanticModel } from '../../types/global';
import type { QuestGraphBuildOptions, QuestGraphData } from '../../types/questGraph';
import { buildQuestEdges } from './questEdgeBuilding';
import { calculateDagreLayout, filterGraph } from './questLayout';
import { identifyQuestNodes } from './questNodeIdentification';
import { getDialogContextForFunction } from './questGraphSharedHelpers';

export const getNpcForFunction = (funcName: string, semanticModel: SemanticModel): string | null => {
  return getDialogContextForFunction(funcName, semanticModel).npc || null;
};

export const buildQuestGraph = (
  semanticModel: SemanticModel,
  questName: string | null,
  options?: QuestGraphBuildOptions
): QuestGraphData => {
  if (!questName || !semanticModel) {
    return { nodes: [], edges: [] };
  }

  const misVarName = questName.replace('TOPIC_', 'MIS_');
  const { nodeDataMap, producersByVariableAndValue } = identifyQuestNodes(
    semanticModel,
    questName,
    misVarName
  );
  const { edges } = buildQuestEdges(semanticModel, nodeDataMap, producersByVariableAndValue, misVarName);
  const filtered = filterGraph(nodeDataMap, edges, options);
  const nodes = calculateDagreLayout(semanticModel, filtered.nodeDataMap, filtered.edges, misVarName);

  return {
    nodes,
    edges: filtered.edges.filter(
      (edge) => filtered.nodeDataMap.has(edge.source) && filtered.nodeDataMap.has(edge.target)
    )
  };
};
