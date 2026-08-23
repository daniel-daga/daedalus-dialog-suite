/**
 * External-change conflict dialog: on-disk diff (feature-suggestions item 6).
 *
 * When the dialog opens for a changed-on-disk conflict it loads the on-disk
 * content and the editor's version (code generated from the semantic model)
 * and renders a line diff. If either load fails it falls back
 * to the previous text-only dialog — the resolution buttons must stay usable.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ExternalChangeConflictDialog from '../src/renderer/components/ExternalChangeConflictDialog';
import { useFileStore } from '../src/renderer/store/fileStore';

const FILE_PATH = 'C:/project/DIA_Conflict.d';

const model = {
  dialogs: {},
  functions: {},
  hasErrors: false,
  errors: [],
};

const readFileSpy = jest.spyOn(window.editorAPI, 'readFile');
const generateCodeSpy = jest.spyOn(window.editorAPI, 'generateCode');

const seedConflict = (fileState: Record<string, unknown> = {}) => {
  useFileStore.setState({
    openFiles: new Map([[FILE_PATH, {
      filePath: FILE_PATH,
      semanticModel: model,
      isDirty: true,
      lastSaved: new Date(),
      externalConflict: { detectedAt: new Date().toISOString() },
      ...fileState,
    } as any]]),
    activeFile: FILE_PATH,
  } as any);
};

beforeEach(() => {
  readFileSpy.mockReset();
  generateCodeSpy.mockReset();
  useFileStore.setState({ openFiles: new Map(), activeFile: null } as any);
});

describe('ExternalChangeConflictDialog on-disk diff', () => {
  test('shows a diff of the on-disk content against the generated editor content', async () => {
    readFileSpy.mockResolvedValue('shared\ndisk line');
    generateCodeSpy.mockResolvedValue('shared\nmine line');
    seedConflict();

    render(<ExternalChangeConflictDialog />);

    const diff = await screen.findByTestId('external-conflict-diff');
    expect(diff.textContent).toBe(' shared\n-disk line\n+mine line');
    expect(readFileSpy).toHaveBeenCalledWith(FILE_PATH);
    expect(generateCodeSpy).toHaveBeenCalledWith(model, useFileStore.getState().codeSettings);
  });

  test('falls back to the text-only dialog when reading the disk content fails', async () => {
    readFileSpy.mockRejectedValue(new Error('gone'));
    seedConflict();

    render(<ExternalChangeConflictDialog />);

    await waitFor(() => {
      expect(screen.queryByTestId('external-conflict-diff-loading')).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId('external-conflict-diff')).not.toBeInTheDocument();
    // The dialog itself stays usable: explanation text and both resolutions.
    expect(screen.getByText(/changed on disk while you have unsaved changes/i)).toBeInTheDocument();
    expect(screen.getByTestId('external-conflict-keep-mine')).toBeInTheDocument();
    expect(screen.getByTestId('external-conflict-reload')).toBeInTheDocument();
  });

  test('stays text-only for the file-missing variant', async () => {
    seedConflict({ externalConflict: { detectedAt: new Date().toISOString(), fileMissing: true } });

    render(<ExternalChangeConflictDialog />);

    expect(screen.getByText(/deleted or moved on disk/i)).toBeInTheDocument();
    expect(screen.queryByTestId('external-conflict-diff')).not.toBeInTheDocument();
    expect(screen.queryByTestId('external-conflict-diff-loading')).not.toBeInTheDocument();
    expect(readFileSpy).not.toHaveBeenCalled();
  });
});
