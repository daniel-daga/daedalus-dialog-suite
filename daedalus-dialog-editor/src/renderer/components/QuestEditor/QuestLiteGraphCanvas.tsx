import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { LGraph, LGraphCanvas, LGraphNode } from 'litegraph.js';
import type { QuestGraphConditionType, QuestGraphEdge, QuestGraphNode } from '../../types/questGraph';

interface QuestLiteGraphCanvasProps {
  nodes: QuestGraphNode[];
  edges: QuestGraphEdge[];
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
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

type VisibleLink = { id: number; _pos?: [number, number] };

type ExtendedLGraphCanvas = LGraphCanvas & {
  bgcolor?: string;
  ds?: { scale: number; offset: [number, number] };
  visible_links?: VisibleLink[];
  showLinkMenu?: (link: { id: number }, event?: MouseEvent) => boolean;
  onDrawForeground?: (ctx: CanvasRenderingContext2D) => void;
  convertOffsetToCanvas?: (pos: [number, number], out?: [number, number]) => [number, number];
};

// Test-only inspection surface exposed on `window.__questGraphDebug` in dev/test
// builds (see the gate below). Playwright drives the real litegraph canvas through
// this — canvas pixels are otherwise unaddressable — returning CSS-pixel PAGE
// coordinates (viewport-relative, matching Playwright's mouse coordinate space)
// computed from `ds` scale/offset + the canvas bounding rect, per fix-04 §5's
// HiDPI note. Not present in production builds.
interface QuestGraphDebugScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface QuestGraphDebugApi {
  /** Current pan/zoom. Used to assert the viewport survives a model edit (Q3/Q5). */
  getViewport(): { scale: number; offset: [number, number] };
  /** Front-canvas draw counter — flat over an idle window proves no render storm (Q5). */
  getRenderCount(): number;
  /** Model-sync rebuild counter. */
  getBuildCount(): number;
  getSelectedNodeId(): string | null;
  getSelectedEdgeId(): string | null;
  listNodes(): Array<{ id: string; type: string; runtimeId: number; hasIfPanel: boolean }>;
  listEdges(): Array<{ id: string; kind?: string; source: string; target: string }>;
  /** CSS-pixel page coords of a transition/link center marker, or null if not drawn yet. */
  getLinkCenterScreenPos(edgeId: string): { x: number; y: number } | null;
  getNodeScreenRect(nodeId: string): QuestGraphDebugScreenRect | null;
  /** Screen rect of the painted IF chip panel on a dialog node (Q2 selection affordance). */
  getIfPanelScreenRect(nodeId: string): QuestGraphDebugScreenRect | null;
  /**
   * Zooms/pans so every node (and therefore every link) fits inside the canvas and is
   * drawn — dagre lays the graph out wider than the canvas, and a link's `_pos` is only
   * computed while visible, so this makes all node/link centers addressable. Returns
   * false if there is nothing to fit.
   */
  fitAll(): boolean;
}

// Gate the debug surface to dev/test builds only. The Vite entry (main.tsx /
// node-editor.main.tsx) sets this flag from `import.meta.env.DEV || MODE==='test'`,
// which is the exact build mode the Playwright `dev:browser` harness runs under and
// is false for `vite build` production output. We read the flag off `window` instead
// of referencing `import.meta` here so this module still compiles under ts-jest
// (module=commonjs), which rejects the `import.meta` meta-property.
const isQuestGraphDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { __questGraphDebugEnabled?: boolean }).__questGraphDebugEnabled);
};

// Selection accent for the edge-center marker; mirrors litegraph's white node
// selection outline (LiteGraph.NODE_BOX_OUTLINE_COLOR).
const SELECTED_EDGE_MARKER_COLOR = '#ffffff';
const EDGE_HIT_RADIUS_PX = 12;

