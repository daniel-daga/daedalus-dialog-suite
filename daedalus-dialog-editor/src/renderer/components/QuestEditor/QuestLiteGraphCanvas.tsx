import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { LGraph, LGraphCanvas, LGraphNode } from 'litegraph.js';
import type { QuestGraphEdge, QuestGraphNode } from '../../types/questGraph';

interface QuestLiteGraphCanvasProps {
  nodes: QuestGraphNode[];
  edges: QuestGraphEdge[];
  selectedNodeId?: string | null;
  onNodeClick: (event: React.MouseEvent, node: QuestGraphNode) => void;
  onNodeDoubleClick: (event: React.MouseEvent, node: QuestGraphNode) => void;
  onEdgeClick: (event: React.MouseEvent, edge: QuestGraphEdge) => void;
  onNodeMove: (
    nodeId: string,
    position: { x: number; y: number },
    nodeType?: string,
    ownerFilePath?: string
  ) => void;
  onPaneClick: () => void;
}

const QuestLiteGraphCanvas: React.FC<QuestLiteGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onNodeMove,
  onPaneClick
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<LGraph | null>(null);
  const graphCanvasRef = useRef<LGraphCanvas | null>(null);
  const nodeMapRef = useRef<Map<string, QuestGraphNode>>(new Map());
  const questIdToRuntimeNodeRef = useRef<Map<string, LGraphNode>>(new Map());
  const edgeMapRef = useRef<Map<string, QuestGraphEdge>>(new Map());

  useEffect(() => {
    if (!canvasRef.current) return;

    const graph = new LGraph();
    const graphCanvas = new LGraphCanvas(canvasRef.current, graph);
    graphCanvas.allow_dragcanvas = true;
    graphCanvas.bgcolor = '#1f1f1f';

    graphCanvas.onSelectionChange = (selectedNodes: Record<number, LGraphNode>) => {
      const runtimeNodes = Object.values(selectedNodes || {});
      if (runtimeNodes.length === 0) {
        return;
      }

      const selectedNode = runtimeNodes[runtimeNodes.length - 1];
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
      const sourceNode = nodeMapRef.current.get(String(link.origin_id));
      const targetNode = nodeMapRef.current.get(String(link.target_id));
      if (!sourceNode || !targetNode) return;
      const edge = Array.from(edgeMapRef.current.values()).find(
        (candidate) => candidate.source === sourceNode.id && candidate.target === targetNode.id
      );
      if (edge) {
        onEdgeClick({ preventDefault: () => undefined } as React.MouseEvent, edge);
      }
    };

    graphCanvas.onMouse = (rawEvent: MouseEvent) => {
      if (rawEvent.type !== 'mousedown' || rawEvent.button !== 0) return false;
      const event = rawEvent as MouseEvent & { canvasX?: number; canvasY?: number };
      if (typeof event.canvasX !== 'number' || typeof event.canvasY !== 'number') return false;
      const clickedNode = graph.getNodeOnPos(event.canvasX, event.canvasY, graphCanvas.visible_nodes);
      if (!clickedNode) {
        onPaneClick();
      }
      return false;
    };

    graphCanvas.onNodeMoved = (selectedNode: LGraphNode) => {
      if (!Array.isArray(selectedNode.pos)) return;
      const questNode = nodeMapRef.current.get(String(selectedNode.id));
      if (!questNode) return;
      onNodeMove(questNode.id, {
        x: selectedNode.pos[0],
        y: selectedNode.pos[1]
      }, questNode.type, questNode.data.provenance?.filePath);
    };

    graphRef.current = graph;
    graphCanvasRef.current = graphCanvas;

    const resizeCanvasToContainer = () => {
      const container = containerRef.current;
      if (!container) return;
      const width = Math.max(1, Math.floor(container.clientWidth));
      const height = Math.max(1, Math.floor(container.clientHeight));
      graphCanvas.resize(width, height);
      graphCanvas.draw(true, true);
    };

    resizeCanvasToContainer();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        resizeCanvasToContainer();
      });
      resizeObserver.observe(containerRef.current);
    } else {
      window.addEventListener('resize', resizeCanvasToContainer);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', resizeCanvasToContainer);
      }
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
    questIdToRuntimeNodeRef.current = new Map();
    edgeMapRef.current = new Map();

    const runtimeNodes = new Map<string, LGraphNode>();

    nodes.forEach((node, index) => {
      if (node.type === 'group') return;
      const runtimeNode = new LGraphNode(String(node.data?.label || node.id));
      runtimeNode.id = index + 1;
      runtimeNode.title = String(node.data?.label || node.id);
      runtimeNode.pos = [node.position.x, node.position.y];
      runtimeNode.size = [220, 90];
      runtimeNode.addInput('Conditions', '*');
      runtimeNode.addOutput(node.type === 'condition' ? 'Result' : 'Out', '*');
      runtimeNode.color = node.type === 'condition' ? '#8a6d1f' : node.type === 'questState' ? '#2c6936' : '#2d4f7c';
      graph.add(runtimeNode);
      runtimeNodes.set(node.id, runtimeNode);
      questIdToRuntimeNodeRef.current.set(node.id, runtimeNode);
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

  useEffect(() => {
    const graphCanvas = graphCanvasRef.current;
    if (!graphCanvas) return;

    if (!selectedNodeId) {
      graphCanvas.deselectAllNodes();
      graphCanvas.setDirty(true, true);
      return;
    }

    const runtimeNode = questIdToRuntimeNodeRef.current.get(selectedNodeId);
    if (!runtimeNode) return;
    if (!graphCanvas.selected_nodes?.[runtimeNode.id]) {
      graphCanvas.selectNode(runtimeNode, false);
    }
    graphCanvas.setDirty(true, true);
  }, [selectedNodeId]);

  return (
    <Box ref={containerRef} sx={{ height: '100%', width: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
};

export default QuestLiteGraphCanvas;
