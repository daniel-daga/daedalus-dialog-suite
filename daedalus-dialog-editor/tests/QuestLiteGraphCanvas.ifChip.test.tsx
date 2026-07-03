import React from 'react';
import { render } from '@testing-library/react';
import QuestLiteGraphCanvas from '../src/renderer/components/QuestEditor/QuestLiteGraphCanvas';
import type { QuestGraphEdge, QuestGraphNode } from '../src/renderer/types/questGraph';

// Track every runtime LGraphNode the component constructs so the dialog node's
// IF-chip onMouseDown hit test can be exercised directly (Q2 selection affordance).
const mockNodeState: { nodes: Array<Record<string, any>> } = { nodes: [] };

// Mock litegraph.js so the init effect runs under Jest (the real library needs a live
// 2D canvas context jsdom lacks). Dialog runtime nodes get onMouseDown assigned by the
// component; the mock registers each instance so the test can locate it.
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
      mockNodeState.nodes.push(this as unknown as Record<string, any>);
    }
    addInput = jest.fn(function (this: LGraphNode, name: string) {
      this.inputs.push({ name });
    });
    addOutput = jest.fn();
    connect = jest.fn(() => ({ id: 1 }));
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

const originalUserAgent = window.navigator.userAgent;

const makeDialogNode = (id: string): QuestGraphNode => ({
  id,
  type: 'dialog',
  position: { x: 10, y: 20 },
  data: {
    label: id,
    npc: 'NPC_Test',
    kind: 'dialog',
    conditionExpression: 'MIS_TEST == LOG_RUNNING',
    conditionCount: 1
  }
} as unknown as QuestGraphNode);

describe('QuestLiteGraphCanvas IF-chip hit test (Q2)', () => {
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
    mockNodeState.nodes = [];
  });

  const renderCanvas = () => {
    const onNodeClick = jest.fn();
    render(
      <QuestLiteGraphCanvas
        nodes={[makeDialogNode('DIA_A')]}
        edges={[] as QuestGraphEdge[]}
        selectedNodeId={null}
        selectedEdgeId={null}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={jest.fn()}
        onEdgeClick={jest.fn()}
        onNodeMove={jest.fn()}
        onPaneClick={jest.fn()}
      />
    );
    const dialogRuntimeNode = mockNodeState.nodes.find(
      (node) => typeof node.onMouseDown === 'function'
    );
    return { onNodeClick, dialogRuntimeNode };
  };

  it('selects the quest node and blocks drag when the click is inside the IF panel rect', () => {
    const { onNodeClick, dialogRuntimeNode } = renderCanvas();
    expect(dialogRuntimeNode).toBeDefined();

    // conditionCount 1 → 1 input → panelY 52, panelHeight 40, panelX 10, width 200.
    const consumed = dialogRuntimeNode!.onMouseDown({} as MouseEvent, [50, 60]);

    expect(consumed).toBe(true);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0][1]).toEqual(expect.objectContaining({ id: 'DIA_A' }));
  });

  it('does not select or block when the click is outside the IF panel rect', () => {
    const { onNodeClick, dialogRuntimeNode } = renderCanvas();
    expect(dialogRuntimeNode).toBeDefined();

    const consumed = dialogRuntimeNode!.onMouseDown({} as MouseEvent, [5, 5]);

    expect(consumed).toBe(false);
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});
