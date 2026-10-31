/**
 * The dialog editor's Undo/Redo buttons drain a pending debounced keystroke
 * before they run.
 *
 * Ctrl+Z already does (MainLayout flushes, then undoes). The buttons called
 * `undo` directly, so clicking Undo within the 300 ms ActionCard debounce
 * reverted an older edit and the timer then wrote the keystroke onto the
 * reverted model: the undo looked like it had done nothing.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogDetailsEditor from '../src/renderer/components/DialogDetailsEditor';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import { registerPendingEditFlusher } from '../src/renderer/utils/pendingEditFlushRegistry';
import type { SemanticModel } from '../src/renderer/types/global';

const FILE = '/test/Undo.d';
const DIALOG = 'DIA_Test';

const model = (text: string): SemanticModel => ({
  dialogs: {
    [DIALOG]: {
      name: DIALOG,
      parent: 'C_INFO',
      properties: { npc: 'NPC1', information: 'DIA_Test_Info' }
    }
  },
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      calls: [],
      conditions: [],
      actions: [{ type: 'DialogLine', speaker: 'other', text, id: 'line' }]
    }
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

const text = (): string | undefined => {
  const action = useEditorStore.getState().getFileState(FILE)?.semanticModel.functions.DIA_Test_Info.actions?.[0] as
    | { text?: string }
    | undefined;
  return action?.text;
};

describe('DialogDetailsEditor — the toolbar undo drains pending edits first', () => {
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map([[FILE, {
        filePath: FILE,
        semanticModel: model('A'),
        isDirty: true,
        lastSaved: new Date(),
        originalCode: '',
        hasErrors: false,
        errors: [],
      }]]),
      activeFile: FILE,
    } as never);
    useHistoryStore.setState({ editHistory: new Map() });
  });

  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it('commits the pending keystroke before undoing', () => {
    // "A" is the step on the undo stack; "B" is what the editor holds now, and
    // "C" is the keystroke still sitting in the debounce.
    useHistoryStore.getState().pushSnapshot(FILE);
    useEditorStore.getState().updateModel(FILE, model('B'));

    const seenByFlusher: string[] = [];
    unregister = registerPendingEditFlusher(() => {
      seenByFlusher.push(text() ?? '');
      useEditorStore.getState().updateModel(FILE, model('C'));
    });

    render(<DialogDetailsEditor dialogName={DIALOG} filePath={FILE} semanticModel={model('B')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    // It ran, and it saw the model as it was before the click — so it ran
    // before the undo, not after it.
    expect(seenByFlusher).toEqual(['B']);
    expect(text()).toBe('A');
  });
});
