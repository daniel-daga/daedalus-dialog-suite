/**
 * The source view dialog's title: `DialogTitle` is already an `h2`, and an
 * `h6` Typography inside it was a heading inside a heading — a live
 * `validateDOMNesting` warning (2026-07 review 5.7a). And its copy button gave
 * no feedback at all (5.7b).
 *
 * It also has two sources. A dialog the parser read with a line (#433) is shown
 * as its own `.d` file, scrolled to that line, so its numbering matches what a
 * validation error names; anything else — no line, no file, or an unreadable
 * file — keeps the generated-source view it has always had.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogSourceViewDialog from '../src/renderer/components/DialogSourceViewDialog';

const mockEditor = {
  revealLineInCenter: jest.fn(),
  setPosition: jest.fn()
};

jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onMount }: { value: string; onMount?: (editor: unknown) => void }) => {
    onMount?.(mockEditor);
    return <pre data-testid="monaco-stub">{value}</pre>;
  },
  loader: { config: jest.fn() }
}));

const MODEL = { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as never;

const FILE_PATH = 'C:/g2/_work/DATA/Scripts/Content/Story/DIA_X.d';

/** The dialog starts at line 42 of the file, not at line 1 of its own text. */
const PARSED_MODEL = {
  dialogs: { DIA_X: { name: 'DIA_X', parent: 'C_INFO', line: 42 } },
  functions: {},
  hasErrors: false,
  errors: []
} as never;

const FILE_TEXT = Array.from({ length: 60 }, (_, i) => `    // file line ${i + 1}`).join('\n');

const editorAPI = () => (window as any).editorAPI;

describe('DialogSourceViewDialog', () => {
  beforeEach(() => {
    mockEditor.revealLineInCenter.mockClear();
    mockEditor.setPosition.mockClear();
    (window as any).editorAPI = {
      generateDialogCode: jest.fn().mockResolvedValue('// generated DIA_X'),
      readFile: jest.fn().mockResolvedValue(FILE_TEXT)
    };
  });

  it('renders its title with no validateDOMNesting warning', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<DialogSourceViewDialog open onClose={jest.fn()} dialogName="DIA_X" semanticModel={MODEL} />);

    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveTextContent('generated DIA_X'));
    expect(screen.getByRole('heading', { name: 'Source Code: DIA_X' })).toBeInTheDocument();

    const nesting = consoleError.mock.calls.filter((args) => String(args[0]).includes('validateDOMNesting'));
    expect(nesting).toEqual([]);
    consoleError.mockRestore();
  });

  it('copy shows a confirmation', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DialogSourceViewDialog open onClose={jest.fn()} dialogName="DIA_X" semanticModel={MODEL} />);
    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveTextContent('generated DIA_X'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));

    expect(writeText).toHaveBeenCalledWith('// generated DIA_X');
    expect(await screen.findByRole('alert')).toHaveTextContent(/copied/i);
  });

  it("shows the dialog's own file at that file's numbering and jumps to the line", async () => {
    const readFile = editorAPI().readFile;
    render(
      <DialogSourceViewDialog
        open
        onClose={jest.fn()}
        dialogName="DIA_X"
        filePath={FILE_PATH}
        semanticModel={PARSED_MODEL}
      />
    );

    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveTextContent('file line 60'));

    expect(readFile).toHaveBeenCalledWith(FILE_PATH);
    expect(editorAPI().generateDialogCode).not.toHaveBeenCalled();
    expect(mockEditor.revealLineInCenter).toHaveBeenCalledWith(42);
    expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 42, column: 1 });
  });

  it('falls back to the generated source when the dialog has no source line', async () => {
    render(
      <DialogSourceViewDialog
        open
        onClose={jest.fn()}
        dialogName="DIA_X"
        filePath={FILE_PATH}
        semanticModel={MODEL}
      />
    );

    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveTextContent('generated DIA_X'));
    expect(editorAPI().readFile).not.toHaveBeenCalled();
    expect(mockEditor.revealLineInCenter).not.toHaveBeenCalled();
  });

  it('falls back to the generated source when the file cannot be read', async () => {
    editorAPI().readFile = jest.fn().mockRejectedValue(new Error('ENOENT'));
    render(
      <DialogSourceViewDialog
        open
        onClose={jest.fn()}
        dialogName="DIA_X"
        filePath={FILE_PATH}
        semanticModel={PARSED_MODEL}
      />
    );

    await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveTextContent('generated DIA_X'));
    expect(mockEditor.revealLineInCenter).not.toHaveBeenCalled();
  });
});
