import React from 'react';
import { Node, Edge, MarkerType } from 'reactflow';
import { Typography } from '@mui/material';
import type { SemanticModel } from '../../types/global';
import { getActionType } from '../actionTypes';

// Constants
const CHOICE_EDGE_COLOR = '#ff9800';

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

export interface QuestGraphData {
  nodes: Node[];
  edges: Edge[];
}

export const buildQuestGraph = (semanticModel: SemanticModel, questName: string | null): QuestGraphData => {
    if (!questName || !semanticModel) {
        return { nodes: [], edges: [] };
    }

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const misVarName = questName.replace('TOPIC_', 'MIS_');

    // 1. Identify relevant functions/dialogs and classify them
    interface NodeData {
      id: string;
      type: 'start' | 'update' | 'success' | 'failed' | 'check';
      label: string;
      npc: string;
      description?: string;
    }

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

    Object.values(semanticModel.functions || {}).forEach(func => {
      let isRelevant = false;
      let type: NodeData['type'] = 'check';
      let description = '';

      // Check actions
      func.actions?.forEach(action => {
        const actionType = getActionType(action);

        // Track generic variable assignments
        if (actionType === 'setVariableAction') {
             const varName = (action as any).variableName;
             const op = (action as any).operator;
             const val = String((action as any).value);
             // We only support direct assignment for now as "Production"
             if (op === '=') {
                 addProducer(varName, val, func.name);
             }
        }

        if ('topic' in action && action.topic === questName) {
          isRelevant = true;

          if (actionType === 'createTopic') {
              type = 'start';
              description = 'Start Quest';
              addProducer(misVarName, '1', func.name);
          } else if (actionType === 'logSetTopicStatus') {
             const status = String((action as any).status);
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
          } else if (actionType === 'logEntry') {
             if (type === 'check') type = 'update';
             if (!description) description = 'Log Entry';
          }
        }
      });

      // Check conditions
      func.conditions?.forEach(cond => {
        if ('variableName' in cond && (cond as any).variableName === misVarName) {
          isRelevant = true;
        }
      });

      if (isRelevant) {
        const npc = getNpcForFunction(func.name, semanticModel) || 'Global/Other';
        let displayName = func.name;

        for (const [dName, d] of Object.entries(semanticModel.dialogs || {})) {
            const info = d.properties.information;
            if ((typeof info === 'string' && info === func.name) ||
                (typeof info === 'object' && info.name === func.name)) {
                displayName = dName;
                break;
            }
        }

        nodeDataMap.set(func.name, {
            id: func.name,
            type,
            label: displayName,
            npc,
            description
        });
      }
    });

    // 2. Build Dependencies
    const adjacency = new Map<string, string[]>();
    const incomingCount = new Map<string, number>();

    nodeDataMap.forEach((_, funcName) => {
        if (!adjacency.has(funcName)) adjacency.set(funcName, []);
        if (!incomingCount.has(funcName)) incomingCount.set(funcName, 0);
    });

    nodeDataMap.forEach((consumerData, consumerId) => {
        const func = semanticModel.functions[consumerId];
        if (!func) return;

        // C. Dialog Choices (Explicit Flow)
        func.actions?.forEach(action => {
            if (getActionType(action) === 'choice') {
                const targetFunc = (action as any).targetFunction;
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

                     newEdges.push({
                         id: `choice-${consumerId}-${targetFunc}`,
                         source: consumerId,
                         target: targetFunc,
                         sourceHandle,
                         targetHandle,
                         label: (action as any).text, // Choice text
                         type: 'smoothstep',
                         markerEnd: { type: MarkerType.ArrowClosed },
                         style: { stroke: CHOICE_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '5,5' }, // Orange dashed line
                         labelStyle: { fill: CHOICE_EDGE_COLOR, fontSize: 10 }
                     });
                     adjacency.get(consumerId)?.push(targetFunc);
                     incomingCount.set(targetFunc, (incomingCount.get(targetFunc) || 0) + 1);
                }
            }
        });

        func.conditions?.forEach(cond => {
            // A. Npc_KnowsInfo
            if ('dialogRef' in cond) {
                const producerDialogName = (cond as any).dialogRef;
                const producerDialog = semanticModel.dialogs[producerDialogName];
                if (producerDialog) {
                    let producerFunc = null;
                    const info = producerDialog.properties.information;
                    if (typeof info === 'string') producerFunc = info;
                    else if (info && typeof info === 'object') producerFunc = info.name;

                    if (producerFunc && nodeDataMap.has(producerFunc)) {
                         newEdges.push({
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
                         adjacency.get(producerFunc)?.push(consumerId);
                         incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
                    }
                }
            }

            // B. Variable Dependency (Generalized)
            if ('variableName' in cond) {
                const varName = (cond as any).variableName;
                const op = (cond as any).operator;
                const val = String((cond as any).value);
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
                                 newEdges.push({
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
                                 adjacency.get(producerId)?.push(consumerId);
                                 incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
                            }
                        });
                    }
                }
            }
        });
    });

    // 3. Layout (Simplified Swimlane)
    const npcs = Array.from(new Set(Array.from(nodeDataMap.values()).map(d => d.npc))).sort();
    const LEVEL_WIDTH = 350;

    const levels = new Map<string, number>();
    const queue: string[] = [];

    nodeDataMap.forEach((_, id) => {
        if ((incomingCount.get(id) || 0) === 0) {
            levels.set(id, 0);
            queue.push(id);
        }
    });

    // Cycle detection / limit
    const maxLevel = nodeDataMap.size;

    while (queue.length > 0) {
        const u = queue.shift()!;
        const currentLevel = levels.get(u)!;

        // Prevent infinite processing if level exceeds possible max path (indicating cycle or very long chain)
        if (currentLevel > maxLevel) continue;

        const neighbors = adjacency.get(u) || [];
        neighbors.forEach(v => {
            const existingLevel = levels.get(v);
            if (existingLevel === undefined || existingLevel < currentLevel + 1) {
                // Fix: Check if next level would exceed max possible level to prevent infinite loop
                if (currentLevel + 1 <= maxLevel) {
                    levels.set(v, currentLevel + 1);
                    queue.push(v);
                }
            }
        });
    }

    // PASS 1: Calculate counts per (npc, level)
    const laneOccupancy = new Map<string, Map<number, number>>();
    npcs.forEach(npc => laneOccupancy.set(npc, new Map()));

    nodeDataMap.forEach((data, id) => {
        const level = levels.get(id) || 0;
        const npcMap = laneOccupancy.get(data.npc)!;
        const count = npcMap.get(level) || 0;
        npcMap.set(level, count + 1);
    });

    // PASS 2: Calculate Lane Heights and Y Offsets
    const NPC_LANE_HEIGHT = new Map<string, number>();
    const NPC_Y_START = new Map<string, number>();
    let currentY = 0;
    const NODE_VERTICAL_SPACING = 250;
    const MIN_LANE_HEIGHT = 300;
    const LANE_PADDING = 50;

    npcs.forEach(npc => {
        NPC_Y_START.set(npc, currentY);

        const npcMap = laneOccupancy.get(npc)!;
        let maxNodesInCol = 0;
        if (npcMap.size > 0) {
             maxNodesInCol = Math.max(...Array.from(npcMap.values()));
        }

        const requiredHeight = Math.max(
            (maxNodesInCol * NODE_VERTICAL_SPACING) + LANE_PADDING,
            MIN_LANE_HEIGHT
        );
        NPC_LANE_HEIGHT.set(npc, requiredHeight);
        currentY += requiredHeight;
    });

    // PASS 3: Create Nodes
    const currentCounts = new Map<string, Map<number, number>>();
    npcs.forEach(npc => currentCounts.set(npc, new Map()));

    nodeDataMap.forEach((data, id) => {
        const level = levels.get(id) || 0;
        const npcMap = currentCounts.get(data.npc)!;
        const count = npcMap.get(level) || 0;
        npcMap.set(level, count + 1);

        const x = level * LEVEL_WIDTH + 50;
        const yBase = NPC_Y_START.get(data.npc)!;
        const yOffset = count * NODE_VERTICAL_SPACING;

        const y = yBase + 50 + yOffset;

        // Determine node type
        let nodeType = 'dialog';
        if (isStateNode(data.type, data.description)) {
             nodeType = 'questState';
        }

        newNodes.push({
            id,
            position: { x, y },
            type: nodeType,
            data: {
                label: data.label,
                npc: data.npc,
                description: data.description,
                type: data.type,
                status: data.description, // rough mapping
                variableName: misVarName
            },
        });
    });

    // Swimlanes
    npcs.forEach((npc) => {
        const maxLevelVal = Math.max(...Array.from(levels.values()), 0);
        const y = NPC_Y_START.get(npc)!;
        const height = NPC_LANE_HEIGHT.get(npc)!;

        newNodes.unshift({
            id: `swimlane-${npc}`,
            type: 'group',
            position: { x: 0, y },
            style: {
                width: (maxLevelVal + 1) * LEVEL_WIDTH + 200,
                height: height - 20,
                backgroundColor: 'rgba(255, 255, 255, 0.02)', // Very subtle light
                border: '1px dashed #444',
                zIndex: -1,
                padding: 10,
                color: '#666'
            },
            data: { label: <Typography variant="subtitle2" sx={{ opacity: 0.5 }}>{npc}</Typography> },
            selectable: false,
            draggable: false,
        });
    });

    return { nodes: newNodes, edges: newEdges };
};

