import React from 'react';
import dagre from 'dagre';
import { Node, Edge, MarkerType } from 'reactflow';
import { Typography } from '@mui/material';
import type { SemanticModel, DialogAction, DialogCondition } from '../../types/global';

// Constants
const CHOICE_EDGE_COLOR = '#ff9800';

interface NodeData {
    id: string;
    type: 'start' | 'update' | 'success' | 'failed' | 'check';
    label: string;
    npc: string;
    description?: string;
    nodeKind?: 'function' | 'external-condition';
    expression?: string;
}

export interface QuestGraphData {
    nodes: Node[];
    edges: Edge[];
}

// Helper to check if a node should be visualized as a Quest State node
const isStateNode = (type: string, description?: string): boolean => {
    return type === 'start' || type === 'success' || type === 'failed' ||
        description?.includes('Status') || description === 'Set Running';
};

// Helper to extract NPC from dialog or function
export const getNpcForFunction = (funcName: string, semanticModel: SemanticModel): string | null => {
    // Check if it's a dialog info function or condition
    for (const dialog of Object.values(semanticModel.dialogs || {})) {
        // Check information
        const info = dialog.properties.information;
        if (typeof info === 'string' && info.toLowerCase() === funcName.toLowerCase()) {
            return (dialog.properties.npc as string) || 'Unknown';
        }
        if (info && typeof info === 'object' && info.name.toLowerCase() === funcName.toLowerCase()) {
            return (dialog.properties.npc as string) || 'Unknown';
        }

        // Check condition
        const cond = dialog.properties.condition;
        if (typeof cond === 'string' && cond.toLowerCase() === funcName.toLowerCase()) {
            return (dialog.properties.npc as string) || 'Unknown';
        }
        if (cond && typeof cond === 'object' && cond.name.toLowerCase() === funcName.toLowerCase()) {
            return (dialog.properties.npc as string) || 'Unknown';
        }
    }
    return null;
};

/**
 * 1. Identify relevant functions/dialogs and classify them
 */
