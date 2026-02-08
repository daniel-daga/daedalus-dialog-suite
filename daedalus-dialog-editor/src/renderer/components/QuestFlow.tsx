import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography } from '@mui/material';
import type { SemanticModel } from '../types/global';
import { useNavigation } from '../hooks/useNavigation';
import { buildQuestGraph } from './QuestEditor/questGraphUtils';

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

  // Initialize Graph from Semantic Model using the utility function
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildQuestGraph(semanticModel, questName);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [semanticModel, questName, setNodes, setEdges]);

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
        <MiniMap
            nodeStrokeColor={(n) => {
                if (n.type === 'questState') return '#00ff00';
                if (n.type === 'group') return '#eee';
                return '#0041d0';
            }}
            nodeColor={(n) => {
                if (n.type === 'group') return '#fff';
                return '#fff';
            }}
            nodeBorderRadius={2}
            maskColor="rgba(0, 0, 0, 0.7)"
            style={{ backgroundColor: '#222' }}
        />
      </ReactFlow>
    </Box>
  );
};

export default QuestFlow;
