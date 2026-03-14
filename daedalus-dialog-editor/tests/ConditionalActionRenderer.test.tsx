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
});
