import React from 'react';
import { render, screen } from '@testing-library/react';
import ActionsList from '../src/renderer/components/ActionsList';
import '@testing-library/jest-dom';

// Mock ActionCard to observe props
jest.mock('../src/renderer/components/ActionCard', () => {
  return React.forwardRef((props: any, _ref) => {
    return (
      <div data-testid="action-card">
        <button onClick={() => props.onRenameFunction('old', 'new')}>
          Rename
        </button>
      </div>
    );
  });
});

describe('ActionsList draggable identity (U5 keys)', () => {
  const baseProps = {
    npcName: 'NPC',
    updateActionAtPath: jest.fn(),
    deleteActionAtPath: jest.fn(),
    focusActionAtPath: jest.fn(),
    addDialogLineAfterPath: jest.fn(),
    deleteActionAndFocusPrevAtPath: jest.fn(),
    addActionAfterPath: jest.fn(),
    addActionToBranchEnd: jest.fn(),
    moveAction: jest.fn(),
    registerActionRef: jest.fn(),
    getVisibleActionPaths: () => [],
    dialogContextName: 'DIA_Test',
  } as any;

  const draggableIds = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll('[data-rfd-draggable-id]')).map(
      (el) => el.getAttribute('data-rfd-draggable-id') as string
    );

  test('gives duplicate DialogLine ids unique draggableIds and emits no duplicate-key warning', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const actions = [
      { type: 'DialogLine', id: 'AI_Output', text: 'a', speaker: 'Hero' },
      { type: 'DialogLine', id: 'AI_Output', text: 'b', speaker: 'Hero' },
      { type: 'DialogLine', id: 'AI_Output', text: 'c', speaker: 'Hero' },
    ];

    const { container } = render(<ActionsList {...baseProps} actions={actions} />);

    const ids = draggableIds(container);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // all unique despite identical action.id

    const duplicateKeyWarning = errorSpy.mock.calls.some((call) =>
      String(call[0]).includes('same key')
    );
    expect(duplicateKeyWarning).toBe(false);

    errorSpy.mockRestore();
  });

  test('non-DialogLine actions get id-based draggableIds that survive a deletion above', () => {
    // 0.1: non-DialogLine actions carry a stable `id` (the factory already
    // stamps one; ensureActionIds fills it in for loaded actions). Their
    // identity must derive from that id, not the list index — otherwise
    // deleting a card above reindexes the identity, React reuses the wrong
    // ActionCard instance, and a pending debounce edit is discarded.
    const setVarA = { type: 'SetVariableAction', id: 'action_aaa', variableName: 'X', operator: '=', value: 1 };
    const setVarB = { type: 'SetVariableAction', id: 'action_bbb', variableName: 'Y', operator: '=', value: 2 };

    const { container, rerender } = render(<ActionsList {...baseProps} actions={[setVarA, setVarB]} />);
    const before = draggableIds(container);
    expect(before).toHaveLength(2);
    expect(before[1]).toContain('action_bbb');

    // Delete the action above (A); B shifts from index 1 to index 0.
    rerender(<ActionsList {...baseProps} actions={[setVarB]} />);
    const after = draggableIds(container);

    expect(after).toHaveLength(1);
    // B keeps the SAME draggableId despite the index shift.
    expect(after[0]).toBe(before[1]);
  });

  test('keeps draggableIds stable across an unrelated re-render', () => {
    const actions = [
      { type: 'DialogLine', id: 'AI_Output', text: 'a', speaker: 'Hero' },
      { type: 'DialogLine', id: 'AI_Output', text: 'b', speaker: 'Hero' },
    ];

    const { container, rerender } = render(<ActionsList {...baseProps} actions={actions} />);
    const before = draggableIds(container);

    // Re-render with a new npcName (unrelated) but the same actions reference.
    rerender(<ActionsList {...baseProps} npcName="OTHER" actions={actions} />);
    const after = draggableIds(container);

    expect(after).toEqual(before);
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
