import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CommentActionRenderer from '../src/renderer/components/actionRenderers/CommentActionRenderer';
import ActionsList from '../src/renderer/components/ActionsList';
import { getRendererForAction, getActionTypeLabel } from '../src/renderer/components/actionRenderers';
import { getActionType } from '../src/renderer/components/actionTypes';
import { createAction } from '../src/renderer/components/actionFactory';
import { CodeGeneratorService } from '../src/main/services/CodeGeneratorService';
import type { CommentActionType } from '../src/renderer/types/global';

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

  test('renders the note body, not the // marker (the marker is the generator\'s)', () => {
    render(<CommentActionRenderer {...baseProps} action={commentAction} />);
    expect(screen.getByLabelText('Comment')).toHaveValue('standalone note about the routine below');
  });

  test('is editable: typing writes the text back as a // comment (#430)', () => {
    const handleUpdate = jest.fn();
    render(
      <CommentActionRenderer
        {...baseProps}
        action={{ type: 'CommentAction' as const, text: '// ' }}
        handleUpdate={handleUpdate}
      />
    );
    const field = screen.getByLabelText('Comment') as HTMLInputElement;
    expect(field).not.toHaveAttribute('readonly');
    fireEvent.change(field, { target: { value: 'create the variable for this condition' } });
    expect(handleUpdate).toHaveBeenCalledWith({
      type: 'CommentAction',
      text: '// create the variable for this condition'
    });
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

describe('an added note (#430)', () => {
  test('the factory creates an empty comment whose marker keeps it in the file', () => {
    const note = createAction('commentAction') as CommentActionType;
    expect(note).toMatchObject({ type: 'CommentAction', text: '// ' });
    expect(getActionType(note)).toBe('commentAction');
  });

  test('the editor\'s save path writes an added and edited note as a comment line', () => {
    const note = { ...(createAction('commentAction') as CommentActionType), text: '// TODO: create the variable' };
    const code = new CodeGeneratorService().generateCode(
      {
        functions: {
          DIA_Note_Info: { name: 'DIA_Note_Info', returnType: 'void', calls: [], actions: [note] }
        },
        dialogs: {}
      },
      { indentChar: '\t' as const, includeComments: true, sectionHeaders: false, uppercaseKeywords: true }
    );
    expect(code).toContain('\n\t// TODO: create the variable\n');
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

    expect(screen.getByDisplayValue('a note between two lines')).toBeInTheDocument();
  });
});