const identifyQuestNodes = (
    semanticModel: SemanticModel,
    questName: string,
    misVarName: string
) => {
    const nodeDataMap = new Map<string, NodeData>();
    // Track producers of specific variable values
    // Map<VariableName, Map<Value, Set<FunctionID>>>
    const producersByVariableAndValue = new Map<string, Map<string, Set<string>>>();

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

    const getDisplayDataForFunction = (funcName: string) => {
        const npc = getNpcForFunction(funcName, semanticModel) || 'Global/Other';
        let displayName = funcName;

        for (const [dName, d] of Object.entries(semanticModel.dialogs || {})) {
            const info = d.properties.information;
            if ((typeof info === 'string' && info === funcName) ||
                (typeof info === 'object' && info.name === funcName)) {
                displayName = dName;
                break;
            }
        }

        return { npc, displayName };
    };

    Object.values(semanticModel.functions || {}).forEach(func => {
        let isRelevant = false;
        let type: NodeData['type'] = 'check';
        let description = '';

        // Check actions
        func.actions?.forEach((action: DialogAction) => {
            // Track generic variable assignments
            if (action.type === 'SetVariableAction') {
                const varName = action.variableName;
                const op = action.operator;
                const val = String(action.value);
                // We only support direct assignment for now as "Production"
                if (op === '=') {
                    addProducer(varName, val, func.name);
                }
            }

            if ('topic' in action && action.topic === questName) {
                isRelevant = true;

                if (action.type === 'CreateTopic') {
                    type = 'start';
                    description = 'Start Quest';
                    addProducer(misVarName, '1', func.name);
                } else if (action.type === 'LogSetTopicStatus') {
                    const status = String(action.status);
                    if (status.includes('SUCCESS') || status === '2') {
                        type = 'success';
                        description = 'Finish (Success)';
                        addProducer(misVarName, '2', func.name);
                    } else if (status.includes('FAILED') || status === '3') {
                        type = 'failed';
                        description = 'Finish (Failed)';
                        addProducer(misVarName, '3', func.name);
                    } else if (status.includes('RUNNING') || status === '1') {
                        type = 'update';
                        description = 'Set Running';
                        addProducer(misVarName, '1', func.name);
                    } else {
                        type = 'update';
                        description = `Set Status: ${status}`;
                        // Try to add as generic status producer if possible, though status is usually a constant
                        // Here we assume status might be a value we check later
                        addProducer(misVarName, status, func.name);
                    }
                } else if (action.type === 'LogEntry') {
                    if (type === 'check') type = 'update';
                    if (!description) description = 'Log Entry';
                }
            }
        });

        // Check conditions
        func.conditions?.forEach((cond: DialogCondition) => {
            if (cond.type === 'VariableCondition' && cond.variableName === misVarName) {
                isRelevant = true;
            }
            if (cond.type === 'NpcKnowsInfoCondition') {
                // If this function depends on a dialog that is already in our map, it's relevant
                // But we don't know the full set yet. 
                // We'll rely on the edge builder to find these connections.
            }
        });

        if (isRelevant) {
            const { npc, displayName } = getDisplayDataForFunction(func.name);

            nodeDataMap.set(func.name, {
                id: func.name,
                type,
                label: displayName,
                npc,
                description,
                nodeKind: 'function'
            });
        }
    });

    // Final check: Add nodes that are referenced via Npc_KnowsInfo from existing relevant nodes
    // to support Method A (Implicit flow)
    let addedAny = true;
    while (addedAny) {
        addedAny = false;
        Object.values(semanticModel.functions || {}).forEach(func => {
            if (nodeDataMap.has(func.name)) return;

            let isRelevantByKnows = false;
            func.conditions?.forEach((cond: DialogCondition) => {
                if (cond.type === 'NpcKnowsInfoCondition') {
                    // Does this condition check for a dialog we already identified as relevant?
                    for (const relevantNode of nodeDataMap.values()) {
                        if (relevantNode.label === cond.dialogRef) {
                            isRelevantByKnows = true;
                            break;
                        }
                    }
                }
            });

            if (isRelevantByKnows) {
                const { npc, displayName } = getDisplayDataForFunction(func.name);

                nodeDataMap.set(func.name, {
                    id: func.name,
                    type: 'check',
                    label: displayName,
                    npc,
                    description: '',
                    nodeKind: 'function'
                });
                addedAny = true;
            }
        });
    }

    // Expand graph via indirect variable dependencies:
    // if a relevant node checks a variable, include every function that can produce that value.
    addedAny = true;
    while (addedAny) {
        addedAny = false;

        nodeDataMap.forEach((_, consumerId) => {
            const consumerFunc = semanticModel.functions?.[consumerId];
            if (!consumerFunc) return;

            consumerFunc.conditions?.forEach((cond: DialogCondition) => {
                if (cond.type !== 'VariableCondition') return;
                if (cond.operator !== '==') return;

                const valueMap = producersByVariableAndValue.get(cond.variableName);
                if (!valueMap) return;

                let checkVal = String(cond.value);
                if (cond.variableName === misVarName) {
                    if (checkVal === 'LOG_RUNNING') checkVal = '1';
                    if (checkVal === 'LOG_SUCCESS') checkVal = '2';
                    if (checkVal === 'LOG_FAILED') checkVal = '3';
                }

                const producers = valueMap.get(checkVal);
                if (!producers) return;

                producers.forEach((producerId) => {
                    if (nodeDataMap.has(producerId)) return;
                    const producerFunc = semanticModel.functions?.[producerId];
                    if (!producerFunc) return;

                    const { npc, displayName } = getDisplayDataForFunction(producerId);
                    nodeDataMap.set(producerId, {
                        id: producerId,
                        type: 'check',
                        label: displayName,
                        npc,
                        description: 'Indirect prerequisite',
                        nodeKind: 'function'
                    });
                    addedAny = true;
                });
            });
        });
    }

    return { nodeDataMap, producersByVariableAndValue };
};