const getConditionTypeLabel = (conditionType?: QuestGraphConditionType): string => {
  if (!conditionType) return 'Condition';
  if (conditionType === 'ExternalTriggerCondition') return 'External Trigger';
  if (conditionType === 'LogicalCondition') return 'Logical';
  return conditionType.replace(/Condition$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
};

const getConditionNodeColor = (conditionType?: QuestGraphConditionType): string => {
  switch (conditionType) {
    case 'VariableCondition':
      return '#1565c0';
    case 'NpcKnowsInfoCondition':
      return '#00695c';
    case 'NpcHasItemsCondition':
      return '#6d4c41';
    case 'NpcIsInStateCondition':
      return '#455a64';
    case 'NpcIsDeadCondition':
      return '#b71c1c';
    case 'NpcGetDistToWpCondition':
      return '#2e7d32';
    case 'NpcGetTalentSkillCondition':
      return '#4a148c';
    case 'ExternalTriggerCondition':
      return '#558b2f';
    case 'Condition':
      return '#455a64';
    default:
      return '#8a6d1f';
  }
};

export const formatRuntimeNodeTitle = (
  label: string,
  conditionTypeLabel?: string | null
): string => {
  const normalizedLabel = String(label || '').trim();
  void conditionTypeLabel;
  return normalizedLabel;
};
const truncateExpressionPreview = (expression: string, maxLength = 48): string => {
  if (expression.length <= maxLength) return expression;
  return `${expression.slice(0, maxLength - 1)}...`;
};

const CONDITION_PANEL_PREVIEW_MAX_LENGTH = 34;
const CONDITION_PANEL_MIN_WIDTH = 250;
const CONDITION_PANEL_MIN_HEIGHT = 118;
const DIALOG_INLINE_PANEL_HEIGHT = 86;
const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 8
): void => {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const attachConditionPreviewRenderer = (
  runtimeNode: LGraphNode,
  expression: string,
  options?: { panelY?: number; chipLabel?: string }
): void => {
  const runtimeNodeAny = runtimeNode as any;
  const previousOnDrawForeground = runtimeNodeAny.onDrawForeground;
  runtimeNodeAny.onDrawForeground = function onDrawForeground(ctx: CanvasRenderingContext2D) {
    if (typeof previousOnDrawForeground === 'function') {
      previousOnDrawForeground.call(this, ctx);
    }
    if (!ctx || runtimeNodeAny.flags?.collapsed) return;

    const panelX = 10;
    const panelY = Math.max(36, Math.floor(options?.panelY ?? 52));
    const panelWidth = Math.max(120, (runtimeNodeAny.size?.[0] ?? 220) - 20);
    const panelHeight = 40;

    ctx.save();
    drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 8);
    ctx.fillStyle = 'rgba(14, 18, 27, 0.92)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#9ecbff';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(options?.chipLabel || 'IF', panelX + 8, panelY + 6);

    ctx.fillStyle = '#e2ebf7';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.fillText(
      truncateExpressionPreview(expression, CONDITION_PANEL_PREVIEW_MAX_LENGTH),
      panelX + 8,
      panelY + 19,
      panelWidth - 16
    );
    ctx.restore();
  };
};

