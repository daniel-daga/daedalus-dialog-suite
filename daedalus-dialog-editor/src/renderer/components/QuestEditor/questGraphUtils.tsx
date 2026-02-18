import dagre from 'dagre';
import { MarkerType } from 'reactflow';
import type { DialogAction, DialogCondition, SemanticModel } from '../../types/global';
import type {
  QuestGraphBuildOptions,
  QuestGraphData,
  QuestGraphEdge,
  QuestGraphNode,
  QuestGraphNodeKind,
  QuestGraphProvenance
} from '../../types/questGraph';

const CHOICE_EDGE_COLOR = '#ff9800';

interface InternalNodeData {
  id: string;
  type: 'start' | 'update' | 'success' | 'failed' | 'check';
  label: string;
  npc: string;
  description?: string;
  nodeKind: 'function' | 'external-condition';
  expression?: string;
  kind: QuestGraphNodeKind;
  inferred: boolean;
  touchesSelectedQuest: boolean;
  provenance?: QuestGraphProvenance;
}

type ProducerMap = Map<string, Map<string, Set<string>>>;

interface IdentifyResult {
  nodeDataMap: Map<string, InternalNodeData>;
  producersByVariableAndValue: ProducerMap;
}

interface EdgeBuildResult {
  edges: QuestGraphEdge[];
  adjacency: Map<string, string[]>;
}

const isStateNode = (type: string, description?: string): boolean => {
  const desc = description || '';
  return (
    type === 'start' ||
    type === 'success' ||
    type === 'failed' ||
    desc.includes('Status') ||
    desc === 'Set Running' ||
    desc.startsWith('Set LOG_')
  );
};

const normalizeQuestStateValue = (value: string): string => {
  if (value === 'LOG_RUNNING') return '1';
  if (value === 'LOG_SUCCESS') return '2';
  if (value === 'LOG_FAILED') return '3';
  return value;
};

const getDialogContextForFunction = (
  funcName: string,
  semanticModel: SemanticModel
): { npc: string; dialogName?: string } => {
  for (const [dialogName, dialog] of Object.entries(semanticModel.dialogs || {})) {
    const info = dialog.properties.information;
    if (
      (typeof info === 'string' && info.toLowerCase() === funcName.toLowerCase()) ||
      (typeof info === 'object' && info?.name.toLowerCase() === funcName.toLowerCase())
    ) {
      return {
        npc: (dialog.properties.npc as string) || 'Unknown',
        dialogName
      };
    }
  }

  return { npc: 'Global/Other' };
};

export const getNpcForFunction = (funcName: string, semanticModel: SemanticModel): string | null => {
  return getDialogContextForFunction(funcName, semanticModel).npc || null;
};

const identifyQuestNodes = (
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
    let isRelevant = false;
    let type: InternalNodeData['type'] = 'check';
    let description = '';
    let kind: QuestGraphNodeKind = 'dialog';
    let touchesSelectedQuest = false;

    func.actions?.forEach((action: DialogAction) => {
      if (action.type === 'SetVariableAction' && action.operator === '=') {
        const value = String(action.value);
        addProducer(action.variableName, value, func.name);
      }

      if ('topic' in action && action.topic === questName) {
        isRelevant = true;
        touchesSelectedQuest = true;

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
        kind = 'misState';
        if (action.operator === '=') {
          description = `Set ${misVarName} = ${String(action.value)}`;
        }
      }
    });

    func.conditions?.forEach((cond: DialogCondition) => {
      if (cond.type === 'VariableCondition' && cond.variableName === misVarName) {
        isRelevant = true;
        touchesSelectedQuest = true;
      }
    });

    if (isRelevant) {
      const context = getDialogContextForFunction(func.name, semanticModel);
      nodeDataMap.set(func.name, {
        id: func.name,
        type,
        label: context.dialogName || func.name,
        npc: context.npc,
        description,
        nodeKind: 'function',
        kind,
        inferred: false,
        touchesSelectedQuest,
        provenance: {
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
        if (cond.type !== 'NpcKnowsInfoCondition') return;
        for (const relevantNode of nodeDataMap.values()) {
          if (relevantNode.label === cond.dialogRef) {
            isRelevantByKnows = true;
            break;
          }
        }
      });

      if (isRelevantByKnows) {
        const context = getDialogContextForFunction(func.name, semanticModel);
        nodeDataMap.set(func.name, {
          id: func.name,
          type: 'check',
          label: context.dialogName || func.name,
          npc: context.npc,
          description: 'Indirect prerequisite',
          nodeKind: 'function',
          kind: 'dialog',
          inferred: true,
          touchesSelectedQuest: false,
          provenance: {
            functionName: func.name,
            dialogName: context.dialogName
          }
        });
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
        if (cond.type !== 'VariableCondition' || cond.operator !== '==') return;
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
          nodeDataMap.set(producerId, {
            id: producerId,
            type: 'check',
            label: context.dialogName || producerId,
            npc: context.npc,
            description: 'Indirect prerequisite',
            nodeKind: 'function',
            kind: 'dialog',
            inferred: true,
            touchesSelectedQuest: false,
            provenance: {
              functionName: producerId,
              dialogName: context.dialogName
            }
          });
          addedAny = true;
        });
      });
    });
  }

  return { nodeDataMap, producersByVariableAndValue };
};

