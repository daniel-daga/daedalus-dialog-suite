import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChoiceRenderer from '../src/renderer/components/actionRenderers/ChoiceRenderer';

// Mock InlineChoiceEditor to avoid deep dependency chain. Expose the
// focus-request nonce so tests can assert the dive-into-sub-editor wiring.
jest.mock('../src/renderer/components/InlineChoiceEditor', () => ({
  __esModule: true,
  default: ({ targetFunctionName, focusFirstActionNonce }: any) => (
    <div data-testid="inline-editor" data-focus-nonce={focusFirstActionNonce ?? 0}>
      {targetFunctionName}
    </div>
  )
}));

jest.mock('../src/renderer/store/editorStore', () => ({
  useEditorStore: (selector: any) => {
    const state = {
      updateFunction: jest.fn(),
      updateFunctionWithUpdater: jest.fn(),
      renameFunction: jest.fn(),
    };
    return selector(state);
  }
}));

const choiceAction = {
  type: 'choice' as const,
  text: 'Go left',
  targetFunction: 'DIA_Test_GoLeft',
  dialogRef: 'DIA_Test',
};

const semanticModel = {
  dialogs: {},
  functions: {
    DIA_Test_GoLeft: {
      name: 'DIA_Test_GoLeft',
      returnType: 'VOID',
      actions: [
        { type: 'DialogLine', speaker: 'self', text: 'You went left', id: 'DIA_Test_GoLeft_self_0_0' },
      ],
      conditions: [],
      calls: [],
    },
  },
  hasErrors: false,
  errors: [],
};

describe('ChoiceRenderer expand/collapse', () => {
  const baseProps = {
    action: choiceAction,
    path: [0] as any,
    index: 0,
    totalActions: 1,
    npcName: 'TestNPC',
    handleUpdate: jest.fn(),
    handleDelete: jest.fn(),
    flushUpdate: jest.fn(),
    handleKeyDown: jest.fn(),
    mainFieldRef: { current: null },
    semanticModel: semanticModel as any,
    onNavigateToFunction: jest.fn(),
    onRenameFunction: jest.fn(),
    dialogContextName: 'DIA_Test',
    filePath: '/test/file.d',
  };

  test('shows expand button when target function exists', () => {
    render(<ChoiceRenderer {...baseProps} />);
    expect(screen.getByLabelText('Expand choice actions')).toBeInTheDocument();
  });

  test('does not show expand button when target function is missing', () => {
    const propsNoFunc = {
      ...baseProps,
      semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any,
    };
    render(<ChoiceRenderer {...propsNoFunc} />);
    expect(screen.queryByLabelText('Expand choice actions')).not.toBeInTheDocument();
  });

  test('expands to show inline editor on click', () => {
    render(<ChoiceRenderer {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Expand choice actions'));
    expect(screen.getByTestId('inline-editor')).toHaveTextContent('DIA_Test_GoLeft');
  });

  test('collapses inline editor on second click', async () => {
    render(<ChoiceRenderer {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Expand choice actions'));
    expect(screen.getByTestId('inline-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Collapse choice actions'));
    await waitFor(() => {
      expect(screen.queryByTestId('inline-editor')).not.toBeInTheDocument();
    });
  });

  describe('Tab dives into the choice sub-editor (issue #118)', () => {
    beforeEach(() => {
      baseProps.handleKeyDown.mockClear();
    });

    test('Tab on the Choice Text field expands the sub-editor instead of leaving the row', () => {
      render(<ChoiceRenderer {...baseProps} />);
      const choiceText = screen.getByLabelText('Choice Text');
      choiceText.focus();
      fireEvent.keyDown(choiceText, { key: 'Tab' });

      expect(screen.getByTestId('inline-editor')).toHaveTextContent('DIA_Test_GoLeft');
      // Forward Tab is consumed here, not delegated to card-to-card navigation.
      expect(baseProps.handleKeyDown).not.toHaveBeenCalled();
    });

    test('Tab on the Choice Text field requests focus into the sub-editor', () => {
      render(<ChoiceRenderer {...baseProps} />);
      const choiceText = screen.getByLabelText('Choice Text');
      fireEvent.keyDown(choiceText, { key: 'Tab' });

      const nonce = Number(screen.getByTestId('inline-editor').getAttribute('data-focus-nonce'));
      expect(nonce).toBeGreaterThan(0);
    });

    test('mouse-expanding the sub-editor never requests inner focus', () => {
      render(<ChoiceRenderer {...baseProps} />);
      fireEvent.click(screen.getByLabelText('Expand choice actions'));

      const nonce = Number(screen.getByTestId('inline-editor').getAttribute('data-focus-nonce'));
      expect(nonce).toBe(0);
    });

    test('Shift+Tab on the Choice Text field is left to card navigation', () => {
      render(<ChoiceRenderer {...baseProps} />);
      const choiceText = screen.getByLabelText('Choice Text');
      fireEvent.keyDown(choiceText, { key: 'Tab', shiftKey: true });

      expect(screen.queryByTestId('inline-editor')).not.toBeInTheDocument();
      expect(baseProps.handleKeyDown).toHaveBeenCalled();
    });

    test('Tab falls back to card navigation when the target function does not exist yet', () => {
      const propsNoFunc = {
        ...baseProps,
        semanticModel: { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as any,
      };
      render(<ChoiceRenderer {...propsNoFunc} />);
      const choiceText = screen.getByLabelText('Choice Text');
      fireEvent.keyDown(choiceText, { key: 'Tab' });

      expect(screen.queryByTestId('inline-editor')).not.toBeInTheDocument();
      expect(baseProps.handleKeyDown).toHaveBeenCalled();
    });
  });
});
