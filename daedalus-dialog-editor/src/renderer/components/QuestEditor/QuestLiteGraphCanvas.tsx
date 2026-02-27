import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { LGraph, LGraphCanvas, LGraphNode } from 'litegraph.js';
import type { QuestGraphEdge, QuestGraphNode } from '../../types/questGraph';

interface QuestLiteGraphCanvasProps {
  nodes: QuestGraphNode[];
  edges: QuestGraphEdge[];
  onNodeClick: (event: React.MouseEvent, node: QuestGraphNode) => void;
  onNodeDoubleClick: (event: React.MouseEvent, node: QuestGraphNode) => void;
  onEdgeClick: (event: React.MouseEvent, edge: QuestGraphEdge) => void;
  onNodeMove: (nodeId: string, position: { x: number; y: number }) => void;
  onPaneClick: () => void;
}

const QuestLiteGraphCanvas: React.FC<QuestLiteGraphCanvasProps> = ({
  nodes,
  edges,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onNodeMove,
  onPaneClick
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<LGraph | null>(null);
  const graphCanvasRef = useRef<LGraphCanvas | null>(null);
  const nodeMapRef = useRef<Map<string, QuestGraphNode>>(new Map());
  const edgeMapRef = useRef<Map<string, QuestGraphEdge>>(new Map());

  useEffect(() => {
    if (!canvasRef.current) return;

    const graph = new LGraph();
    const graphCanvas = new LGraphCanvas(canvasRef.current, graph);
    graphCanvas.allow_dragcanvas = true;
    graphCanvas.bgcolor = '#1f1f1f';

    graphCanvas.onNodeSelected = (selectedNode: LGraphNode) => {
      const questNode = nodeMapRef.current.get(String(selectedNode.id));
      if (questNode) {
        onNodeClick({ preventDefault: () => undefined } as React.MouseEvent, questNode);
      }
    };

    graphCanvas.onNodeDblClicked = (selectedNode: LGraphNode) => {
      const questNode = nodeMapRef.current.get(String(selectedNode.id));
      if (questNode) {
        onNodeDoubleClick({ preventDefault: () => undefined } as React.MouseEvent, questNode);
      }
    };

    graphCanvas.onLinkSelected = (linkId: number) => {
      const link = graph.links[linkId];
      if (!link) return;
      const edge = Array.from(edgeMapRef.current.values()).find(
        (candidate) => candidate.source === String(link.origin_id) && candidate.target === String(link.target_id)
      );
      if (edge) {
        onEdgeClick({ preventDefault: () => undefined } as React.MouseEvent, edge);
      }
    };

    graphCanvas.onNodeMoved = (selectedNode: LGraphNode) => {
      if (!Array.isArray(selectedNode.pos)) return;
      onNodeMove(String(selectedNode.id), {
        x: selectedNode.pos[0],
        y: selectedNode.pos[1]
      });
    };

    graphCanvas.onClearSelection = () => {
      onPaneClick();
    };

    graphRef.current = graph;
    graphCanvasRef.current = graphCanvas;

    return () => {
      graphCanvas.stopRendering();
      graphCanvas.clear();
      graphRef.current = null;
      graphCanvasRef.current = null;
    };
  }, [onEdgeClick, onNodeClick, onNodeDoubleClick, onNodeMove, onPaneClick]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    graph.clear();
    nodeMapRef.current = new Map();
    edgeMapRef.current = new Map();

    const runtimeNodes = new Map<string, LGraphNode>();

    nodes.forEach((node) => {
      if (node.type === 'group') return;
      const runtimeNode = new LGraphNode(String(node.data?.label || node.id));
      runtimeNode.id = Number(node.id) || Math.floor(Math.random() * 1_000_000);
      runtimeNode.title = String(node.data?.label || node.id);
      runtimeNode.pos = [node.position.x, node.position.y];
      runtimeNode.size = [220, 90];
      runtimeNode.addInput('in', '*');
      runtimeNode.addOutput('out', '*');
      runtimeNode.color = node.type === 'condition' ? '#8a6d1f' : node.type === 'questState' ? '#2c6936' : '#2d4f7c';
      graph.add(runtimeNode);
      runtimeNodes.set(node.id, runtimeNode);
      nodeMapRef.current.set(String(runtimeNode.id), node);
    });

    edges.forEach((edge) => {
      const source = runtimeNodes.get(edge.source);
      const target = runtimeNodes.get(edge.target);
      if (!source || !target) return;
      source.connect(0, target, 0);
      edgeMapRef.current.set(edge.id, edge);
    });

    graph.start();
    graphCanvasRef.current?.draw(true, true);
  }, [nodes, edges]);

  return (
    <Box sx={{ height: '100%', width: '100%' }} onClick={onPaneClick}>
      <canvas ref={canvasRef} width={1600} height={900} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
};

export default QuestLiteGraphCanvas;