/**
 * 2. Build Dependencies
 */
const buildQuestEdges = (
    semanticModel: SemanticModel,
    nodeDataMap: Map<string, NodeData>,
    producersByVariableAndValue: Map<string, Map<string, Set<string>>>,
    misVarName: string
) => {
    const edges: Edge[] = [];
    const unresolvedConditionNodes = new Map<string, NodeData>();
    const adjacency = new Map<string, string[]>();

    const addAdjacency = (sourceId: string, targetId: string) => {
        if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
        adjacency.get(sourceId)!.push(targetId);
    };
    const incomingCount = new Map<string, number>();

    nodeDataMap.forEach((_, funcName) => {
        if (!adjacency.has(funcName)) adjacency.set(funcName, []);
        if (!incomingCount.has(funcName)) incomingCount.set(funcName, 0);
    });

    nodeDataMap.forEach((consumerData, consumerId) => {
        const func = semanticModel.functions[consumerId];
        if (!func) return;

        // C. Dialog Choices (Explicit Flow)
        func.actions?.forEach((action: DialogAction) => {
            if (action.type === 'Choice') {
                const targetFunc = action.targetFunction;
                if (nodeDataMap.has(targetFunc)) {
                    const targetData = nodeDataMap.get(targetFunc)!;

                    // Determine Source Handle based on Consumer Type
                    let sourceHandle = 'out-finished';
                    if (isStateNode(consumerData.type, consumerData.description)) {
                        sourceHandle = 'out-state';
                    }

                    // Determine Target Handle based on Target Type
                    let targetHandle = 'in-condition';
                    if (isStateNode(targetData.type, targetData.description)) {
                        targetHandle = 'in-trigger';
                    }

                    edges.push({
                        id: `choice-${consumerId}-${targetFunc}`,
                        source: consumerId,
                        target: targetFunc,
                        sourceHandle,
                        targetHandle,
                        label: action.text, // Choice text
                        type: 'smoothstep',
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { stroke: CHOICE_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '5,5' }, // Orange dashed line
                        labelStyle: { fill: CHOICE_EDGE_COLOR, fontSize: 10 }
                    });
                    addAdjacency(consumerId, targetFunc);
                    incomingCount.set(targetFunc, (incomingCount.get(targetFunc) || 0) + 1);
                }
            }
        });

        func.conditions?.forEach((cond: DialogCondition) => {
            // A. Npc_KnowsInfo
            if (cond.type === 'NpcKnowsInfoCondition') {
                const producerDialogName = cond.dialogRef;
                const producerDialog = semanticModel.dialogs[producerDialogName];
                if (producerDialog) {
                    let producerFunc = null;
                    const info = producerDialog.properties.information;
                    if (typeof info === 'string') producerFunc = info;
                    else if (info && typeof info === 'object') producerFunc = info.name;

                    if (producerFunc && nodeDataMap.has(producerFunc)) {
                        edges.push({
                            id: `knows-${producerFunc}-${consumerId}`,
                            source: producerFunc,
                            target: consumerId,
                            sourceHandle: 'out-finished',
                            targetHandle: 'in-condition',
                            label: 'Knows Info',
                            type: 'smoothstep',
                            markerEnd: { type: MarkerType.ArrowClosed },
                            style: { stroke: '#b1b1b7', strokeWidth: 2 },
                            labelStyle: { fill: '#b1b1b7', fontSize: 10 }
                        });
                        addAdjacency(producerFunc, consumerId);
                        incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
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
                                expression: `Npc_KnowsInfo(..., ${producerDialogName})`
                            });
                        }
                        edges.push({
                            id: `knows-external-${externalId}-${consumerId}`,
                            source: externalId,
                            target: consumerId,
                            sourceHandle: 'out-bool',
                            targetHandle: 'in-condition',
                            label: 'Unresolved knows-info',
                            type: 'smoothstep',
                            markerEnd: { type: MarkerType.ArrowClosed },
                            style: { stroke: '#b1b1b7', strokeWidth: 2, strokeDasharray: '3,3' },
                            labelStyle: { fill: '#b1b1b7', fontSize: 10 }
                        });
                        addAdjacency(externalId, consumerId);
                        incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
                    }
                }
            }

            // B. Variable Dependency (Generalized)
            if (cond.type === 'VariableCondition') {
                const varName = cond.variableName;
                const op = cond.operator;
                const val = String(cond.value);
                let checkVal = val;

                // Normalization for LOG_* constants if it matches misVarName
                if (varName === misVarName) {
                    if (val === 'LOG_RUNNING') checkVal = '1';
                    if (val === 'LOG_SUCCESS') checkVal = '2';
                    if (val === 'LOG_FAILED') checkVal = '3';
                }

                if (op === '==' && checkVal) {
                    const valueMap = producersByVariableAndValue.get(varName);
                    if (valueMap) {
                        const producers = valueMap.get(checkVal) || new Set();
                        producers.forEach(producerId => {
                            if (producerId !== consumerId && nodeDataMap.has(producerId)) {
                                edges.push({
                                    id: `var-${varName}-${producerId}-${consumerId}`,
                                    source: producerId,
                                    target: consumerId,
                                    sourceHandle: 'out-state',
                                    targetHandle: 'in-trigger',
                                    label: varName === misVarName ? val : varName, // Show variable name for generic deps
                                    type: 'smoothstep',
                                    animated: true,
                                    markerEnd: { type: MarkerType.ArrowClosed },
                                    style: { stroke: '#2196f3', strokeWidth: 2 },
                                    labelStyle: { fill: '#2196f3', fontSize: 10 }
                                });
                                addAdjacency(producerId, consumerId);
                                incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
                            }
                        });

                        if (producers.size === 0) {
                            const externalId = `external-cond-${consumerId}-${varName}-${checkVal}`;
                            if (!unresolvedConditionNodes.has(externalId)) {
                                unresolvedConditionNodes.set(externalId, {
                                    id: externalId,
                                    type: 'check',
                                    label: `${varName} ${op} ${val}`,
                                    npc: 'External/World',
                                    description: 'Unresolved condition source',
                                    nodeKind: 'external-condition',
                                    expression: `${varName} ${op} ${val}`
                                });
                            }
                            edges.push({
                                id: `external-var-${externalId}-${consumerId}`,
                                source: externalId,
                                target: consumerId,
                                sourceHandle: 'out-bool',
                                targetHandle: 'in-condition',
                                label: 'Unresolved source',
                                type: 'smoothstep',
                                markerEnd: { type: MarkerType.ArrowClosed },
                                style: { stroke: '#ffb74d', strokeWidth: 2, strokeDasharray: '3,3' },
                                labelStyle: { fill: '#ffb74d', fontSize: 10 }
                            });
                            addAdjacency(externalId, consumerId);
                            incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
                        }
                    }
                }
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
                        expression: `${cond.npc} has ${cond.item}`
                    });
                }

                edges.push({
                    id: `external-item-edge-${externalId}-${consumerId}`,
                    source: externalId,
                    target: consumerId,
                    sourceHandle: 'out-bool',
                    targetHandle: 'in-condition',
                    label: 'Has item',
                    type: 'smoothstep',
                    markerEnd: { type: MarkerType.ArrowClosed },
                    style: { stroke: '#ffb74d', strokeWidth: 2, strokeDasharray: '3,3' },
                    labelStyle: { fill: '#ffb74d', fontSize: 10 }
                });
                addAdjacency(externalId, consumerId);
                incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
            }
        });
    });

    unresolvedConditionNodes.forEach((nodeData, nodeId) => {
        if (!nodeDataMap.has(nodeId)) {
            nodeDataMap.set(nodeId, nodeData);
        }
        if (!adjacency.has(nodeId)) adjacency.set(nodeId, []);
        if (!incomingCount.has(nodeId)) incomingCount.set(nodeId, 0);
    });

    return { edges, adjacency, incomingCount };
};