const QuestLiteGraphCanvas: React.FC<QuestLiteGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  onNodeMove,
  onPaneClick
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<LGraph | null>(null);
  const graphCanvasRef = useRef<ExtendedLGraphCanvas | null>(null);
  const nodeMapRef = useRef<Map<string, QuestGraphNode>>(new Map());
  const questIdToRuntimeNodeRef = useRef<Map<string, LGraphNode>>(new Map());
  const linkIdToEdgeRef = useRef<Map<number, QuestGraphEdge>>(new Map());
  // Debug-hook bookkeeping (test-only). renderCount ticks per front-canvas draw;
  // buildCount ticks per model-sync rebuild. Both back the idle-stability assertions.
  const renderCountRef = useRef(0);
  const buildCountRef = useRef(0);

  const callbacksRef = useRef({
    onNodeClick,
    onNodeDoubleClick,
    onEdgeClick,
    onNodeMove,
    onPaneClick
  });

  useEffect(() => {
    callbacksRef.current = {
      onNodeClick,
      onNodeDoubleClick,
      onEdgeClick,
      onNodeMove,
      onPaneClick
    };
  });

  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;

  const selectedEdgeIdRef = useRef(selectedEdgeId);
  selectedEdgeIdRef.current = selectedEdgeId;

  const syncSelection = () => {
    const graphCanvas = graphCanvasRef.current;
    if (!graphCanvas) return;

    const currentSelectedId = selectedNodeIdRef.current;
    if (!currentSelectedId) {
      graphCanvas.deselectAllNodes();
      graphCanvas.setDirty(true, true);
      return;
    }

    const runtimeNode = questIdToRuntimeNodeRef.current.get(currentSelectedId);
    if (!runtimeNode) return;
    if (!graphCanvas.selected_nodes?.[runtimeNode.id]) {
      graphCanvas.selectNode(runtimeNode, false);
    }
    graphCanvas.setDirty(true, true);
  };

  // Mount-once init: this effect must keep deps `[]` — one LGraph/LGraphCanvas per
  // mounted <canvas>. All callback props flow through `callbacksRef` (kept current by
  // the effect above) so prop churn never tears down / recreates the canvas (would reset
  // pan/zoom + selection and leak stale input-wired canvases). Do NOT add reactive deps.
  useEffect(() => {
    if (!canvasRef.current) return;
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return;

    const graph = new LGraph();
    const graphCanvas = new LGraphCanvas(canvasRef.current, graph) as ExtendedLGraphCanvas;
    graphCanvas.allow_dragcanvas = true;
    graphCanvas.allow_searchbox = false;
    graphCanvas.bgcolor = '#1f1f1f';

    graphCanvas.onSelectionChange = (selectedNodes: Record<number, LGraphNode>) => {
      const runtimeNodes = Object.values(selectedNodes || {});
      if (runtimeNodes.length === 0) {
        return;
      }

      const selectedNode = runtimeNodes[runtimeNodes.length - 1];
      const questNode = nodeMapRef.current.get(String(selectedNode.id));
      if (questNode) {
        callbacksRef.current.onNodeClick({ preventDefault: () => undefined } as React.MouseEvent, questNode);
      }
    };

    graphCanvas.onNodeDblClicked = (selectedNode: LGraphNode) => {
      const questNode = nodeMapRef.current.get(String(selectedNode.id));
      if (questNode) {
        callbacksRef.current.onNodeDoubleClick({ preventDefault: () => undefined } as React.MouseEvent, questNode);
      }
    };

    // Primary link-click interception: litegraph's own processMouseDown link hit test
    // invokes showLinkMenu(link, e) (a prototype method, instance-overridable). Overriding
    // it fires our edge-selection callback and returns false to suppress the built-in
    // "Add Node" / "Delete" context menu (N7 — its Delete would desync graph vs model).
    graphCanvas.showLinkMenu = (link: { id: number }) => {
      const edge = linkIdToEdgeRef.current.get(link.id);
      if (edge) {
        callbacksRef.current.onEdgeClick({ preventDefault: () => undefined } as React.MouseEvent, edge);
      }
      return false;
    };

    graphCanvas.onMouse = (rawEvent: MouseEvent) => {
      if (rawEvent.type !== 'mousedown' || rawEvent.button !== 0) return false;
      const event = rawEvent as MouseEvent & { canvasX?: number; canvasY?: number };
      if (typeof event.canvasX !== 'number' || typeof event.canvasY !== 'number') return false;
      const clickedNode = graph.getNodeOnPos(event.canvasX, event.canvasY, graphCanvas.visible_nodes);
      if (clickedNode) return false;

      // Enlarged link hit test (12px vs litegraph's stock ±4px box) so edges are a
      // usable primary interaction. visible_links / _pos are only populated after a
      // draw, so tolerate empty/undefined arrays (first click before first frame).
      const links = graphCanvas.visible_links;
      if (Array.isArray(links)) {
        const thresholdSq = EDGE_HIT_RADIUS_PX * EDGE_HIT_RADIUS_PX;
        for (const link of links) {
          const center = link?._pos;
          if (!center) continue;
          const dx = event.canvasX - center[0];
          const dy = event.canvasY - center[1];
          if (dx * dx + dy * dy > thresholdSq) continue;
          const edge = linkIdToEdgeRef.current.get(link.id);
          if (!edge) continue;
          callbacksRef.current.onEdgeClick({ preventDefault: () => undefined } as React.MouseEvent, edge);
          return true; // consume so litegraph does not start a canvas drag
        }
      }

      callbacksRef.current.onPaneClick();
      return false;
    };

    // Selected-edge visual feedback: stroke a small marker at the selected link's center.
    graphCanvas.onDrawForeground = (ctx: CanvasRenderingContext2D) => {
      renderCountRef.current += 1;
      const selectedEdge = selectedEdgeIdRef.current;
      if (!selectedEdge || !ctx) return;
      const links = graphCanvas.visible_links;
      if (!Array.isArray(links)) return;
      for (const link of links) {
        const center = link?._pos;
        if (!center) continue;
        const edge = linkIdToEdgeRef.current.get(link.id);
        if (!edge || edge.id !== selectedEdge) continue;
        ctx.save();
        ctx.strokeStyle = SELECTED_EDGE_MARKER_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center[0], center[1], 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
    };

    graphCanvas.onNodeMoved = (selectedNode: LGraphNode) => {
      if (!Array.isArray(selectedNode.pos)) return;
      const questNode = nodeMapRef.current.get(String(selectedNode.id));
      if (!questNode) return;
      callbacksRef.current.onNodeMove(questNode.id, {
        x: selectedNode.pos[0],
        y: selectedNode.pos[1]
      }, questNode.type, questNode.data.provenance?.filePath);
    };

    graphRef.current = graph;
    graphCanvasRef.current = graphCanvas;

    if (isQuestGraphDebugEnabled()) {
      const graphToScreen = (gx: number, gy: number): [number, number] | null => {
        const canvasEl = canvasRef.current;
        const convert = graphCanvas.convertOffsetToCanvas;
        if (!canvasEl || typeof convert !== 'function') return null;
        const [cx, cy] = convert.call(graphCanvas, [gx, gy]);
        const rect = canvasEl.getBoundingClientRect();
        return [rect.left + cx, rect.top + cy];
      };
      const rectFromGraph = (
        gx: number,
        gy: number,
        gw: number,
        gh: number
      ): QuestGraphDebugScreenRect | null => {
        const topLeft = graphToScreen(gx, gy);
        const bottomRight = graphToScreen(gx + gw, gy + gh);
        if (!topLeft || !bottomRight) return null;
        const [left, top] = topLeft;
        const [right, bottom] = bottomRight;
        return {
          left,
          top,
          right,
          bottom,
          width: right - left,
          height: bottom - top,
          centerX: (left + right) / 2,
          centerY: (top + bottom) / 2
        };
      };
      const debugApi: QuestGraphDebugApi = {
        getViewport: () => ({
          scale: graphCanvas.ds?.scale ?? 1,
          offset: graphCanvas.ds?.offset ?? [0, 0]
        }),
        getRenderCount: () => renderCountRef.current,
        getBuildCount: () => buildCountRef.current,
        getSelectedNodeId: () => selectedNodeIdRef.current ?? null,
        getSelectedEdgeId: () => selectedEdgeIdRef.current ?? null,
        listNodes: () =>
          Array.from(questIdToRuntimeNodeRef.current.entries()).map(([id, runtimeNode]) => ({
            id,
            type: nodeMapRef.current.get(String(runtimeNode.id))?.type ?? 'unknown',
            runtimeId: Number(runtimeNode.id),
            hasIfPanel: Boolean((runtimeNode as unknown as { __ifPanelLocalRect?: unknown }).__ifPanelLocalRect)
          })),
        listEdges: () =>
          Array.from(linkIdToEdgeRef.current.values()).map((edge) => ({
            id: edge.id,
            kind: edge.data?.kind,
            source: edge.source,
            target: edge.target
          })),
        getLinkCenterScreenPos: (edgeId: string) => {
          const links = graphCanvas.visible_links;
          if (!Array.isArray(links)) return null;
          for (const link of links) {
            const center = link?._pos;
            if (!center) continue;
            if (linkIdToEdgeRef.current.get(link.id)?.id !== edgeId) continue;
            const screen = graphToScreen(center[0], center[1]);
            return screen ? { x: screen[0], y: screen[1] } : null;
          }
          return null;
        },
        getNodeScreenRect: (nodeId: string) => {
          // litegraph stores pos/size as Float32Array, so length-check (not Array.isArray).
          const runtimeNode = questIdToRuntimeNodeRef.current.get(nodeId);
          const pos = runtimeNode?.pos;
          const size = runtimeNode?.size;
          if (!pos || pos.length < 2 || !size || size.length < 2) return null;
          return rectFromGraph(pos[0], pos[1], size[0], size[1]);
        },
        getIfPanelScreenRect: (nodeId: string) => {
          const runtimeNode = questIdToRuntimeNodeRef.current.get(nodeId);
          const pos = runtimeNode?.pos;
          const panel = (runtimeNode as unknown as {
            __ifPanelLocalRect?: { x: number; y: number; w: number; h: number };
          })?.__ifPanelLocalRect;
          if (!pos || pos.length < 2 || !panel) return null;
          return rectFromGraph(pos[0] + panel.x, pos[1] + panel.y, panel.w, panel.h);
        },
        fitAll: () => {
          const canvasEl = canvasRef.current;
          const ds = graphCanvas.ds;
          const runtimeNodes = Array.from(questIdToRuntimeNodeRef.current.values());
          if (!canvasEl || !ds || runtimeNodes.length === 0) return false;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const runtimeNode of runtimeNodes) {
            const pos = runtimeNode.pos;
            const size = runtimeNode.size;
            if (!pos || pos.length < 2 || !size || size.length < 2) continue;
            // Include the title bar above the node body so nothing clips.
            minX = Math.min(minX, pos[0]);
            minY = Math.min(minY, pos[1] - 30);
            maxX = Math.max(maxX, pos[0] + size[0]);
            maxY = Math.max(maxY, pos[1] + size[1]);
          }
          if (!Number.isFinite(minX)) return false;
          const rect = canvasEl.getBoundingClientRect();
          const margin = 48;
          const bboxW = Math.max(1, maxX - minX);
          const bboxH = Math.max(1, maxY - minY);
          const scale = Math.max(
            0.1,
            Math.min(1, (rect.width - margin * 2) / bboxW, (rect.height - margin * 2) / bboxH)
          );
          ds.scale = scale;
          ds.offset[0] = rect.width / 2 / scale - (minX + maxX) / 2;
          ds.offset[1] = rect.height / 2 / scale - (minY + maxY) / 2;
          graphCanvas.setDirty(true, true);
          graphCanvas.draw(true, true);
          return true;
        }
      };
      (window as unknown as { __questGraphDebug?: QuestGraphDebugApi }).__questGraphDebug = debugApi;
    }

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
      graphCanvas.setCanvas(null as unknown as HTMLCanvasElement);
      if (isQuestGraphDebugEnabled()) {
        delete (window as unknown as { __questGraphDebug?: QuestGraphDebugApi }).__questGraphDebug;
      }
      graphRef.current = null;
      graphCanvasRef.current = null;
      nodeMapRef.current = new Map();
      questIdToRuntimeNodeRef.current = new Map();
      linkIdToEdgeRef.current = new Map();
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    graph.clear();
    nodeMapRef.current = new Map();
    questIdToRuntimeNodeRef.current = new Map();
    linkIdToEdgeRef.current = new Map();

    const runtimeNodes = new Map<string, LGraphNode>();
    const questNodesById = new Map(nodes.map((node) => [node.id, node]));
    const dialogInputSlotByEdgeId = new Map<string, number>();
    const dialogRequiredInputsByNode = new Map<string, number>();
    const isMultiInputTarget = (targetNode?: QuestGraphNode): boolean => (
      targetNode?.type === 'dialog' || targetNode?.type === 'questState'
    );

    const parsePreferredDialogSlot = (targetHandle?: string | null): number => {
      if (!targetHandle) return 0;
      if (targetHandle === 'in-right') return 1;
      if (
        targetHandle === 'in-left' ||
        targetHandle === 'in-condition' ||
        targetHandle === 'in-trigger'
      ) {
        return 0;
      }
      const conditionMatch = /^in-condition-(\d+)/.exec(targetHandle);
      if (conditionMatch) {
        return Number(conditionMatch[1]);
      }
      return 0;
    };

    const incomingDialogEdgesByTarget = new Map<string, QuestGraphEdge[]>();
    edges.forEach((edge) => {
      const targetNode = questNodesById.get(edge.target);
      if (!isMultiInputTarget(targetNode)) return;
      const bucket = incomingDialogEdgesByTarget.get(edge.target) || [];
      bucket.push(edge);
      incomingDialogEdgesByTarget.set(edge.target, bucket);
    });

    incomingDialogEdgesByTarget.forEach((incomingEdges, targetNodeId) => {
      const targetNode = questNodesById.get(targetNodeId);
      const declaredConditionCountRaw = Number(targetNode?.data?.conditionCount ?? 0);
      const declaredConditionCount = Number.isFinite(declaredConditionCountRaw)
        ? Math.max(0, Math.floor(declaredConditionCountRaw))
        : 0;

      const usedSlots = new Set<number>();
      let maxSlotIndex = Math.max(0, declaredConditionCount - 1);

      incomingEdges.forEach((edge) => {
        let slot = parsePreferredDialogSlot(edge.targetHandle);
        if (!Number.isFinite(slot) || slot < 0) {
          slot = 0;
        }
        while (usedSlots.has(slot)) {
          slot += 1;
        }
        usedSlots.add(slot);
        maxSlotIndex = Math.max(maxSlotIndex, slot);
        dialogInputSlotByEdgeId.set(edge.id, slot);
      });

      dialogRequiredInputsByNode.set(targetNodeId, Math.max(1, maxSlotIndex + 1));
    });

    nodes.forEach((node, index) => {
      if (node.type === 'group') return;
      const label = String(node.data?.label || node.id);
      const conditionTypeLabel = node.type === 'condition'
        ? getConditionTypeLabel(node.data?.conditionType)
        : null;
      const showConditionTypeSuffix = Boolean(conditionTypeLabel && conditionTypeLabel !== 'Condition');
      const runtimeNode = new LGraphNode(label);
      runtimeNode.id = index + 1;
      runtimeNode.title = node.type === 'condition'
        ? formatRuntimeNodeTitle(label, conditionTypeLabel)
        : (showConditionTypeSuffix ? `${label} (${conditionTypeLabel})` : label);
      runtimeNode.pos = [node.position.x, node.position.y];
      runtimeNode.size = [220, 90];
      if (node.type === 'logical') {
        runtimeNode.addInput('A', '*');
        runtimeNode.addInput('B', '*');
        runtimeNode.addOutput(String(node.data?.operator || 'Result'), '*');
      } else if (node.type === 'dialog' || node.type === 'questState') {
        const declaredConditionCountRaw = Number(node.data?.conditionCount ?? 0);
        const declaredConditionCount = Number.isFinite(declaredConditionCountRaw)
          ? Math.max(0, Math.floor(declaredConditionCountRaw))
          : 0;
        const requiredInputCount = dialogRequiredInputsByNode.get(node.id)
          ?? Math.max(1, declaredConditionCount);
        const labeledConditionCount = Math.max(1, declaredConditionCount);

        for (let slotIndex = 0; slotIndex < requiredInputCount; slotIndex += 1) {
          const label = slotIndex < labeledConditionCount
            ? `Condition ${slotIndex + 1}`
            : `Input ${slotIndex + 1}`;
          runtimeNode.addInput(label, '*');
        }
        runtimeNode.addOutput('Out', '*');
        // Size must be set AFTER add{Input,Output}: litegraph's addInput/addOutput each
        // call setSize(computeSize()), which would otherwise shrink the node back and
        // leave the painted IF panel jutting below the body (unclickable).
        runtimeNode.size = [220, Math.max(130, 44 + requiredInputCount * 18 + DIALOG_INLINE_PANEL_HEIGHT)];
      } else {
        runtimeNode.addInput('Conditions', '*');
        runtimeNode.addOutput(node.type === 'condition' ? 'Result' : 'Out', '*');
      }
      runtimeNode.color = node.type === 'condition'
        ? getConditionNodeColor(node.data?.conditionType)
        : node.type === 'logical'
          ? '#7b1fa2'
          : node.type === 'questState'
            ? '#2c6936'
            : '#2d4f7c';
      const runtimeNodeAny = runtimeNode as any;
      if (node.type === 'condition' && typeof node.data?.expression === 'string') {
        const expressionPreviewSource = String(node.data.expression || '').trim();
        if (expressionPreviewSource.length > 0) {
          runtimeNodeAny.size[0] = Math.max(runtimeNodeAny.size[0], CONDITION_PANEL_MIN_WIDTH);
          runtimeNodeAny.size[1] = Math.max(runtimeNodeAny.size[1], CONDITION_PANEL_MIN_HEIGHT);
          attachConditionPreviewRenderer(runtimeNode, expressionPreviewSource, { chipLabel: 'IF' });
        }
      }

      if (node.type === 'dialog') {
        const expressionPreviewSource = String(node.data?.conditionExpression || '').trim() || 'No condition expression.';
        const inputCount = Array.isArray(runtimeNode.inputs) ? runtimeNode.inputs.length : 0;
        const panelY = Math.max(52, 34 + Math.max(0, inputCount) * 18);
        attachConditionPreviewRenderer(runtimeNode, expressionPreviewSource, { panelY, chipLabel: 'IF' });

        // Clicking the painted IF chip selects the node (opening the inspector's condition
        // expression editor) and blocks node-drag for that click. Geometry mirrors
        // attachConditionPreviewRenderer: panelX=10, panelHeight=40, width = size-20.
        const panelWidth = Math.max(120, (runtimeNodeAny.size?.[0] ?? 220) - 20);
        // Persist the IF-panel geometry (node-local coords) so the debug hook can
        // resolve its screen rect for Playwright without duplicating this math.
        runtimeNodeAny.__ifPanelLocalRect = { x: 10, y: panelY, w: panelWidth, h: 40 };
        const questNode = node;
        runtimeNodeAny.onMouseDown = (_event: MouseEvent, pos?: [number, number]) => {
          if (!Array.isArray(pos)) return false;
          const [localX, localY] = pos;
          if (
            localX >= 10 && localX <= 10 + panelWidth &&
            localY >= panelY && localY <= panelY + 40
          ) {
            callbacksRef.current.onNodeClick({ preventDefault: () => undefined } as React.MouseEvent, questNode);
            return true;
          }
          return false;
        };
      }
      graph.add(runtimeNode);
      runtimeNodes.set(node.id, runtimeNode);
      questIdToRuntimeNodeRef.current.set(node.id, runtimeNode);
      nodeMapRef.current.set(String(runtimeNode.id), node);
    });

    const resolveOutputSlot = (edge: QuestGraphEdge): number => {
      if (edge.sourceHandle === 'out-bool') return 0;
      if (edge.sourceHandle === 'out-state') return 0;
      if (edge.sourceHandle === 'out-finished') return 0;
      return 0;
    };

    const resolveInputSlot = (edge: QuestGraphEdge): number => {
      const targetQuestNode = questNodesById.get(edge.target);
      if (isMultiInputTarget(targetQuestNode)) {
        const mappedSlot = dialogInputSlotByEdgeId.get(edge.id);
        if (typeof mappedSlot === 'number') return mappedSlot;
      }

      const conditionMatch = /^in-condition-(\d+)/.exec(edge.targetHandle || '');
      if (conditionMatch) {
        return Number(conditionMatch[1]);
      }
      if (edge.targetHandle === 'in-left' || edge.targetHandle === 'in-condition') return 0;
      if (edge.targetHandle === 'in-right') return 1;
      if (edge.targetHandle === 'in-trigger') return 0;
      return 0;
    };

    edges.forEach((edge) => {
      const source = runtimeNodes.get(edge.source);
      const target = runtimeNodes.get(edge.target);
      if (!source || !target) return;
      const linkInfo = source.connect(resolveOutputSlot(edge), target, resolveInputSlot(edge)) as { id?: number } | null;
      if (typeof linkInfo?.id === 'number') {
        linkIdToEdgeRef.current.set(linkInfo.id, edge);
      }
    });

    buildCountRef.current += 1;
    graphCanvasRef.current?.draw(true, true);
    // Pan/zoom survive automatically now that the canvas is not recreated; re-apply the
    // current selection against the freshly rebuilt runtime nodes.
    syncSelection();
  }, [nodes, edges]);

  useEffect(() => {
    syncSelection();
  }, [selectedNodeId]);

  useEffect(() => {
    // Repaint the foreground so the selected-edge marker tracks the current selection.
    graphCanvasRef.current?.setDirty(true, true);
  }, [selectedEdgeId]);

  return (
    <Box ref={containerRef} sx={{ height: '100%', width: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
};

export default QuestLiteGraphCanvas;

