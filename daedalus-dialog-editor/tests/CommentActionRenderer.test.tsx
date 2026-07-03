import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CommentActionRenderer from '../src/renderer/components/actionRenderers/CommentActionRenderer';
import ActionsList from '../src/renderer/components/ActionsList';
import { getRendererForAction, getActionTypeLabel } from '../src/renderer/components/actionRenderers';
import { getActionType } from '../src/renderer/components/actionTypes';

const baseProps = {
  path: [0],
  index: 0,
  totalActions: 1,
  npcName: 'TestNPC',
  handleUpdate: jest.fn(),
  handleDelete: jest.fn(),
  flushUpdate: jest.fn(),
  handleKeyDown: jest.fn(),
  mainFieldRef: { current: null },
  semanticModel: {} as any
};

describe('CommentActionRenderer (parser fix P6: standalone comments preserved as CommentAction)', () => {
  const commentAction = { type: 'CommentAction' as const, text: '// standalone note about the routine below' };

  test('renders the comment text', () => {
    render(<CommentActionRenderer {...baseProps} action={commentAction} />);
    expect(screen.getByLabelText('Comment')).toHaveValue('// standalone note about the routine below');
  });

  test('is read-only: typing into the field does not attempt a structural edit', () => {
    render(<CommentActionRenderer {...baseProps} action={commentAction} />);
    const field = screen.getByLabelText('Comment') as HTMLInputElement;
    expect(field).toHaveAttribute('readonly');
  });

  test('delete button still calls handleDelete (comments can be removed like any action)', () => {
    const handleDelete = jest.fn();
    render(<CommentActionRenderer {...baseProps} action={commentAction} handleDelete={handleDelete} />);
    fireEvent.click(screen.getByLabelText('Delete comment'));
    expect(handleDelete).toHaveBeenCalled();
  });

  test('does not crash when text is missing', () => {
    const bareComment = { type: 'CommentAction' as const, text: '' };
    render(<CommentActionRenderer {...baseProps} action={bareComment} />);
    expect(screen.getByLabelText('Comment')).toHaveValue('');
  });
});

describe('CommentAction dispatch (getActionType / registry)', () => {
  test('is recognized as its own action type, not routed to the generic/custom renderer', () => {
    const action = { type: 'CommentAction', text: '// note' };
    expect(getActionType(action)).toBe('commentAction');
    expect(getRendererForAction(action)).toBe(CommentActionRenderer);
    expect(getActionTypeLabel(action)).toBe('Comment');
  });
});

describe('CommentAction inside an action list', () => {
  test('an action list containing a CommentAction renders it without crashing, alongside other actions', () => {
    const actions = [
      { type: 'DialogLine', speaker: 'self', text: 'Hello', id: 'DIA_Test_00' },
      { type: 'CommentAction', text: '// a note between two lines' },
      { type: 'DialogLine', speaker: 'other', text: 'Hi', id: 'DIA_Test_01' }
    ] as any;

    render(
      <ActionsList
        actions={actions}
        npcName="TestNPC"
        updateActionAtPath={jest.fn()}
        deleteActionAtPath={jest.fn()}
        focusActionAtPath={jest.fn()}
        addDialogLineAfterPath={jest.fn()}
        deleteActionAndFocusPrevAtPath={jest.fn()}
        addActionAfterPath={jest.fn()}
        registerActionRef={jest.fn()}
        getVisibleActionPaths={() => []}
        dialogContextName="TestDialog"
      />
    );

    expect(screen.getByDisplayValue('// a note between two lines')).toBeInTheDocument();
  });
});
