import React from 'react';
import { render } from '@testing-library/react';
import { LGraphCanvas } from 'litegraph.js';
import QuestLiteGraphCanvas from '../src/renderer/components/QuestEditor/QuestLiteGraphCanvas';
import type { QuestGraphEdge, QuestGraphNode } from '../src/renderer/types/questGraph';

const mockGraphStart = jest.fn();
const mockSetCanvas = jest.fn();
const mockStopRendering = jest.fn();

// Mock litegraph.js so the init effect can actually run under Jest (the real library
// needs a live 2D canvas context that jsdom does not provide). Each construction is
// tracked so we can assert the canvas is built once for the component's lifetime.
jest.mock('litegraph.js', () => {
  class LGraph {
    links: Record<number, unknown> = {};
    clear = jest.fn();
    add = jest.fn();
    getNodeOnPos = jest.fn(() => null);
    start = (...args: unknown[]) => mockGraphStart(...args);
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
    addOutput = jest.fn();
    connect = jest.fn(() => ({ id: this.inputs.length + 1 }));
  }

  const LGraphCanvas = jest.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.allow_dragcanvas = false;
    this.allow_searchbox = true;
    this.bgcolor = '';
    this.visible_nodes = [];
    this.selected_nodes = {};
    this.resize = jest.fn();
    this.draw = jest.fn();
    this.setDirty = jest.fn();
    this.deselectAllNodes = jest.fn();
    this.selectNode = jest.fn();
    this.clear = jest.fn();
    this.stopRendering = mockStopRendering;
    this.setCanvas = mockSetCanvas;
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
} as QuestGraphNode);

const renderCanvas = (
  nodes: QuestGraphNode[],
  overrides: Partial<Record<string, unknown>> = {}
) => render(
  <QuestLiteGraphCanvas
    nodes={nodes}
    edges={[] as QuestGraphEdge[]}
    selectedNodeId={null}
    onNodeClick={jest.fn()}
    onNodeDoubleClick={jest.fn()}
    onEdgeClick={jest.fn()}
    onNodeMove={jest.fn()}
    onPaneClick={jest.fn()}
    {...overrides}
  />
);

describe('QuestLiteGraphCanvas lifecycle', () => {
  beforeAll(() => {
    // Defeat the init effect's jsdom bail so the mocked litegraph is actually constructed.
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
    mockGraphStart.mockClear();
    mockSetCanvas.mockClear();
    mockStopRendering.mockClear();
    LGraphCanvasMock.mockClear();
  });

  it('constructs the canvas exactly once across node/callback prop churn and never starts the exec loop', () => {
    const { rerender, unmount } = renderCanvas([makeDialogNode('A')]);

    expect(LGraphCanvasMock).toHaveBeenCalledTimes(1);

    // Change nodes and callback identities five times; new callbacks flow through
    // callbacksRef and must not tear down / recreate the canvas.
    for (let i = 0; i < 5; i += 1) {
      rerender(
        <QuestLiteGraphCanvas
          nodes={[makeDialogNode('A'), makeDialogNode(`B${i}`)]}
          edges={[] as QuestGraphEdge[]}
          selectedNodeId={null}
          onNodeClick={jest.fn()}
          onNodeDoubleClick={jest.fn()}
          onEdgeClick={jest.fn()}
          onNodeMove={jest.fn()}
          onPaneClick={jest.fn()}
        />
      );
    }

    expect(LGraphCanvasMock).toHaveBeenCalledTimes(1);
    expect(mockGraphStart).not.toHaveBeenCalled();
    expect(LGraphCanvasMock.mock.instances[0].allow_searchbox).toBe(false);

    unmount();
  });

  it('tears the canvas down on unmount via stopRendering and setCanvas(null)', () => {
    const { unmount } = renderCanvas([makeDialogNode('A')]);

    expect(mockStopRendering).not.toHaveBeenCalled();
    expect(mockSetCanvas).not.toHaveBeenCalled();

    unmount();

    expect(mockStopRendering).toHaveBeenCalledTimes(1);
    expect(mockSetCanvas).toHaveBeenCalledWith(null);
  });
});
