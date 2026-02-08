import React, { useMemo, useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography } from '@mui/material';
import type { SemanticModel } from '../types/global';
import { getActionType } from './actionTypes';
import { useNavigation } from '../hooks/useNavigation';

import DialogNode from './QuestEditor/Nodes/DialogNode';
import QuestStateNode from './QuestEditor/Nodes/QuestStateNode';
import ConditionNode from './QuestEditor/Nodes/ConditionNode';

interface QuestFlowProps {
  semanticModel: SemanticModel;
  questName: string | null;
}

// Define node types outside component to prevent re-creation
const nodeTypes: NodeTypes = {
  dialog: DialogNode,
  questState: QuestStateNode,
  condition: ConditionNode,
};

// Helper to extract NPC from dialog or function
const getNpcForFunction = (funcName: string, semanticModel: SemanticModel): string | null => {
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

const QuestFlow: React.FC<QuestFlowProps> = ({ semanticModel, questName }) => {
  const { navigateToDialog, navigateToSymbol } = useNavigation();

  // State for interactive graph
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Helper to find dialog name for a function
  const findDialogForFunction = useCallback((funcName: string) => {
    for (const [dName, d] of Object.entries(semanticModel.dialogs || {})) {
        const info = d.properties.information;
        if ((typeof info === 'string' && info.toLowerCase() === funcName.toLowerCase()) ||
            (typeof info === 'object' && info.name.toLowerCase() === funcName.toLowerCase())) {
            return dName;
        }
    }
    return null;
  }, [semanticModel.dialogs]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.type === 'group') return;
    
    const dialogName = findDialogForFunction(node.id);
    if (dialogName) {
      navigateToDialog(dialogName);
    } else {
      navigateToSymbol(node.id);
    }
  }, [findDialogForFunction, navigateToDialog, navigateToSymbol]);

  const onConnect = useCallback((params: Connection) => {
    // In the future: This should also update the semantic model (e.g., adding Npc_KnowsInfo)
    console.log('Connect:', params);
    setEdges((eds) => addEdge({ ...params, type: 'smoothstep', style: { stroke: '#fff', strokeWidth: 2 } }, eds));
  }, [setEdges]);

  // Initialize Graph from Semantic Model
  useEffect(() => {
    if (!questName || !semanticModel) {
        setNodes([]);
        setEdges([]);
        return;
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
    const producersByValue = new Map<string, Set<string>>();

    Object.values(semanticModel.functions || {}).forEach(func => {
      let isRelevant = false;
      let type: NodeData['type'] = 'check';
      let description = '';

      // Check actions
      func.actions?.forEach(action => {
        if ('topic' in action && action.topic === questName) {
          isRelevant = true;
          const actionType = getActionType(action);

          if (actionType === 'createTopic') {
              type = 'start';
              description = 'Start Quest';
              if (!producersByValue.has('1')) producersByValue.set('1', new Set());
              producersByValue.get('1')?.add(func.name);
          } else if (actionType === 'logSetTopicStatus') {
             const status = String((action as any).status);
             if (status.includes('SUCCESS') || status === '2') {
                type = 'success';
                description = 'Finish (Success)';
                if (!producersByValue.has('2')) producersByValue.set('2', new Set());
                producersByValue.get('2')?.add(func.name);
             } else if (status.includes('FAILED') || status === '3') {
                type = 'failed';
                description = 'Finish (Failed)';
                if (!producersByValue.has('3')) producersByValue.set('3', new Set());
                producersByValue.get('3')?.add(func.name);
             } else if (status.includes('RUNNING') || status === '1') {
                type = 'update';
                description = 'Set Running';
                if (!producersByValue.has('1')) producersByValue.set('1', new Set());
                producersByValue.get('1')?.add(func.name);
             } else {
                type = 'update';
                description = `Set Status: ${status}`;
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

            // B. Variable Dependency
            if ('variableName' in cond && (cond as any).variableName === misVarName) {
                const op = (cond as any).operator;
                const val = String((cond as any).value);
                let checkVal = val;
                if (val === 'LOG_RUNNING') checkVal = '1';
                if (val === 'LOG_SUCCESS') checkVal = '2';
                if (val === 'LOG_FAILED') checkVal = '3';

                if (op === '==' && checkVal) {
                    const producers = producersByValue.get(checkVal) || new Set();
                    producers.forEach(producerId => {
                        if (producerId !== consumerId && nodeDataMap.has(producerId)) {
                             newEdges.push({
                                 id: `state-${producerId}-${consumerId}`,
                                 source: producerId,
                                 target: consumerId,
                                 sourceHandle: 'out-state',
                                 targetHandle: 'in-trigger', // Logic: Producer Sets State -> Consumer Checks State
                                 label: val,
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
        });
    });

    // 3. Layout (Simplified Swimlane)
    const npcs = Array.from(new Set(Array.from(nodeDataMap.values()).map(d => d.npc))).sort();
    const LANE_HEIGHT = 300;
    const LEVEL_WIDTH = 350;

    const levels = new Map<string, number>();
    const queue: string[] = [];

    nodeDataMap.forEach((_, id) => {
        if ((incomingCount.get(id) || 0) === 0) {
            levels.set(id, 0);
            queue.push(id);
        }
    });

    while (queue.length > 0) {
        const u = queue.shift()!;
        const currentLevel = levels.get(u)!;
        const neighbors = adjacency.get(u) || [];
        neighbors.forEach(v => {
            const existingLevel = levels.get(v);
            if (existingLevel === undefined || existingLevel < currentLevel + 1) {
                levels.set(v, currentLevel + 1);
                queue.push(v);
            }
        });
    }

    const laneOccupancy = new Map<string, Map<number, number>>();
    npcs.forEach(npc => laneOccupancy.set(npc, new Map()));

    nodeDataMap.forEach((data, id) => {
        const level = levels.get(id) || 0;
        const npcMap = laneOccupancy.get(data.npc)!;
        const count = npcMap.get(level) || 0;
        npcMap.set(level, count + 1);

        const x = level * LEVEL_WIDTH + 50;
        const npcIndex = npcs.indexOf(data.npc);
        const yBase = npcIndex * LANE_HEIGHT;
        const yOffset = count * 100;

        const y = yBase + 50 + yOffset;

        // Determine node type
        let nodeType = 'dialog';
        if (data.type === 'start' || data.type === 'success' || data.type === 'failed' || data.description?.includes('Status')) {
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
    npcs.forEach((npc, index) => {
        const maxLevel = Math.max(...Array.from(levels.values()), 0);
        newNodes.unshift({
            id: `swimlane-${npc}`,
            type: 'group',
            position: { x: 0, y: index * LANE_HEIGHT },
            style: {
                width: (maxLevel + 1) * LEVEL_WIDTH + 200,
                height: LANE_HEIGHT - 20,
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

    setNodes(newNodes);
    setEdges(newEdges);

  }, [semanticModel, questName, setNodes, setEdges]); // Runs when model/quest changes

  if (!questName) {
      return (
          <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Typography color="text.secondary">Select a quest to view flow</Typography>
          </Box>
      );
  }

  return (
    <Box sx={{ height: '100%', width: '100%', bgcolor: '#1e1e1e' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#333" gap={20} />
        <Controls />
      </ReactFlow>
    </Box>
  );
};

export default QuestFlow;