const buildQuestEdges = (
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

    func.actions?.forEach((action: DialogAction) => {
      if (action.type !== 'Choice') return;
      const targetFunc = action.targetFunction;
      if (!nodeDataMap.has(targetFunc)) return;
      const targetData = nodeDataMap.get(targetFunc)!;

      const sourceHandle = isStateNode(consumerData.type, consumerData.description)
        ? 'out-state'
        : 'out-finished';
      const targetHandle = isStateNode(targetData.type, targetData.description)
        ? 'in-trigger'
        : 'in-condition';

      edges.push({
        id: `choice-${consumerId}-${targetFunc}`,
        source: consumerId,
        target: targetFunc,
        sourceHandle,
        targetHandle,
        label: action.text,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: CHOICE_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '5,5' },
        labelStyle: { fill: CHOICE_EDGE_COLOR, fontSize: 10 },
        data: {
          kind: 'transitions',
          inferred: false,
          provenance: {
            functionName: consumerId,
            dialogName: consumerData.provenance?.dialogName
          }
        }
      });
      addAdjacency(consumerId, targetFunc);
    });

    func.conditions?.forEach((cond: DialogCondition) => {
      if (cond.type === 'NpcKnowsInfoCondition') {
        const producerDialogName = cond.dialogRef;
        const producerDialog = semanticModel.dialogs[producerDialogName];
        if (producerDialog) {
          let producerFunc: string | null = null;
          const info = producerDialog.properties.information;
          if (typeof info === 'string') producerFunc = info;
          else if (typeof info === 'object' && info?.name) producerFunc = info.name;

          if (producerFunc && nodeDataMap.has(producerFunc)) {
            edges.push({
              id: `knows-${producerFunc}-${consumerId}`,
              source: producerFunc,
              target: consumerId,
              sourceHandle: 'out-finished',
              targetHandle: 'in-condition',
              label: `requires knows ${producerDialogName}`,
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: '#b1b1b7', strokeWidth: 2 },
              labelStyle: { fill: '#b1b1b7', fontSize: 10 },
              data: {
                kind: 'requires',
                inferred: nodeDataMap.get(producerFunc)?.inferred || false,
                expression: `Npc_KnowsInfo(..., ${producerDialogName})`,
                provenance: {
                  functionName: consumerId,
                  dialogName: consumerData.provenance?.dialogName
                }
              }
            });
            addAdjacency(producerFunc, consumerId);
          } else {
            const externalId = `external-knows-${consumerId}-${producerDialogName}`;
            if (!unresolvedConditionNodes.has(externalId)) {
              unresolvedConditionNodes.set(externalId, {
                id: externalId,
                type: 'check',
                label: `Knows ${producerDialogName}`,
                npc: 'External/World',
                description: 'Implicit prerequisite',
                nodeKind: 'external-condition',
                expression: `Npc_KnowsInfo(..., ${producerDialogName})`,
                kind: 'condition',
                inferred: true,
                touchesSelectedQuest: false
              });
            }

            edges.push({
              id: `knows-external-${externalId}-${consumerId}`,
              source: externalId,
              target: consumerId,
              sourceHandle: 'out-bool',
              targetHandle: 'in-condition',
              label: `requires knows ${producerDialogName}`,
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: '#b1b1b7', strokeWidth: 2, strokeDasharray: '3,3' },
              labelStyle: { fill: '#b1b1b7', fontSize: 10 },
              data: {
                kind: 'requires',
                inferred: true,
                expression: `Npc_KnowsInfo(..., ${producerDialogName})`,
                provenance: {
                  functionName: consumerId,
                  dialogName: consumerData.provenance?.dialogName
                }
              }
            });
            addAdjacency(externalId, consumerId);
          }
        }
      }

      if (cond.type === 'VariableCondition') {
        const variableName = cond.variableName;
        const operator = cond.operator;
        const rawValue = String(cond.value);
        const expression = `${variableName} ${operator} ${rawValue}`;

        if (operator === '==') {
          const normalizedValue =
            variableName === misVarName ? normalizeQuestStateValue(rawValue) : rawValue;

          const valueMap = producersByVariableAndValue.get(variableName);
          if (valueMap) {
            const producers = valueMap.get(normalizedValue) || new Set<string>();
            producers.forEach((producerId) => {
              if (producerId === consumerId || !nodeDataMap.has(producerId)) return;
              const producerNode = nodeDataMap.get(producerId)!;

              edges.push({
                id: `var-${variableName}-${producerId}-${consumerId}`,
                source: producerId,
                target: consumerId,
                sourceHandle: 'out-state',
                targetHandle: 'in-trigger',
                label: `requires ${expression}`,
                type: 'smoothstep',
                animated: true,
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: '#2196f3', strokeWidth: 2 },
                labelStyle: { fill: '#2196f3', fontSize: 10 },
                data: {
                  kind: 'requires',
                  inferred: producerNode.inferred,
                  expression,
                  operator,
                  provenance: {
                    functionName: consumerId,
                    dialogName: consumerData.provenance?.dialogName
                  }
                }
              });
              addAdjacency(producerId, consumerId);
            });

            if (producers.size === 0) {
              const externalId = `external-cond-${consumerId}-${variableName}-${operator}-${normalizedValue}`;
              if (!unresolvedConditionNodes.has(externalId)) {
                unresolvedConditionNodes.set(externalId, {
                  id: externalId,
                  type: 'check',
                  label: expression,
                  npc: 'External/World',
                  description: 'Unresolved condition source',
                  nodeKind: 'external-condition',
                  expression,
                  kind: 'condition',
                  inferred: true,
                  touchesSelectedQuest: false
                });
              }

              edges.push({
                id: `external-var-${externalId}-${consumerId}`,
                source: externalId,
                target: consumerId,
                sourceHandle: 'out-bool',
                targetHandle: 'in-condition',
                label: `requires ${expression}`,
                type: 'smoothstep',
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: '#ffb74d', strokeWidth: 2, strokeDasharray: '3,3' },
                labelStyle: { fill: '#ffb74d', fontSize: 10 },
                data: {
                  kind: 'requires',
                  inferred: true,
                  expression,
                  operator,
                  provenance: {
                    functionName: consumerId,
                    dialogName: consumerData.provenance?.dialogName
                  }
                }
              });
              addAdjacency(externalId, consumerId);
            }
          }
          return;
        }

        if (operator === '!=') {
          const externalId = `external-cond-${consumerId}-${variableName}-${operator}-${rawValue}`;
          if (!unresolvedConditionNodes.has(externalId)) {
            unresolvedConditionNodes.set(externalId, {
              id: externalId,
              type: 'check',
              label: expression,
              npc: 'External/World',
              description: 'Unresolved inequality condition source',
              nodeKind: 'external-condition',
              expression,
              kind: 'condition',
              inferred: true,
              touchesSelectedQuest: false
            });
          }

          edges.push({
            id: `external-var-${externalId}-${consumerId}`,
            source: externalId,
            target: consumerId,
            sourceHandle: 'out-bool',
            targetHandle: 'in-condition',
            label: `requires ${expression}`,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#4db6ac', strokeWidth: 2, strokeDasharray: '3,3' },
            labelStyle: { fill: '#4db6ac', fontSize: 10 },
            data: {
              kind: 'requires',
              inferred: true,
              expression,
              operator,
              provenance: {
                functionName: consumerId,
                dialogName: consumerData.provenance?.dialogName
              }
            }
          });
          addAdjacency(externalId, consumerId);
          return;
        }

        const externalId = `external-cond-${consumerId}-${variableName}-${operator}-${rawValue}`;
        if (!unresolvedConditionNodes.has(externalId)) {
          unresolvedConditionNodes.set(externalId, {
            id: externalId,
            type: 'check',
            label: expression,
            npc: 'External/World',
            description: `Read-only condition (${operator})`,
            nodeKind: 'external-condition',
            expression,
            kind: 'condition',
            inferred: true,
            touchesSelectedQuest: false
          });
        }

        edges.push({
          id: `external-var-${externalId}-${consumerId}`,
          source: externalId,
          target: consumerId,
          sourceHandle: 'out-bool',
          targetHandle: 'in-condition',
          label: `requires ${expression}`,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#9575cd', strokeWidth: 2, strokeDasharray: '3,3' },
          labelStyle: { fill: '#9575cd', fontSize: 10 },
          data: {
            kind: 'requires',
            inferred: true,
            expression,
            operator,
            provenance: {
              functionName: consumerId,
              dialogName: consumerData.provenance?.dialogName
            }
          }
        });
        addAdjacency(externalId, consumerId);
      }

      if (cond.type === 'NpcHasItemsCondition') {
        const externalId = `external-item-${consumerId}-${cond.npc}-${cond.item}`;
        if (!unresolvedConditionNodes.has(externalId)) {
          unresolvedConditionNodes.set(externalId, {
            id: externalId,
            type: 'check',
            label: `${cond.item}`,
            npc: 'External/World',
            description: 'Item possession prerequisite',
            nodeKind: 'external-condition',
            expression: `${cond.npc} has ${cond.item}`,
            kind: 'condition',
            inferred: true,
            touchesSelectedQuest: false
          });
        }

        edges.push({
          id: `external-item-edge-${externalId}-${consumerId}`,
          source: externalId,
          target: consumerId,
          sourceHandle: 'out-bool',
          targetHandle: 'in-condition',
          label: `requires ${cond.item}`,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#ffb74d', strokeWidth: 2, strokeDasharray: '3,3' },
          labelStyle: { fill: '#ffb74d', fontSize: 10 },
          data: {
            kind: 'requires',
            inferred: true,
            expression: `${cond.npc} has ${cond.item}`,
            provenance: {
              functionName: consumerId,
              dialogName: consumerData.provenance?.dialogName
            }
          }
        });
        addAdjacency(externalId, consumerId);
      }
    });
  });

  unresolvedConditionNodes.forEach((nodeData, nodeId) => {
    if (!nodeDataMap.has(nodeId)) {
      nodeDataMap.set(nodeId, nodeData);
    }
    if (!adjacency.has(nodeId)) adjacency.set(nodeId, []);
  });

  return { edges, adjacency };
};

