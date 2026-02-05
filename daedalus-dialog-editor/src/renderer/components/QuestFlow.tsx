import React, { useMemo, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography, Chip, Paper } from '@mui/material';
import type { SemanticModel } from '../types/global';
import { getActionType } from './actionTypes';
import { useNavigation } from '../hooks/useNavigation';

interface QuestFlowProps {
  semanticModel: SemanticModel;
  questName: string | null;
}

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

// Custom Node Component could be defined here if we want richer UI,
// but using standard nodes with custom styles is easier for now.

const QuestFlow: React.FC<QuestFlowProps> = ({ semanticModel, questName }) => {
  const { navigateToDialog, navigateToSymbol } = useNavigation();

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

  const { nodes, edges } = useMemo(() => {
    if (!questName || !semanticModel) return { nodes: [], edges: [] };

    const nodes: Node[] = [];
    const edges: Edge[] = [];
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
              // Implicitly sets LOG_RUNNING (1)
              if (!producersByValue.has('1')) producersByValue.set('1', new Set());
              producersByValue.get('1')?.add(func.name);
          } else if (actionType === 'logSetTopicStatus') {
             const status = String((action as any).status);
             if (status.includes('SUCCESS') || status === '2') { // LOG_SUCCESS = 2
                type = 'success';
                description = 'Finish (Success)';
                if (!producersByValue.has('2')) producersByValue.set('2', new Set());
                producersByValue.get('2')?.add(func.name);
             } else if (status.includes('FAILED') || status === '3') { // LOG_FAILED = 3
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
             if (type === 'check') type = 'update'; // Only upgrade if not already start/end
             if (!description) description = 'Log Entry';
          }
        }
      });

      // Check conditions (read-only access to quest state)
      func.conditions?.forEach(cond => {
        if ('variableName' in cond && (cond as any).variableName === misVarName) {
          isRelevant = true;
        }
      });

      if (isRelevant) {
        const npc = getNpcForFunction(func.name, semanticModel) || 'Global/Other';
        // Try to find readable name (Dialog name instead of function name)
        let displayName = func.name;
        // Search dialogs for this function
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

    // 2. Build Dependencies (Edges)
    const adjacency = new Map<string, string[]>(); // Producer -> Consumers
    const incomingCount = new Map<string, number>();

    nodeDataMap.forEach((data, funcName) => {
        if (!adjacency.has(funcName)) adjacency.set(funcName, []);
        if (!incomingCount.has(funcName)) incomingCount.set(funcName, 0);
    });

    nodeDataMap.forEach((consumerData, consumerId) => {
        const func = semanticModel.functions[consumerId];
        if (!func) return;

        func.conditions?.forEach(cond => {
            // A. Npc_KnowsInfo Dependency
            if ('dialogRef' in cond) {
                const producerDialogName = (cond as any).dialogRef;
                // Resolve Dialog Name to Function Name
                const producerDialog = semanticModel.dialogs[producerDialogName];
                if (producerDialog) {
                    let producerFunc = null;
                    const info = producerDialog.properties.information;
                    if (typeof info === 'string') producerFunc = info;
                    else if (info && typeof info === 'object') producerFunc = info.name;

                    if (producerFunc && nodeDataMap.has(producerFunc)) {
                         // Add Edge
                         edges.push({
                             id: `knows-${producerFunc}-${consumerId}`,
                             source: producerFunc,
                             target: consumerId,
                             label: 'Knows Info',
                             type: 'smoothstep',
                             markerEnd: { type: MarkerType.ArrowClosed },
                             style: { stroke: '#b1b1b7' },
                             labelStyle: { fill: '#b1b1b7', fontSize: 10 }
                         });

                         // Update Graph Logic
                         adjacency.get(producerFunc)?.push(consumerId);
                         incomingCount.set(consumerId, (incomingCount.get(consumerId) || 0) + 1);
                    }
                }
            }

            // B. Variable Dependency (MIS_Val == X)
            if ('variableName' in cond && (cond as any).variableName === misVarName) {
                const op = (cond as any).operator;
                const val = String((cond as any).value);

                // Map common constants to values
                let checkVal = val;
                if (val === 'LOG_RUNNING') checkVal = '1';
                if (val === 'LOG_SUCCESS') checkVal = '2';
                if (val === 'LOG_FAILED') checkVal = '3';

                if (op === '==' && checkVal) {
                    const producers = producersByValue.get(checkVal) || new Set();
                    producers.forEach(producerId => {
                        if (producerId !== consumerId && nodeDataMap.has(producerId)) {
                             edges.push({
                                 id: `state-${producerId}-${consumerId}`,
                                 source: producerId,
                                 target: consumerId,
                                 label: val,
                                 type: 'smoothstep',
                                 animated: true,
                                 markerEnd: { type: MarkerType.ArrowClosed },
                                 style: { stroke: '#2196f3' },
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

    // 3. Swimlane Layout
    const npcs = Array.from(new Set(Array.from(nodeDataMap.values()).map(d => d.npc))).sort();
    const LANE_HEIGHT = 250;
    const NODE_WIDTH = 200;
    const LEVEL_WIDTH = 300;

    // Calculate topological levels
    const levels = new Map<string, number>();
    const queue: string[] = [];

    // Initialize roots
    nodeDataMap.forEach((_, id) => {
        if ((incomingCount.get(id) || 0) === 0) {
            levels.set(id, 0);
            queue.push(id);
        }
    });

    // BFS for levels
    while (queue.length > 0) {
        const u = queue.shift()!;
        const currentLevel = levels.get(u)!;
        const neighbors = adjacency.get(u) || [];

        neighbors.forEach(v => {
            const existingLevel = levels.get(v);
            // Push to next level if deeper path found
            if (existingLevel === undefined || existingLevel < currentLevel + 1) {
                levels.set(v, currentLevel + 1);
                queue.push(v);
            }
        });
    }

    // Resolve overlapping nodes in same lane/level
    const laneOccupancy = new Map<string, Map<number, number>>(); // NPC -> Level -> Count
    npcs.forEach(npc => laneOccupancy.set(npc, new Map()));

    nodeDataMap.forEach((data, id) => {
        const level = levels.get(id) || 0;
        const npcMap = laneOccupancy.get(data.npc)!;
        const count = npcMap.get(level) || 0;
        npcMap.set(level, count + 1);

        const x = level * LEVEL_WIDTH + 50;
        const npcIndex = npcs.indexOf(data.npc);
        const yBase = npcIndex * LANE_HEIGHT;
        const yOffset = count * 60; // Offset for collisions

        const y = yBase + 50 + yOffset;

        // Color coding
        let bg = '#fff';
        let border = '#777';
        if (data.type === 'start') { bg = '#e3f2fd'; border = '#2196f3'; }
        if (data.type === 'success') { bg = '#e8f5e9'; border = '#4caf50'; }
        if (data.type === 'failed') { bg = '#ffebee'; border = '#f44336'; }
        if (data.type === 'update') { bg = '#fff3e0'; border = '#ff9800'; }

        nodes.push({
            id,
            position: { x, y },
            type: 'default',
            data: {
                label: (
                    <Box>
                        <Typography variant="caption" display="block" color="textSecondary" sx={{ fontSize: 10 }}>
                            {data.npc}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                            {data.label}
                        </Typography>
                        {data.description && (
                            <Typography variant="caption" display="block" sx={{ fontStyle: 'italic', fontSize: 10 }}>
                                {data.description}
                            </Typography>
                        )}
                    </Box>
                )
            },
            style: {
                background: bg,
                borderColor: border,
                borderWidth: 2,
                width: NODE_WIDTH,
                padding: 10,
                borderRadius: 8
            }
        });
    });

    // Add Swimlane Visuals (Group Nodes)
    npcs.forEach((npc, index) => {
        const maxLevel = Math.max(...Array.from(levels.values()), 0);

        nodes.unshift({
            id: `swimlane-${npc}`,
            type: 'group',
            position: { x: 0, y: index * LANE_HEIGHT },
            style: {
                width: (maxLevel + 1) * LEVEL_WIDTH + 100,
                height: LANE_HEIGHT - 20,
                backgroundColor: 'rgba(240, 240, 240, 0.3)',
                border: '1px dashed #ccc',
                zIndex: -1,
                padding: 10,
            },
            data: { label: <Typography variant="subtitle2" color="textSecondary">{npc}</Typography> },
            selectable: false,
            draggable: false,
        });
    });

    return { nodes, edges };
  }, [semanticModel, questName]);

  if (!questName) {
      return (
          <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Typography color="text.secondary">Select a quest to view flow</Typography>
          </Box>
      );
  }

  return (
    <Box sx={{ height: '100%', width: '100%', bgcolor: '#fafafa' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </Box>
  );
};

export default QuestFlow;
