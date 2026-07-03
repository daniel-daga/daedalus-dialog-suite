/**
 * Window-close guard (E1).
 *
 * The main process intercepts the OS window close and asks the renderer to
 * decide. `useWindowCloseGuard` acknowledges immediately, flushes pending
 * debounced edits, and then either approves the close (nothing unsaved) or
 * renders a dialog listing the unsaved files with three choices.
 *
 * These tests drive the hook through the mocked `editorAPI` close channels and
 * a seeded `fileStore`.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { useWindowCloseGuard } from '../src/renderer/hooks/useWindowCloseGuard';
import { useFileStore } from '../src/renderer/store/fileStore';
import { registerPendingEditFlusher } from '../src/renderer/utils/pendingEditFlushRegistry';

const FILE_PATH = 'C:/project/DIA_Test.d';

const model = (npc: string) => ({
  dialogs: { TestDialog: { name: 'TestDialog', properties: { npc } } },
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
});

// Capture the close-requested callback the hook registers so the test can fire it.
let capturedCloseRequested: (() => void) | null = null;

const ackSpy = jest.spyOn(window.editorAPI, 'ackCloseRequest');
const approveSpy = jest.spyOn(window.editorAPI, 'approveClose');
const cancelSpy = jest.spyOn(window.editorAPI, 'cancelClose');
const saveFileSpy = jest.spyOn(window.editorAPI, 'saveFile');

jest.spyOn(window.editorAPI, 'onCloseRequested').mockImplementation((cb) => {
  capturedCloseRequested = cb as () => void;
  return () => { capturedCloseRequested = null; };
});

const Harness: React.FC = () => {
  const dialog = useWindowCloseGuard();
  return <>{dialog}</>;
};

const seedStore = (fileState: Record<string, unknown>) => {
  useFileStore.setState({
    openFiles: new Map([[FILE_PATH, {
      filePath: FILE_PATH,
      lastSaved: new Date(),
      ...fileState,
    } as any]]),
    activeFile: FILE_PATH,
    codeSettings: {
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: true,
    },
  } as any);
};

const fireCloseRequested = async () => {
  await act(async () => {
    capturedCloseRequested!();
    await Promise.resolve();
  });
};

beforeEach(() => {
  capturedCloseRequested = null;
  ackSpy.mockClear();
  approveSpy.mockClear();
  cancelSpy.mockClear();
  saveFileSpy.mockClear().mockResolvedValue({ success: true, validationResult: { isValid: true, errors: [], warnings: [] } } as any);
  useFileStore.setState({ openFiles: new Map(), activeFile: null } as any);
});

afterEach(() => {
  saveFileSpy.mockReset();
});

describe('useWindowCloseGuard', () => {
  test('acknowledges immediately and approves close when nothing is unsaved', async () => {
    seedStore({ semanticModel: model('NPC1'), isDirty: false });
    render(<Harness />);
    await waitFor(() => expect(capturedCloseRequested).not.toBeNull());

    await fireCloseRequested();

    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(approveSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('close-guard-dialog')).not.toBeInTheDocument();
  });

  test('renders a dialog listing unsaved files instead of approving', async () => {
    seedStore({ semanticModel: model('NPC1'), isDirty: true });
    render(<Harness />);
    await waitFor(() => expect(capturedCloseRequested).not.toBeNull());

    await fireCloseRequested();

    expect(ackSpy).toHaveBeenCalledTimes(1);
    expect(approveSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('close-guard-dialog')).toBeInTheDocument();
    expect(screen.getByText(/DIA_Test\.d/)).toBeInTheDocument();
  });

  test('"Save and close" awaits the save then approves', async () => {
    seedStore({ semanticModel: model('NPC1'), isDirty: true });
    render(<Harness />);
    await waitFor(() => expect(capturedCloseRequested).not.toBeNull());
    await fireCloseRequested();

    await act(async () => {
      screen.getByTestId('close-guard-save').click();
      await Promise.resolve();
    });

    await waitFor(() => expect(approveSpy).toHaveBeenCalledTimes(1));
    expect(saveFileSpy).toHaveBeenCalledTimes(1);
    expect(saveFileSpy.mock.calls[0][0]).toBe(FILE_PATH);
  });

  test('a save failure keeps the window open and shows the error', async () => {
    seedStore({ semanticModel: model('NPC1'), isDirty: true });
    saveFileSpy.mockRejectedValue(new Error('PARSE_TIMEOUT: parser did not respond'));
    render(<Harness />);
    await waitFor(() => expect(capturedCloseRequested).not.toBeNull());
    await fireCloseRequested();

    await act(async () => {
      screen.getByTestId('close-guard-save').click();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('close-guard-error')).toBeInTheDocument());
    expect(approveSpy).not.toHaveBeenCalled();
    // The file stays dirty and the dialog stays open.
    expect(screen.getByTestId('close-guard-dialog')).toBeInTheDocument();
    expect(useFileStore.getState().openFiles.get(FILE_PATH)?.isDirty).toBe(true);
  });

  test('"Cancel" cancels the close and leaves the window open', async () => {
    seedStore({ semanticModel: model('NPC1'), isDirty: true });
    render(<Harness />);
    await waitFor(() => expect(capturedCloseRequested).not.toBeNull());
    await fireCloseRequested();

    await act(async () => {
      screen.getByTestId('close-guard-cancel').click();
      await Promise.resolve();
    });

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(approveSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('close-guard-dialog')).not.toBeInTheDocument());
  });

  test('a pending debounced edit is flushed and included in the saved model', async () => {
    // Seed clean; a registered flusher makes the file dirty with the flushed
    // value, exactly as a mounted condition/action card would at close time.
    seedStore({ semanticModel: model('PENDING'), isDirty: false });
    const unregister = registerPendingEditFlusher(() => {
      useFileStore.getState().updateDialog(FILE_PATH, 'TestDialog', {
        name: 'TestDialog',
        properties: { npc: 'FLUSHED' },
      } as any);
    });

    try {
      render(<Harness />);
      await waitFor(() => expect(capturedCloseRequested).not.toBeNull());
      await fireCloseRequested();

      // The flush ran, so the file is now unsaved and the dialog is shown.
      expect(screen.getByTestId('close-guard-dialog')).toBeInTheDocument();

      await act(async () => {
        screen.getByTestId('close-guard-save').click();
        await Promise.resolve();
      });

      await waitFor(() => expect(saveFileSpy).toHaveBeenCalledTimes(1));
      const savedModel = saveFileSpy.mock.calls[0][1] as any;
      expect(savedModel.dialogs.TestDialog.properties.npc).toBe('FLUSHED');
    } finally {
      unregister();
    }
  });
});
