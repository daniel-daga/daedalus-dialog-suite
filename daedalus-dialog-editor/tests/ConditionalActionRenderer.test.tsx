import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConditionalActionRenderer from '../src/renderer/components/actionRenderers/ConditionalActionRenderer';
import { ACTION_TEMPLATES } from '../src/renderer/components/actionTemplates';

jest.mock('../src/renderer/components/ActionsList', () => ({
  __esModule: true,
  default: ({ actions, pathPrefix }: any) => (
    <div data-testid={`actions-list-${pathPrefix.join('-')}`}>{actions.length}</div>
  )
}));

describe('ConditionalActionRenderer', () => {
  const baseProps = {
    action: {
      type: 'ConditionalAction',
      condition: 'Wld_GetDay() == 0',
      thenActions: [
        { type: 'DialogLine', speaker: 'self', text: 'then', id: 'DIA_Test_08_00' }
      ],
      elseActions: []
    } as any,
    path: [1],
    npcName: 'Edda',
    totalActions: 2,
    handleUpdate: jest.fn(),
    handleDelete: jest.fn(),
    flushUpdate: jest.fn(),
    handleKeyDown: jest.fn(),
    mainFieldRef: { current: null },
    updateActionAtPath: jest.fn(),
    deleteActionAtPath: jest.fn(),
    focusActionAtPath: jest.fn(),
    addDialogLineAfterPath: jest.fn(),
    deleteActionAndFocusPrevAtPath: jest.fn(),
    addActionAfterPath: jest.fn(),
    registerActionRef: jest.fn(),
    getVisibleActionPaths: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders condition field and both nested action lists', () => {
    render(<ConditionalActionRenderer {...baseProps} />);

    expect(screen.getByLabelText('Condition')).toHaveValue('Wld_GetDay() == 0');
    expect(screen.getByTestId('actions-list-1-then')).toHaveTextContent('1');
    expect(screen.getByTestId('actions-list-1-else')).toHaveTextContent('0');
  });

  test('updates condition text through handleUpdate', () => {
    render(<ConditionalActionRenderer {...baseProps} />);

    fireEvent.change(screen.getByLabelText('Condition'), {
      target: { value: 'Npc_KnowsInfo(other, DIA_Test)' }
    });

    expect(baseProps.handleUpdate).toHaveBeenCalledWith({
      ...baseProps.action,
      condition: 'Npc_KnowsInfo(other, DIA_Test)'
    });
  });

  const insertTemplate = (condition: string) => {
    const action = { ...baseProps.action, condition };
    render(<ConditionalActionRenderer {...baseProps} action={action} />);
    fireEvent.click(screen.getByLabelText('Insert condition template'));
    fireEvent.click(screen.getByText('NPC Knows Dialog'));
    return action;
  };

  test('appends an "and" to a condition that has no top-level ||', () => {
    const action = insertTemplate('Wld_GetDay() == 0');

    expect(baseProps.handleUpdate).toHaveBeenCalledWith({
      ...action,
      condition: 'Wld_GetDay() == 0 && Npc_KnowsInfo(other, DIA_)'
    });
  });

  test('parenthesises a top-level || so the template really adds a requirement', () => {
    const action = insertTemplate('A() || B()');

    expect(baseProps.handleUpdate).toHaveBeenCalledWith({
      ...action,
      condition: '(A() || B()) && Npc_KnowsInfo(other, DIA_)'
    });
  });

  const chainedConditional = {
    type: 'ConditionalAction',
    condition: 'Wld_GetDay() == 1',
    thenActions: [],
    elseActions: []
  } as any;

  test('presents a lone else-if in Else as the chain, not as an Else card', () => {
    render(
      <ConditionalActionRenderer
        {...baseProps}
        action={{ ...baseProps.action, elseActions: [{ ...chainedConditional, elseIf: true }] }}
      />
    );

    expect(screen.getByText('Else If')).toBeInTheDocument();
    expect(screen.queryByText('Else')).not.toBeInTheDocument();
  });

  test('turns an empty Else into the next else if', () => {
    render(<ConditionalActionRenderer {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /else if/i }));

    expect(baseProps.handleUpdate).toHaveBeenCalledWith({
      ...baseProps.action,
      elseActions: [{ ...ACTION_TEMPLATES.conditionalAction(), elseIf: true }]
    });
  });

  test('turns an Else holding one conditional into the next else if', () => {
    const action = { ...baseProps.action, elseActions: [chainedConditional] };
    render(<ConditionalActionRenderer {...baseProps} action={action} />);

    // Until the user converts it, it stays a nested card in the Else branch.
    expect(screen.getByText('Else')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /else if/i }));

    expect(baseProps.handleUpdate).toHaveBeenCalledWith({
      ...action,
      elseActions: [{ ...chainedConditional, elseIf: true }]
    });
  });

  test('offers no else if when Else holds anything but one conditional', () => {
    render(
      <ConditionalActionRenderer
        {...baseProps}
        action={{ ...baseProps.action, elseActions: [{ type: 'DialogLine', speaker: 'self', text: 'x', id: 'DIA_Test_00' } as any] }}
      />
    );

    expect(screen.queryByRole('button', { name: /else if/i })).not.toBeInTheDocument();
  });
});