/**
 * 3. Layout (Using Dagre)
 */
const calculateDagreLayout = (
    semanticModel: SemanticModel,
    nodeDataMap: Map<string, NodeData>,
    adjacency: Map<string, string[]>,
    misVarName: string
) => {
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setGraph({ rankdir: 'LR', align: 'UL', ranksep: 100, nodesep: 50 });
    g.setDefaultEdgeLabel(() => ({}));

    // Group by NPC for clusters
    const npcNodes = new Map<string, string[]>();

    nodeDataMap.forEach((data, id) => {
        if (!npcNodes.has(data.npc)) {
            npcNodes.set(data.npc, []);
        }
        npcNodes.get(data.npc)!.push(id);
    });

    // Add NPC clusters
    npcNodes.forEach((_, npc) => {
        const clusterId = `swimlane-${npc}`;
        g.setNode(clusterId, { label: npc, clusterLabelPos: 'top' });
    });

    // Add nodes
    nodeDataMap.forEach((data, id) => {
        const width = 250;
        const height = 100; // Approximate height for the node
        const clusterId = `swimlane-${data.npc}`;

        g.setNode(id, { width, height });
        g.setParent(id, clusterId);
    });

    // Add edges
    adjacency.forEach((targets, source) => {
        targets.forEach(target => {
            g.setEdge(source, target);
        });
    });

    dagre.layout(g);

    const nodes: Node[] = [];

    // Convert Dagre nodes to ReactFlow nodes
    g.nodes().forEach((v) => {
        const node = g.node(v);
        // node: { x, y, width, height, ... } (x, y are center)

        // Check if it's a cluster
        if (v.startsWith('swimlane-')) {
            nodes.push({
                id: v,
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
                data: { label: <Typography variant="subtitle2" sx={{ opacity: 0.5 }}>{v.replace('swimlane-', '')}</Typography> },
                selectable: false,
                draggable: false,
            });
        } else {
            const data = nodeDataMap.get(v);
            if (data) {
                // Determine node type
                let nodeType = 'dialog';
                if (data.nodeKind === 'external-condition') {
                    nodeType = 'condition';
                } else if (isStateNode(data.type, data.description)) {
                    nodeType = 'questState';
                }

                nodes.push({
                    id: v,
                    position: { x: node.x - node.width / 2, y: node.y - node.height / 2 },
                    type: nodeType,
                    data: {
                        label: data.label,
                        npc: data.npc,
                        description: data.description,
                        expression: data.expression,
                        type: data.type,
                        status: data.description, // rough mapping
                        variableName: semanticModel.variables?.[misVarName] ? misVarName : undefined
                    },
                });
            }
        }
    });

    return nodes;
};

export const buildQuestGraph = (semanticModel: SemanticModel, questName: string | null): QuestGraphData => {
    if (!questName || !semanticModel) {
        return { nodes: [], edges: [] };
    }

    const misVarName = questName.replace('TOPIC_', 'MIS_');

    // 1. Identify relevant functions/dialogs and classify them
    const { nodeDataMap, producersByVariableAndValue } = identifyQuestNodes(semanticModel, questName, misVarName);

    // 2. Build Dependencies
    const { edges, adjacency } = buildQuestEdges(semanticModel, nodeDataMap, producersByVariableAndValue, misVarName);

    // 3. Layout (Using Dagre)
    const nodes = calculateDagreLayout(semanticModel, nodeDataMap, adjacency, misVarName);

    return { nodes, edges };
};
