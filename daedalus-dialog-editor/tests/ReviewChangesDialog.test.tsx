/**
 * Review-before-save dialog: the "before" side must be the file's CURRENT
 * on-disk content, read fresh when the dialog opens — not the stale
 * originalCode snapshot from when the file was opened. After an auto-save or
 * manual save, disk already matches the generated code, and the dialog must
 * show that (empty diff) instead of replaying the whole session's changes.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ReviewChangesDialog from '../src/renderer/components/ReviewChangesDialog';

const FILE_PATH = 'C:/project/DIA_Review.d';

const model = {
  dialogs: {},
  functions: {},
  hasErrors: false,
  errors: [],
} as any;

const readFileSpy = jest.spyOn(window.editorAPI, 'readFile');
const generateCodeSpy = jest.spyOn(window.editorAPI, 'generateCode');

beforeEach(() => {
  readFileSpy.mockReset();
  generateCodeSpy.mockReset();
});

describe('ReviewChangesDialog', () => {
  test('diffs the current on-disk content against freshly generated code', async () => {
    readFileSpy.mockResolvedValue('shared\ndisk line');
    generateCodeSpy.mockResolvedValue('shared\ngenerated line');

    render(
      <ReviewChangesDialog
        open
        filePath={FILE_PATH}
        semanticModel={model}
        onSave={jest.fn<() => Promise<void>>().mockResolvedValue(undefined)}
        onClose={jest.fn()}
      />
    );

    const diff = await screen.findByTestId('review-changes-diff');
    expect(diff.textContent).toBe(' shared\n-disk line\n+generated line');
    expect(readFileSpy).toHaveBeenCalledWith(FILE_PATH);
  });

  test('shows an empty diff when disk already matches the generated code', async () => {
    readFileSpy.mockResolvedValue('same\ncontent');
    generateCodeSpy.mockResolvedValue('same\ncontent');

    render(
      <ReviewChangesDialog
        open
        filePath={FILE_PATH}
        semanticModel={model}
        onSave={jest.fn<() => Promise<void>>().mockResolvedValue(undefined)}
        onClose={jest.fn()}
      />
    );

    const diff = await screen.findByTestId('review-changes-diff');
    expect(diff.textContent).toBe(' same\n content');
  });

  test('falls back to an error alert when the disk read fails, keeping Save usable', async () => {
    readFileSpy.mockRejectedValue(new Error('gone'));
    generateCodeSpy.mockResolvedValue('generated');

    render(
      <ReviewChangesDialog
        open
        filePath={FILE_PATH}
        semanticModel={model}
        onSave={jest.fn<() => Promise<void>>().mockResolvedValue(undefined)}
        onClose={jest.fn()}
      />
    );

    await screen.findByTestId('review-changes-disk-error');
    await waitFor(() => {
      expect(screen.getByTestId('review-changes-save')).toBeEnabled();
    });
  });
});
