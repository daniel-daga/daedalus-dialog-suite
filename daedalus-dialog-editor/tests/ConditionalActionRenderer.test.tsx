import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConditionalActionRenderer from '../src/renderer/components/actionRenderers/ConditionalActionRenderer';

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
});
