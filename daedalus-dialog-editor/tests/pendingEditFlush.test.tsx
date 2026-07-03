/**
 * Flush pending debounced edits before undo/redo (fix-05 §2.3, finding U4).
 *
 * The global Ctrl+Z handler in MainLayout calls historyStore.undo immediately.
 * A pending 300 ms ActionCard/ConditionCard debounce that fires afterwards
 * re-applies the just-undone text as a fresh edit (phantom), clearing the redo
 * stack. The fix flushes all registered pending edits FIRST, committing the
 * in-flight text as a normal history step, so the first Ctrl+Z reverts it and
 * redo restores it — and no late timer echoes a phantom step.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// Keep MainLayout's render tree light — we only need its window keydown effect.
jest.mock('../src/renderer/components/ThreeColumnLayout', () => () => null);
jest.mock('../src/renderer/components/SourceEditsPendingBanner', () => () => null);

import MainLayout from '../src/renderer/components/MainLayout';
import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';
import * as historyActions from '../src/renderer/store/historyActions';
import { registerPendingEditFlusher } from '../src/renderer/utils/pendingEditFlushRegistry';
import type { SemanticModel } from '../src/renderer/types/global';

const filePath = 'C:/tmp/flush.d';

const makeModel = (text: string): SemanticModel => ({
  dialogs: {},
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'DialogLine', text, speaker: 'Hero', id: 'line_1' }],
      conditions: [],
      calls: [],
    },
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
});

const lineText = () =>
  ((useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info
    .actions[0]) as { text?: string }).text;

const dispatchKey = (key: string, opts: Partial<KeyboardEvent> = {}) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, ...opts }));
  });
};

/**
 * Mimic exactly one ActionCard's pending debounce: a live setTimeout that
 * commits the newest text through history, plus a registry flusher that fires
 * the same commit early (and no-ops once the timer is gone). This is the
 * ActionCard mechanism verbatim.
 */
const startPendingEdit = (newText: string) => {
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    historyActions.updateModel(filePath, makeModel(newText));
  }, 300);
  const unregister = registerPendingEditFlusher(() => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      historyActions.updateModel(filePath, makeModel(newText));
    }
  });
  return unregister;
};

describe('pending-edit flush before undo/redo (U4)', () => {
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    useFileStore.setState({
      openFiles: new Map([
        [filePath, {
          filePath,
          semanticModel: makeModel('hello'),
          isDirty: false,
          lastSaved: new Date(),
          originalCode: '',
          workingCode: '',
          hasErrors: false,
          errors: [],
          validationResult: null,
        }],
      ]),
      activeFile: filePath,
    });
    useHistoryStore.setState({
      editHistory: new Map(),
      questBatchHistory: { past: [], future: [] },
      questNodePositions: new Map(),
    });
    useUISelectionStore.setState({ activeView: 'dialog' });
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  it('first Ctrl+Z reverts the in-flight text and no late timer echoes a phantom', () => {
    render(<MainLayout filePath={filePath} />);

    // User types "hello world" (edit still pending in the 300 ms debounce).
    unregister = startPendingEdit('hello world');

    // Ctrl+Z within the window: flush commits the edit, then undo reverts it.
    dispatchKey('z');
    expect(lineText()).toBe('hello');

    // The late timer must NOT re-apply "hello world" (no phantom echo) and the
    // single Ctrl+Z must have fully reverted (no leftover undo step).
    act(() => { jest.advanceTimersByTime(500); });
    expect(lineText()).toBe('hello');
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);

    // Redo restores the flushed edit.
    dispatchKey('y');
    expect(lineText()).toBe('hello world');
  });
});