export interface QuestAnalysis {
  status: 'implemented' | 'wip' | 'broken' | 'not_started';
  misVariableExists: boolean;
  misVariableName: string;
  hasStart: boolean;
  hasSuccess: boolean;
  hasFailed: boolean;
  description: string;
  filePaths: { topic: string | null; variable: string | null };
}

export const analyzeQuest = (semanticModel: SemanticModel, questName: string): QuestAnalysis => {
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const topicConstant = semanticModel.constants?.[questName];
    const misVariable = semanticModel.variables?.[misVarName];

    let hasStart = false;
    let hasSuccess = false;
    let hasFailed = false;

    // Scan functions for actions
    Object.values(semanticModel.functions || {}).forEach(func => {
        func.actions?.forEach(action => {
            if ('topic' in action && action.topic === questName) {
                const actionType = getActionType(action);
                if (actionType === 'createTopic') {
                    hasStart = true;
                } else if (actionType === 'logSetTopicStatus') {
                    const status = String((action as any).status);
                    if (status.includes('SUCCESS') || status === '2') {
                        hasSuccess = true;
                    } else if (status.includes('FAILED') || status === '3') {
                        hasFailed = true;
                    }
                }
            }
        });
    });

    let status: QuestAnalysis['status'] = 'not_started';
    if (!misVariable) {
        status = 'broken';
    } else if (hasSuccess || hasFailed) {
        status = 'implemented';
    } else if (hasStart) {
        status = 'wip';
    }

    return {
        status,
        misVariableExists: !!misVariable,
        misVariableName: misVarName,
        hasStart,
        hasSuccess,
        hasFailed,
        description: topicConstant ? String(topicConstant.value).replace(/^"|"$/g, '') : '',
        filePaths: {
            topic: topicConstant?.filePath || null,
            variable: misVariable?.filePath || null
        }
    };
};
