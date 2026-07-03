/**
 * Source-edits-pending reconciliation banner (E2b).
 *
 * When a file is source-dirty (workingCode differs from disk), model mutations
 * are blocked (E2a) and this banner is the UX for unblocking: Apply parses and
 * adopts the source into the model; Discard drops the typed source.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import SourceEditsPendingBanner from '../src/renderer/components/SourceEditsPendingBanner';
import { useFileStore } from '../src/renderer/store/fileStore';

const FILE_PATH = 'C:/project/DIA_Test.d';

const parsedModel = {
  dialogs: { DIA_Test: { name: 'DIA_Test', properties: { npc: 'NPC1' } } },
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
};

const parseSpy = jest.spyOn(window.editorAPI, 'parseSource');

const seed = (fileState: Record<string, unknown>) => {
  useFileStore.setState({
    openFiles: new Map([[FILE_PATH, {
      filePath: FILE_PATH,
      lastSaved: new Date(),
      ...fileState,
    } as any]]),
    activeFile: FILE_PATH,
  } as any);
};

beforeEach(() => {
  parseSpy.mockReset();
  useFileStore.setState({ openFiles: new Map(), activeFile: null } as any);
});

afterEach(() => {
  parseSpy.mockReset();
});

describe('SourceEditsPendingBanner', () => {
  test('renders nothing when the file is not source-dirty', () => {
    seed({ semanticModel: parsedModel, isDirty: false, originalCode: 'code', workingCode: undefined });
    render(<SourceEditsPendingBanner filePath={FILE_PATH} />);
    expect(screen.queryByTestId('source-edits-pending-banner')).not.toBeInTheDocument();
  });

  test('renders the banner when the file is source-dirty', () => {
    seed({ semanticModel: parsedModel, isDirty: false, originalCode: 'old code', workingCode: 'new code' });
    render(<SourceEditsPendingBanner filePath={FILE_PATH} />);
    expect(screen.getByTestId('source-edits-pending-banner')).toBeInTheDocument();
    expect(screen.getByTestId('source-edits-apply')).toBeInTheDocument();
    expect(screen.getByTestId('source-edits-discard')).toBeInTheDocument();
  });

  test('Apply parses and adopts the source, clearing the banner and dirtying the model', async () => {
    seed({ semanticModel: parsedModel, isDirty: false, originalCode: 'old code', workingCode: 'new code' });
    parseSpy.mockResolvedValue({ ...parsedModel } as any);

    render(<SourceEditsPendingBanner filePath={FILE_PATH} />);

    await act(async () => {
      screen.getByTestId('source-edits-apply').click();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.queryByTestId('source-edits-pending-banner')).not.toBeInTheDocument()
    );
    const fs = useFileStore.getState().openFiles.get(FILE_PATH);
    expect(fs?.workingCode).toBeUndefined();
    expect(fs?.isDirty).toBe(true);
  });

  test('Apply on unparseable source keeps the banner and surfaces the errors', async () => {
    seed({ semanticModel: parsedModel, isDirty: false, originalCode: 'old code', workingCode: 'garbage {' });
    parseSpy.mockResolvedValue({
      dialogs: {},
      functions: {},
      hasErrors: true,
      errors: [{ message: 'Unexpected token at line 1' }],
    } as any);

    render(<SourceEditsPendingBanner filePath={FILE_PATH} />);

    await act(async () => {
      screen.getByTestId('source-edits-apply').click();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('source-edits-errors')).toBeInTheDocument());
    expect(screen.getByText(/Unexpected token at line 1/)).toBeInTheDocument();
    // Source is kept, banner stays, model untouched.
    const fs = useFileStore.getState().openFiles.get(FILE_PATH);
    expect(fs?.workingCode).toBe('garbage {');
    expect(screen.getByTestId('source-edits-pending-banner')).toBeInTheDocument();
  });

  test('Discard drops the typed source and clears the banner', async () => {
    seed({ semanticModel: parsedModel, isDirty: false, originalCode: 'old code', workingCode: 'new code' });

    render(<SourceEditsPendingBanner filePath={FILE_PATH} />);

    await act(async () => {
      screen.getByTestId('source-edits-discard').click();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.queryByTestId('source-edits-pending-banner')).not.toBeInTheDocument()
    );
    expect(parseSpy).not.toHaveBeenCalled();
    const fs = useFileStore.getState().openFiles.get(FILE_PATH);
    expect(fs?.workingCode).toBeUndefined();
  });
});
