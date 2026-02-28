import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import QuestInspectorPanel from '../src/renderer/components/QuestEditor/Inspector/QuestInspectorPanel';
import type { QuestGraphEdge } from '../src/renderer/types/questGraph';

const createRequiresEdge = (expression: string): QuestGraphEdge => ({
  id: 'edge-1',
  source: 'DIA_Source_Info',
  target: 'DIA_Target_Info',
  sourceHandle: 'out-state',
  targetHandle: 'in-trigger',
  type: 'smoothstep',
  data: {
    kind: 'requires',
    expression
  }
});


const createConditionNode = () => ({
  id: 'condition-node-1',
  position: { x: 0, y: 0 },
  data: {
    kind: 'condition' as const,
    label: 'Variable Condition',
    npc: 'External/World',
    expression: 'MIS_TEST == LOG_RUNNING',
    conditionIndex: 0,
    condition: {
      type: 'VariableCondition' as const,
      variableName: 'MIS_TEST',
      value: 'LOG_RUNNING',
      operator: '==',
      negated: false
    },
    provenance: {
      functionName: 'DIA_Target_Info'
    }
  },
  type: 'condition' as const
});

const baseProps = {
  questName: 'TOPIC_TEST',
  writableEnabled: true,
  selectedNode: null,
  onSetMisState: jest.fn(),
  onAddTopicStatus: jest.fn(),
  onAddLogEntry: jest.fn(),
  onRemoveTransition: jest.fn(),
  onUpdateTransitionText: jest.fn(),
  onRemoveConditionLink: jest.fn(),
  onUpdateConditionLink: jest.fn(),
  commandError: null,
  commandBusy: false
};

describe('QuestInspectorPanel requires edge editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows read-only message for unsupported requires expressions', () => {
    render(
      <QuestInspectorPanel
        {...baseProps}
        selectedEdge={createRequiresEdge('Npc_KnowsInfo(self, DIA_TEST)')}
      />
    );

    expect(
      screen.getByText('This condition link is read-only because it is not a simple `VARIABLE == VALUE` or `VARIABLE != VALUE` expression.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Variable')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove Condition Link')).not.toBeInTheDocument();
  });

  it('allows editing simple variable equality requires expressions', () => {
    render(
      <QuestInspectorPanel
        {...baseProps}
        selectedEdge={createRequiresEdge('MIS_TEST == LOG_RUNNING')}
      />
    );

    const variableField = screen.getByLabelText('Variable');
    const valueField = screen.getByLabelText('Value');
    fireEvent.change(variableField, { target: { value: 'MIS_TEST' } });
    fireEvent.change(valueField, { target: { value: 'LOG_SUCCESS' } });
    fireEvent.click(screen.getByText('Preview Diff'));

    expect(baseProps.onUpdateConditionLink).toHaveBeenCalledWith({
      targetFunctionName: 'DIA_Target_Info',
      oldVariableName: 'MIS_TEST',
      oldValue: 'LOG_RUNNING',
      variableName: 'MIS_TEST',
      value: 'LOG_SUCCESS',
      operator: '=='
    });
  });

  it('allows editing simple variable inequality requires expressions', () => {
    render(
      <QuestInspectorPanel
        {...baseProps}
        selectedEdge={createRequiresEdge('MIS_TEST != LOG_FAILED')}
      />
    );

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'LOG_SUCCESS' } });
    fireEvent.click(screen.getByText('Preview Diff'));

    expect(baseProps.onUpdateConditionLink).toHaveBeenCalledWith({
      targetFunctionName: 'DIA_Target_Info',
      oldVariableName: 'MIS_TEST',
      oldValue: 'LOG_FAILED',
      variableName: 'MIS_TEST',
      value: 'LOG_SUCCESS',
      operator: '!='
    });
  });


  it('edits variable condition node fields with autocomplete-backed variable input', () => {
    render(
      <QuestInspectorPanel
        {...baseProps}
        selectedNode={createConditionNode()}
        selectedEdge={null}
        semanticModel={{
          dialogs: {},
          functions: {},
          constants: {},
          variables: {
            MIS_TEST: { name: 'MIS_TEST', type: 'int' }
          },
          instances: {},
          hasErrors: false,
          errors: []
        }}
      />
    );

    expect(screen.getByLabelText('Variable Name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'LOG_SUCCESS' } });
    fireEvent.click(screen.getAllByText('Preview Diff')[0]);

    expect(baseProps.onUpdateConditionLink).toHaveBeenCalledWith({
      targetFunctionName: 'DIA_Target_Info',
      conditionIndex: 0,
      oldVariableName: 'MIS_TEST',
      oldValue: 'LOG_RUNNING',
      variableName: 'MIS_TEST',
      value: 'LOG_SUCCESS',
      operator: '==',
      negated: false
    });
  });
  it('shows read-only message for range requires expressions', () => {
    render(
      <QuestInspectorPanel
        {...baseProps}
        selectedEdge={createRequiresEdge('MIS_TEST >= 2')}
      />
    );

    expect(
      screen.getByText('This condition link is read-only because it is not a simple `VARIABLE == VALUE` or `VARIABLE != VALUE` expression.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Operator')).not.toBeInTheDocument();
  });
});
