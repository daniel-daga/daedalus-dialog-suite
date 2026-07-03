import React from 'react';
import { render } from '@testing-library/react';
import { LGraphCanvas } from 'litegraph.js';
import QuestLiteGraphCanvas from '../src/renderer/components/QuestEditor/QuestLiteGraphCanvas';
import type { QuestGraphEdge, QuestGraphNode } from '../src/renderer/types/questGraph';

// Deterministic link-id assignment so the mapping from litegraph link ids to quest
// edges is predictable across renders. Reset per test.
const mockLinkState = { counter: 0 };

// Mock litegraph.js so the init effect runs under Jest (the real library needs a live
// 2D canvas context jsdom lacks). Exposes visible_links + a deterministic connect id so
// the Q1 link hit-test and showLinkMenu override can be exercised directly.
jest.mock('litegraph.js', () => {
  class LGraph {
    links: Record<number, unknown> = {};
    clear = jest.fn();
    add = jest.fn();
    getNodeOnPos = jest.fn(() => null);
    start = jest.fn();
  }

  class LGraphNode {
    id = 0;
    title: string;
    pos: [number, number] = [0, 0];
    size: [number, number] = [220, 90];
    color = '';
    inputs: unknown[] = [];
    outputs: unknown[] = [];
    flags: Record<string, unknown> = {};
    constructor(title?: string) {
      this.title = title || '';
    }
    addInput = jest.fn((name: string) => {
      this.inputs.push({ name });
    });
    addOutput = jest.fn((name: string) => {
      this.outputs.push({ name });
    });
    connect = jest.fn(() => ({ id: ++mockLinkState.counter }));
  }

  const LGraphCanvas = jest.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.allow_dragcanvas = false;
    this.allow_searchbox = true;
    this.bgcolor = '';
    this.visible_nodes = [];
    this.visible_links = [];
    this.selected_nodes = {};
    this.resize = jest.fn();
    this.draw = jest.fn();
    this.setDirty = jest.fn();
    this.deselectAllNodes = jest.fn();
    this.selectNode = jest.fn();
    this.clear = jest.fn();
    this.stopRendering = jest.fn();
    this.setCanvas = jest.fn();
  });

  return { LGraph, LGraphCanvas, LGraphNode };
});

const LGraphCanvasMock = LGraphCanvas as unknown as jest.Mock;
const originalUserAgent = window.navigator.userAgent;

const makeDialogNode = (id: string): QuestGraphNode => ({
  id,
  type: 'dialog',
  position: { x: 10, y: 20 },
  data: {
    label: id,
    npc: 'NPC_Test',
    kind: 'dialog',
    conditionExpression: '',
    conditionCount: 1
  }
} as unknown as QuestGraphNode);

const makeEdge = (id: string, source: string, target: string): QuestGraphEdge => ({
  id,
  source,
  target,
  data: { kind: 'transitions' }
});

interface RenderOverrides {
  onEdgeClick?: jest.Mock;
  onPaneClick?: jest.Mock;
  edges?: QuestGraphEdge[];
  selectedEdgeId?: string | null;
}

const renderCanvas = (overrides: RenderOverrides = {}) => {
  const onEdgeClick = overrides.onEdgeClick ?? jest.fn();
  const onPaneClick = overrides.onPaneClick ?? jest.fn();
  const nodes = [makeDialogNode('A'), makeDialogNode('B')];
  const edges = overrides.edges ?? [makeEdge('edge-1', 'A', 'B')];
  const utils = render(
    <QuestLiteGraphCanvas
      nodes={nodes}
      edges={edges}
      selectedNodeId={null}
      selectedEdgeId={overrides.selectedEdgeId ?? null}
      onNodeClick={jest.fn()}
      onNodeDoubleClick={jest.fn()}
      onEdgeClick={onEdgeClick}
      onNodeMove={jest.fn()}
      onPaneClick={onPaneClick}
    />
  );
  const graphCanvas = LGraphCanvasMock.mock.instances[
    LGraphCanvasMock.mock.instances.length - 1
  ] as Record<string, any>;
  return { ...utils, graphCanvas, onEdgeClick, onPaneClick };
};

describe('QuestLiteGraphCanvas link selection (Q1)', () => {
  beforeAll(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'jest-chromium',
      configurable: true
    });
  });

  afterAll(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true
    });
  });

  beforeEach(() => {
    mockLinkState.counter = 0;
    LGraphCanvasMock.mockClear();
  });

  it('overrides showLinkMenu to fire onEdgeClick with the mapped edge and suppress the stock menu', () => {
    const { graphCanvas, onEdgeClick } = renderCanvas();

    expect(typeof graphCanvas.showLinkMenu).toBe('function');

    // The single edge maps to litegraph link id 1 (deterministic mock).
    const result = graphCanvas.showLinkMenu({ id: 1 }, { type: 'contextmenu' } as MouseEvent);

    expect(onEdgeClick).toHaveBeenCalledTimes(1);
    expect(onEdgeClick.mock.calls[0][1]).toEqual(
      expect.objectContaining({ id: 'edge-1', source: 'A', target: 'B' })
    );
    // Returning false suppresses litegraph's built-in Add Node / Delete menu (N7).
    expect(result).toBe(false);
  });

  it('onMouse fires onEdgeClick and consumes the event for a mousedown within 12px of a link center', () => {
    const { graphCanvas, onEdgeClick, onPaneClick } = renderCanvas();
    graphCanvas.visible_links = [{ id: 1, _pos: [50, 60] }];

    const consumed = graphCanvas.onMouse({
      type: 'mousedown',
      button: 0,
      canvasX: 55,
      canvasY: 64
    } as unknown as MouseEvent);

    expect(consumed).toBe(true);
    expect(onEdgeClick).toHaveBeenCalledTimes(1);
    expect(onEdgeClick.mock.calls[0][1]).toEqual(
      expect.objectContaining({ id: 'edge-1' })
    );
    expect(onPaneClick).not.toHaveBeenCalled();
  });

  it('onMouse falls through to onPaneClick when the mousedown hits neither a node nor a link', () => {
    const { graphCanvas, onEdgeClick, onPaneClick } = renderCanvas();
    graphCanvas.visible_links = [{ id: 1, _pos: [500, 500] }];

    const consumed = graphCanvas.onMouse({
      type: 'mousedown',
      button: 0,
      canvasX: 10,
      canvasY: 10
    } as unknown as MouseEvent);

    expect(consumed).toBe(false);
    expect(onEdgeClick).not.toHaveBeenCalled();
    expect(onPaneClick).toHaveBeenCalledTimes(1);
  });

  it('tolerates empty/undefined visible_links on the first click before any draw', () => {
    const { graphCanvas, onEdgeClick, onPaneClick } = renderCanvas();
    graphCanvas.visible_links = undefined;

    expect(() =>
      graphCanvas.onMouse({
        type: 'mousedown',
        button: 0,
        canvasX: 10,
        canvasY: 10
      } as unknown as MouseEvent)
    ).not.toThrow();

    expect(onEdgeClick).not.toHaveBeenCalled();
    expect(onPaneClick).toHaveBeenCalledTimes(1);
  });
});