const filterGraph = (
  nodes: Map<string, InternalNodeData>,
  edges: QuestGraphEdge[],
  options?: QuestGraphBuildOptions
): { nodeDataMap: Map<string, InternalNodeData>; edges: QuestGraphEdge[] } => {
  const {
    onlySelectedQuest = false,
    hideInferredEdges = false,
    showConditions = true
  } = options || {};

  const selectedNodeDataMap = new Map(nodes);
  let selectedEdges = [...edges];

  if (hideInferredEdges) {
    selectedEdges = selectedEdges.filter((edge) => !edge.data?.inferred);
  }

  if (!showConditions) {
    for (const [id, data] of selectedNodeDataMap.entries()) {
      if (data.kind === 'condition') {
        selectedNodeDataMap.delete(id);
      }
    }
    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  if (onlySelectedQuest) {
    for (const [id, data] of selectedNodeDataMap.entries()) {
      if (!data.touchesSelectedQuest && data.kind !== 'condition') {
        selectedNodeDataMap.delete(id);
      }
    }
    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  return { nodeDataMap: selectedNodeDataMap, edges: selectedEdges };
};

const calculateDagreLayout = (
  semanticModel: SemanticModel,
  nodeDataMap: Map<string, InternalNodeData>,
  edges: QuestGraphEdge[],
  misVarName: string
): QuestGraphNode[] => {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: 'LR', align: 'UL', ranksep: 100, nodesep: 50 });
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
    const width = 250;
    const height = 100;
    const clusterId = `swimlane-${data.npc}`;
    g.setNode(id, { width, height });
    g.setParent(id, clusterId);
  });

  edges.forEach((edge) => {
    if (nodeDataMap.has(edge.source) && nodeDataMap.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  const nodes: QuestGraphNode[] = [];
  g.nodes().forEach((nodeId) => {
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

    let nodeType: 'dialog' | 'questState' | 'condition' = 'dialog';
    if (data.kind === 'condition') {
      nodeType = 'condition';
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
        type: data.type,
        status: data.description,
        variableName: semanticModel.variables?.[misVarName] ? misVarName : undefined,
        kind: data.kind,
        inferred: data.inferred,
        touchesSelectedQuest: data.touchesSelectedQuest,
        provenance: data.provenance
      }
    });
  });

  return nodes;
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
