import React from 'react';
import { render, screen } from '@testing-library/react';
import ActionsList from '../src/renderer/components/ActionsList';
import '@testing-library/jest-dom';

// Mock ActionCard to observe props
jest.mock('../src/renderer/components/ActionCard', () => {
  return React.forwardRef((props: any, ref) => {
    return (
      <div data-testid="action-card">
        <button onClick={() => props.onRenameFunction('old', 'new')}>
          Rename
        </button>
      </div>
    );
  });
});

describe('ActionsList Memoization', () => {
  const mockActionRefs = { current: [] };
  const defaultProps = {
    actions: [{ id: '1', type: 'dialogLine' }],
    actionRefs: mockActionRefs,
    npcName: 'TestNPC',
    updateAction: jest.fn(),
    deleteAction: jest.fn(),
    focusAction: jest.fn(),
    addDialogLineAfter: jest.fn(),
    deleteActionAndFocusPrev: jest.fn(),
    addActionAfter: jest.fn(),
    dialogContextName: 'TestDialog',
  };

  test('should re-render when semanticModel changes', () => {
    const onRenameFunction1 = jest.fn();
    const semanticModel1 = { id: 1 };

    const { rerender } = render(
      <ActionsList
        {...defaultProps}
        semanticModel={semanticModel1}
        onRenameFunction={onRenameFunction1}
      />
    );

    // Initial render
    expect(screen.getByTestId('action-card')).toBeInTheDocument();

    // Trigger rename
    screen.getByRole('button', { name: 'Rename' }).click();
    expect(onRenameFunction1).toHaveBeenCalled();

    // Update semanticModel and onRenameFunction (simulating parent re-render)
    const onRenameFunction2 = jest.fn();
    const semanticModel2 = { id: 2 }; // New reference

    rerender(
      <ActionsList
        {...defaultProps}
        semanticModel={semanticModel2}
        onRenameFunction={onRenameFunction2}
      />
    );

    // Trigger rename again - should call NEW function if re-rendered
    screen.getByRole('button', { name: 'Rename' }).click();

    // If ActionsList didn't re-render, it would still use onRenameFunction1
    expect(onRenameFunction2).toHaveBeenCalled();
  });

  test('should re-render when onRenameFunction changes', () => {
    const onRenameFunction1 = jest.fn();

    const { rerender } = render(
      <ActionsList
        {...defaultProps}
        onRenameFunction={onRenameFunction1}
      />
    );

    // Trigger rename
    screen.getByRole('button', { name: 'Rename' }).click();
    expect(onRenameFunction1).toHaveBeenCalled();

    // Update onRenameFunction only
    const onRenameFunction2 = jest.fn();

    rerender(
      <ActionsList
        {...defaultProps}
        onRenameFunction={onRenameFunction2}
      />
    );

    // Trigger rename again
    screen.getByRole('button', { name: 'Rename' }).click();
    expect(onRenameFunction2).toHaveBeenCalled();
  });
});
