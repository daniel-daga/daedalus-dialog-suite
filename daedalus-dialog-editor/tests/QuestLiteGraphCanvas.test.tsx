import React from 'react';
import { render } from '@testing-library/react';
import QuestLiteGraphCanvas, { formatRuntimeNodeTitle } from '../src/renderer/components/QuestEditor/QuestLiteGraphCanvas';
import type { QuestGraphEdge, QuestGraphNode } from '../src/renderer/types/questGraph';

const createDialogNode = (overrides: Partial<QuestGraphNode> = {}): QuestGraphNode => ({
  id: 'DIA_Target_Info',
  type: 'dialog',
  position: { x: 120, y: 90 },
  data: {
    label: 'DIA_Target',
    npc: 'NPC_Target',
    kind: 'dialog',
    conditionExpression: 'MIS_TEST == LOG_RUNNING && Npc_KnowsInfo(self, DIA_Test)',
    conditionCount: 2,
    conditionMode: 'structured'
  },
  ...overrides
} as QuestGraphNode);

const renderCanvas = ({
  nodes = [createDialogNode()],
  edges = [] as QuestGraphEdge[]
}: {
  nodes?: QuestGraphNode[];
  edges?: QuestGraphEdge[];
} = {}) => render(
  <QuestLiteGraphCanvas
    nodes={nodes}
    edges={edges}
    selectedNodeId={null}
    onNodeClick={jest.fn()}
    onNodeDoubleClick={jest.fn()}
    onEdgeClick={jest.fn()}
    onNodeMove={jest.fn()}
    onPaneClick={jest.fn()}
  />
);

describe('QuestLiteGraphCanvas', () => {
  it('renders the litegraph canvas element without any DOM overlays', () => {
    const { container } = renderCanvas();

    // The IF preview and condition body are painted onto the canvas (production path);
    // the former jsdom-only DOM overlays and IF button must no longer exist.
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(container.querySelector('[data-testid^="condition-inline-body"]')).toBeNull();
    expect(container.querySelector('[data-testid^="condition-readonly-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="condition-inline-editor"]')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('formatRuntimeNodeTitle', () => {
  it('does not duplicate condition type when label already matches', () => {
    expect(formatRuntimeNodeTitle('Variable', 'Variable')).toBe('Variable');
  });

  it('keeps condition node titles free of type suffixes', () => {
    expect(formatRuntimeNodeTitle('Quest Flag', 'Variable')).toBe('Quest Flag');
  });
});
