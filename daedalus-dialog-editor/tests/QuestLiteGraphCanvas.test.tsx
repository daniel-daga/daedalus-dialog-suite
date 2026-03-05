import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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


const createConditionNode = (overrides: Partial<QuestGraphNode> = {}): QuestGraphNode => ({
  id: 'condition-DIA_Target_Info-dia_target_info-0-mis_test_1',
  type: 'condition',
  position: { x: 120, y: 90 },
  data: {
    label: 'Variable',
    npc: 'External/World',
    kind: 'condition',
    conditionType: 'VariableCondition',
    expression: 'MIS_TEST == 1'
  },
  ...overrides
} as QuestGraphNode);

const renderCanvas = ({
  nodes = [createDialogNode()],
  edges = [] as QuestGraphEdge[],
  onSetConditionExpression = jest.fn()
}: {
  nodes?: QuestGraphNode[];
  edges?: QuestGraphEdge[];
  onSetConditionExpression?: (payload: { nodeId: string; expression: string }) => void;
} = {}) => {
  render(
    <QuestLiteGraphCanvas
      nodes={nodes}
      edges={edges}
      selectedNodeId={null}
      onNodeClick={jest.fn()}
      onNodeDoubleClick={jest.fn()}
      onEdgeClick={jest.fn()}
      onNodeMove={jest.fn()}
      onPaneClick={jest.fn()}
      onSetConditionExpression={onSetConditionExpression}
    />
  );

  return { onSetConditionExpression };
};

describe('QuestLiteGraphCanvas condition expression capsule', () => {
  it('shows inline body content on condition nodes', () => {
    renderCanvas({ nodes: [createConditionNode()] });

    const body = screen.getByTestId('condition-readonly-body-condition-DIA_Target_Info-dia_target_info-0-mis_test_1');
    expect(within(body).getByText('Condition')).toBeInTheDocument();
    expect(within(body).getByText('MIS_TEST == 1')).toBeInTheDocument();
  });

  it('shows inline condition body content without opening edit mode', () => {
    renderCanvas();

    const body = screen.getByTestId('condition-inline-body-DIA_Target_Info');
    expect(within(body).getByText('Condition')).toBeInTheDocument();
    expect(within(body).getByText(/MIS_TEST == LOG_RUNNING/i)).toBeInTheDocument();
  });

  it('renders IF capsule for dialog nodes with condition expression metadata', () => {
    renderCanvas();

    expect(screen.getByRole('button', { name: /if:/i })).toBeInTheDocument();
  });

  it('opens inline node editor and submits edited expression through callback', () => {
    const { onSetConditionExpression } = renderCanvas();

    fireEvent.click(screen.getByRole('button', { name: /if:/i }));
    expect(screen.getByTestId('condition-inline-editor')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Condition expression'), {
      target: { value: 'MIS_TEST == LOG_SUCCESS' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Expression' }));

    expect(onSetConditionExpression).toHaveBeenCalledWith({
      nodeId: 'DIA_Target_Info',
      expression: 'MIS_TEST == LOG_SUCCESS'
    });
  });
});




describe('formatRuntimeNodeTitle', () => {
  it('does not duplicate condition type when label already matches', () => {
    expect(formatRuntimeNodeTitle('Variable', 'Variable')).toBe('Variable');
  });

  it('adds condition type suffix when label differs', () => {
    expect(formatRuntimeNodeTitle('Quest Flag', 'Variable')).toBe('Quest Flag (Variable)');
  });
});
