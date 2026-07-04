import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChoiceRenderer from '../src/renderer/components/actionRenderers/ChoiceRenderer';
import { useFileStore } from '../src/renderer/store/fileStore';
import { useProjectStore } from '../src/renderer/store/projectStore';

// Mock InlineChoiceEditor to avoid deep dependency chain. Expose the
// focus-request nonce so tests can assert the dive-into-sub-editor wiring, and a
// button that invokes onEscapeBackward so the Shift+Tab-out wiring is testable.
jest.mock('../src/renderer/components/InlineChoiceEditor', () => ({
  __esModule: true,
  default: ({ targetFunctionName, focusFirstActionNonce, onEscapeBackward }: any) => (
    <div data-testid="inline-editor" data-focus-nonce={focusFirstActionNonce ?? 0}>
      {targetFunctionName}
      <button data-testid="invoke-escape-backward" onClick={() => onEscapeBackward?.()}>
        escape
      </button>
    </div>
  )
}));

const filePath = '/test/file.d';

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

// ChoiceRenderer now resolves its target function from the store (fix-07 §2.8),
// so tests set the edited file's model there instead of threading a prop.
const setFileModel = (model: unknown) => {
  useFileStore.setState({
    openFiles: new Map([[filePath, { filePath, semanticModel: model } as never]]),
    activeFile: filePath,
  } as never);
};

describe('ChoiceRenderer expand/collapse', () => {
  beforeEach(() => {
    useProjectStore.setState({
      mergedSemanticModel: { dialogs: {}, functions: {}, constants: {}, variables: {}, instances: {}, hasErrors: false, errors: [] },
    } as never);
    setFileModel(semanticModel);
  });

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
    setFileModel({ dialogs: {}, functions: {}, hasErrors: false, errors: [] });
    render(<ChoiceRenderer {...baseProps} />);
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
      setFileModel({ dialogs: {}, functions: {}, hasErrors: false, errors: [] });
      render(<ChoiceRenderer {...baseProps} />);
      const choiceText = screen.getByLabelText('Choice Text');
      fireEvent.keyDown(choiceText, { key: 'Tab' });

      expect(screen.queryByTestId('inline-editor')).not.toBeInTheDocument();
      expect(baseProps.handleKeyDown).toHaveBeenCalled();
    });

    test('escaping backward out of the sub-editor returns focus to the Choice Text field', () => {
      render(<ChoiceRenderer {...baseProps} mainFieldRef={React.createRef<HTMLInputElement>()} />);
      // Expand so the inline sub-editor is mounted.
      fireEvent.click(screen.getByLabelText('Expand choice actions'));

      const choiceText = screen.getByLabelText('Choice Text');
      // Move focus away first, then trigger the sub-editor's escape-backward.
      const escapeButton = screen.getByTestId('invoke-escape-backward');
      escapeButton.focus();
      expect(choiceText).not.toHaveFocus();

      fireEvent.click(escapeButton);
      expect(choiceText).toHaveFocus();
    });
  });
});
