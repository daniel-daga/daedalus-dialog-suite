import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography } from '@mui/material';
import type { SemanticModel } from '../types/global';
import { getActionType } from './actionTypes';

interface QuestFlowProps {
  semanticModel: SemanticModel;
  questName: string | null;
}

// Helper to extract NPC from dialog or function
const getNpcForFunction = (funcName: string, semanticModel: SemanticModel): string | null => {
  // Check if it's a dialog info function or condition
  for (const dialog of Object.values(semanticModel.dialogs)) {
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
  const { nodes, edges } = useMemo(() => {
    if (!questName) return { nodes: [], edges: [] };

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const misVarName = questName.replace('TOPIC_', 'MIS_');

    // 1. Identify relevant functions/dialogs
    const relevantFunctions = new Set<string>();
    const functionDetails = new Map<string, {
      type: 'start' | 'update' | 'end' | 'check';
      label: string;
      npc: string;
    }>();

    // Map status value (e.g. LOG_RUNNING) to Set of functions that set it
    const producersByStatus = new Map<string, Set<string>>();

    Object.values(semanticModel.functions).forEach(func => {
      let isRelevant = false;
      let type: 'start' | 'update' | 'end' | 'check' = 'check';
      let label = func.name;

      // Check actions
      func.actions?.forEach(action => {
        if ('topic' in action && action.topic === questName) {
          isRelevant = true;
          const actionType = getActionType(action);
          if (actionType === 'createTopic') {
              type = 'start';
              // Implicitly sets LOG_RUNNING
              if (!producersByStatus.has('LOG_RUNNING')) producersByStatus.set('LOG_RUNNING', new Set());
              producersByStatus.get('LOG_RUNNING')?.add(func.name);
          } else if (actionType === 'logSetTopicStatus') {
             // If status is SUCCESS or FAILED (numeric 2 or 3 usually, or const)
             const status = (action as any).status;
             if (String(status).includes('SUCCESS') || String(status).includes('FAILED')) {
                type = 'end';
             } else {
                type = 'update';
             }

             if (status) {
                 if (!producersByStatus.has(status)) producersByStatus.set(status, new Set());
                 producersByStatus.get(status)?.add(func.name);
             }
          } else if (actionType === 'logEntry') {
             if (type !== 'start' && type !== 'end') type = 'update';
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
        relevantFunctions.add(func.name);
        const npc = getNpcForFunction(func.name, semanticModel) || 'Global/Other';
        functionDetails.set(func.name, { type, label, npc });
      }
    });

    // 2. Build dependency graph (Npc_KnowsInfo + Variable State)
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    relevantFunctions.forEach(funcName => {
      if (!adjacency.has(funcName)) adjacency.set(funcName, []);
      if (!inDegree.has(funcName)) inDegree.set(funcName, 0);

      const func = semanticModel.functions[funcName];
      func.conditions?.forEach(cond => {
        // Handle Npc_KnowsInfo
        if ('dialogRef' in cond) { // NpcKnowsInfoCondition
            // cond.dialogRef is the Dialog Instance Name.
            // We need to find the function associated with that dialog.
            const dialogRef = (cond as any).dialogRef;
            const dialog = semanticModel.dialogs[dialogRef];
            if (dialog) {
                // Find the information function of this dialog
                let targetFuncName: string | null = null;
                const info = dialog.properties.information;
                if (typeof info === 'string') targetFuncName = info;
                else if (info && typeof info === 'object') targetFuncName = info.name;

                if (targetFuncName && relevantFunctions.has(targetFuncName)) {
                    adjacency.get(funcName)?.push(targetFuncName);
                }
            }
        }

        // Handle Variable Condition (MIS_Var == Value)
        if ('variableName' in cond && (cond as any).variableName === misVarName) {
           const op = (cond as any).operator;
           const val = (cond as any).value;

           if (op === '==' && val) {
               // Depends on anyone producing 'val'
               const producers = producersByStatus.get(String(val)) || new Set();
               producers.forEach(producer => {
                   if (producer !== funcName) {
                       adjacency.get(funcName)?.push(producer);
                   }
               });
           }
        }
      });
    });

    // Rebuild adjacency for A -> B (A is prerequisite for B)
    const graph = new Map<string, string[]>();
    relevantFunctions.forEach(f => graph.set(f, []));
    const incoming = new Map<string, number>();
    relevantFunctions.forEach(f => incoming.set(f, 0));

    relevantFunctions.forEach(consumer => {
       const prerequisites = adjacency.get(consumer) || [];
       prerequisites.forEach(producer => {
           graph.get(producer)?.push(consumer);
           incoming.set(consumer, (incoming.get(consumer) || 0) + 1);

           edges.push({
             id: `${producer}-${consumer}`,
             source: producer,
             target: consumer,
             markerEnd: { type: MarkerType.ArrowClosed },
             animated: false,
           });
       });
    });

    // 3. Layout (Swimlanes + Topological Layering)
    // Simple layering: Assign level based on depth from roots (nodes with 0 incoming edges)
    // But cycles might exist? (Hopefully not in quest flow, but possible).
    // Use BFS/DFS to assign levels.

    const levels = new Map<string, number>();
    const queue: string[] = [];

    relevantFunctions.forEach(f => {
        if ((incoming.get(f) || 0) === 0) {
            levels.set(f, 0);
            queue.push(f);
        }
    });

    while (queue.length > 0) {
        const u = queue.shift()!;
        const currentLevel = levels.get(u)!;
        const neighbors = graph.get(u) || [];
        neighbors.forEach(v => {
            const existingLevel = levels.get(v);
            if (existingLevel === undefined || existingLevel < currentLevel + 1) {
                levels.set(v, currentLevel + 1);
                queue.push(v);
            }
        });
    }

    // Group by NPC (Swimlanes)
    const npcs = Array.from(new Set(Array.from(functionDetails.values()).map(d => d.npc))).sort();
    const npcY = new Map<string, number>();
    npcs.forEach((npc, index) => npcY.set(npc, index * 200)); // 200px height per lane

    // Generate Nodes
    relevantFunctions.forEach(funcName => {
        const details = functionDetails.get(funcName)!;
        const level = levels.get(funcName) || 0;
        const yBase = npcY.get(details.npc) || 0;

        // Add some jitter or sub-sorting to X if multiple nodes on same level?
        // For now, just X = level * 250.
        // And Y = yBase + (some offset if collisions?)
        // Simple grid: X = level * 300, Y = yBase.

        // To avoid overlapping in the same swimlane at the same level:
        // We need to count how many nodes are at (npc, level) so far.
        // But doing that cleanly is hard without a proper layout engine.
        // Let's just create the nodes and let ReactFlow handle them (or user can drag).
        // I will add a small offset based on hash or index to avoid perfect overlap.

        nodes.push({
            id: funcName,
            position: { x: level * 300 + 50, y: yBase + 50 },
            data: { label: `${details.npc}: ${details.label}` },
            style: {
                background: details.type === 'start' ? '#e3f2fd' :
                            details.type === 'end' ? '#e8f5e9' :
                            details.type === 'update' ? '#fff3e0' : '#f5f5f5',
                border: '1px solid #777',
                width: 180,
                fontSize: 12
            },
            type: 'default' // or input/output
        });
    });

    // Add Swimlane Labels (as background group nodes?)
    npcs.forEach((npc, index) => {
        nodes.push({
            id: `swimlane-${npc}`,
            type: 'group',
            position: { x: 0, y: index * 200 },
            style: {
                width: (Math.max(...Array.from(levels.values()), 0) + 1) * 300 + 100,
                height: 180,
                backgroundColor: 'rgba(240, 240, 240, 0.2)',
                border: '1px dashed #ccc',
                zIndex: -1,
            },
            data: { label: npc },
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
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </Box>
  );
};

export default QuestFlow;
