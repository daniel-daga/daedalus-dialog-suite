/**
 * The source view dialog's title: `DialogTitle` is already an `h2`, and an
 * `h6` Typography inside it was a heading inside a heading — a live
 * `validateDOMNesting` warning (2026-07 review 5.7a).
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogSourceViewDialog from '../src/renderer/components/DialogSourceViewDialog';

jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <pre data-testid="monaco-stub">{value}</pre>,
  loader: { config: jest.fn() }
}));

const MODEL = { dialogs: {}, functions: {}, hasErrors: false, errors: [] } as never;

describe('DialogSourceViewDialog', () => {
  beforeEach(() => {
    (window as any).editorAPI = {
      generateDialogCode: jest.fn().mockResolvedValue('// generated DIA_X')
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
});
