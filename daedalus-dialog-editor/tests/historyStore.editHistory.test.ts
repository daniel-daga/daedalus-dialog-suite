import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import type { Dialog, SemanticModel } from '../src/renderer/types/global';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeModel = (tag: string): SemanticModel => ({
  dialogs: {
    DIA_Test: {
      properties: { npc: tag, information: 'DIA_Test_Info' }
    }
  },
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'DialogLine', text: tag, speaker: 'Hero', id: `id_${tag}` }],
      conditions: [],
      calls: []
    }
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

const filePath = 'C:/tmp/dialog.d';

const resetStores = (initialModel: SemanticModel = makeModel('initial')) => {
  useFileStore.setState({
    openFiles: new Map([
      [filePath, {
        filePath,
        semanticModel: initialModel,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: '',
        workingCode: '',
        hasErrors: false,
        errors: [],
        validationResult: null,
      }]
    ]),
    activeFile: filePath,
  });

  useHistoryStore.setState({
    editHistory: new Map(),
    questBatchHistory: { past: [], future: [] },
    questNodePositions: new Map(),
  });
};

const currentNpc = () =>
  useFileStore.getState().getFileState(filePath)
    ?.semanticModel.dialogs?.DIA_Test?.properties?.npc as string;

// ---------------------------------------------------------------------------
// pushSnapshot
// ---------------------------------------------------------------------------

describe('historyStore – pushSnapshot', () => {
  beforeEach(resetStores);

  it('adds a snapshot to the past stack', () => {
    useHistoryStore.getState().pushSnapshot(filePath);

    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
    expect(useHistoryStore.getState().canRedo(filePath)).toBe(false);
  });

  it('does nothing when the file is not open', () => {
    useHistoryStore.getState().pushSnapshot('nonexistent.d');

    expect(useHistoryStore.getState().canUndo('nonexistent.d')).toBe(false);
  });

  it('clears the future stack when a new snapshot is pushed', () => {
    // Push once and apply a change, then undo to build a future
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('changed'));
    useHistoryStore.getState().undo(filePath);
    expect(useHistoryStore.getState().canRedo(filePath)).toBe(true);

    // A new snapshot push (outside coalesce window) must clear future
    jest.useFakeTimers();
    jest.advanceTimersByTime(400);
    useHistoryStore.getState().pushSnapshot(filePath);
    expect(useHistoryStore.getState().canRedo(filePath)).toBe(false);
    jest.useRealTimers();
  });

  it('coalesces rapid pushes within 300 ms into a single undo step', () => {
    jest.useFakeTimers();

    // First push at t=0
    useHistoryStore.getState().pushSnapshot(filePath);

    // Second push at t=100ms (within coalesce window)
    jest.advanceTimersByTime(100);
    useHistoryStore.getState().pushSnapshot(filePath);

    // Should still be only one entry in past
    const history = useHistoryStore.getState().editHistory.get(filePath);
    expect(history?.past.length).toBe(1);

    jest.useRealTimers();
  });

  it('does NOT coalesce pushes separated by more than 300 ms', () => {
    jest.useFakeTimers();

    useHistoryStore.getState().pushSnapshot(filePath);
    jest.advanceTimersByTime(400);
    useHistoryStore.getState().pushSnapshot(filePath);

    const history = useHistoryStore.getState().editHistory.get(filePath);
    expect(history?.past.length).toBe(2);

    jest.useRealTimers();
  });

  it('evicts the oldest entry when stack exceeds MAX_HISTORY_SIZE (50)', () => {
    jest.useFakeTimers();

    for (let i = 0; i < 55; i++) {
      jest.advanceTimersByTime(400); // ensure each push is outside coalesce window
      useHistoryStore.getState().pushSnapshot(filePath);
    }

    const history = useHistoryStore.getState().editHistory.get(filePath);
    expect(history?.past.length).toBeLessThanOrEqual(50);

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// undo / redo
// ---------------------------------------------------------------------------

describe('historyStore – undo and redo', () => {
  beforeEach(resetStores);

  it('restores the previous model on undo', () => {
    // Capture snapshot of 'initial' state, then change the model
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('modified'));

    expect(currentNpc()).toBe('modified');

    useHistoryStore.getState().undo(filePath);

    expect(currentNpc()).toBe('initial');
  });

  it('re-applies the model on redo after undo', () => {
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('modified'));

    useHistoryStore.getState().undo(filePath);
    expect(currentNpc()).toBe('initial');

    useHistoryStore.getState().redo(filePath);
    expect(currentNpc()).toBe('modified');
  });

  it('supports multiple undo steps in sequence', () => {
    jest.useFakeTimers();

    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('step1'));

    jest.advanceTimersByTime(400);
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('step2'));

    useHistoryStore.getState().undo(filePath);
    expect(currentNpc()).toBe('step1');

    useHistoryStore.getState().undo(filePath);
    expect(currentNpc()).toBe('initial');

    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);

    jest.useRealTimers();
  });

  it('supports multiple redo steps in sequence', () => {
    jest.useFakeTimers();

    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('step1'));

    jest.advanceTimersByTime(400);
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('step2'));

    useHistoryStore.getState().undo(filePath);
    useHistoryStore.getState().undo(filePath);
    expect(currentNpc()).toBe('initial');

    useHistoryStore.getState().redo(filePath);
    expect(currentNpc()).toBe('step1');

    useHistoryStore.getState().redo(filePath);
    expect(currentNpc()).toBe('step2');

    expect(useHistoryStore.getState().canRedo(filePath)).toBe(false);

    jest.useRealTimers();
  });

  it('marks file as dirty after undo', () => {
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('modified'));

    // Reset dirty flag manually to simulate autosave having run
    useFileStore.setState((state) => {
      const f = state.openFiles.get(filePath);
      if (f) f.isDirty = false;
    });

    useHistoryStore.getState().undo(filePath);

    expect(useFileStore.getState().getFileState(filePath)?.isDirty).toBe(true);
  });

  it('marks file as dirty after redo', () => {
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('modified'));
    useHistoryStore.getState().undo(filePath);

    useFileStore.setState((state) => {
      const f = state.openFiles.get(filePath);
      if (f) f.isDirty = false;
    });

    useHistoryStore.getState().redo(filePath);

    expect(useFileStore.getState().getFileState(filePath)?.isDirty).toBe(true);
  });

  it('does nothing on undo when stack is empty', () => {
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);

    // Should not throw
    expect(() => useHistoryStore.getState().undo(filePath)).not.toThrow();
    expect(currentNpc()).toBe('initial');
  });

  it('does nothing on redo when future is empty', () => {
    expect(useHistoryStore.getState().canRedo(filePath)).toBe(false);

    expect(() => useHistoryStore.getState().redo(filePath)).not.toThrow();
    expect(currentNpc()).toBe('initial');
  });

  it('does nothing on undo for a file that is not open', () => {
    expect(() => useHistoryStore.getState().undo('nonexistent.d')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Structural sharing: snapshots reference Immer-frozen models, no deep clones
// ---------------------------------------------------------------------------

describe('historyStore – snapshot structural sharing', () => {
  beforeEach(resetStores);

  it('pushSnapshot stores the current model by reference instead of deep-cloning', () => {
    const liveModel = useFileStore.getState().getFileState(filePath)!.semanticModel;

    useHistoryStore.getState().pushSnapshot(filePath);

    const snapshot = useHistoryStore.getState().editHistory.get(filePath)!.past[0];
    expect(snapshot.model).toBe(liveModel);
  });

  it('undo restores the snapshot model by reference instead of a clone', () => {
    const initialModel = useFileStore.getState().getFileState(filePath)!.semanticModel;
    useHistoryStore.getState().pushSnapshot(filePath);
    useFileStore.getState()._applyHistoryModelUpdate(filePath, makeModel('modified'));

    useHistoryStore.getState().undo(filePath);

    expect(useFileStore.getState().getFileState(filePath)!.semanticModel).toBe(initialModel);
  });

  it('a fileStore edit after pushSnapshot does not leak into the shared snapshot', () => {
    useHistoryStore.getState().pushSnapshot(filePath);

    // updateDialog goes through fileStore's Immer produce: copy-on-write must
    // leave the snapshot's model untouched although it is shared by reference
    useFileStore.getState().updateDialog(filePath, 'DIA_Test', {
      properties: { npc: 'edited', information: 'DIA_Test_Info' }
    } as Dialog);
    expect(currentNpc()).toBe('edited');

    const snapshot = useHistoryStore.getState().editHistory.get(filePath)!.past[0];
    expect(snapshot.model.dialogs?.DIA_Test?.properties?.npc).toBe('initial');

    useHistoryStore.getState().undo(filePath);
    expect(currentNpc()).toBe('initial');
  });
});

// ---------------------------------------------------------------------------
// clearHistoryForFile
// ---------------------------------------------------------------------------

describe('historyStore – clearHistoryForFile', () => {
  beforeEach(resetStores);

  it('removes all edit history for a file', () => {
    jest.useFakeTimers();

    useHistoryStore.getState().pushSnapshot(filePath);
    jest.advanceTimersByTime(400);
    useHistoryStore.getState().pushSnapshot(filePath);

    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);

    useHistoryStore.getState().clearHistoryForFile(filePath);

    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);
    expect(useHistoryStore.getState().editHistory.has(filePath)).toBe(false);

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Subscription: auto-clear on file close
// ---------------------------------------------------------------------------

describe('historyStore – subscription: auto-clear on file close', () => {
  beforeEach(resetStores);

  it('clears edit history when a file is removed from openFiles', () => {
    useHistoryStore.getState().pushSnapshot(filePath);
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);

    // Simulate closing the file
    useFileStore.setState({ openFiles: new Map() });

    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);
    expect(useHistoryStore.getState().editHistory.has(filePath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Subscription: saving one file must NOT wipe other files' quest batches (F-B)
// ---------------------------------------------------------------------------

describe('historyStore – save does not reset unrelated quest batches (F-B)', () => {
  const fileA = 'C:/tmp/A.d';
  const fileB = 'C:/tmp/B.d';

  const openTwoFiles = () => {
    useFileStore.setState({
      openFiles: new Map([
        [fileA, {
          filePath: fileA, semanticModel: makeModel('A0'), isDirty: false,
          lastSaved: new Date(), originalCode: 'A-src-0', workingCode: '',
          hasErrors: false, errors: [], validationResult: null,
        }],
        [fileB, {
          filePath: fileB, semanticModel: makeModel('B0'), isDirty: false,
          lastSaved: new Date(), originalCode: 'B-src-0', workingCode: '',
          hasErrors: false, errors: [], validationResult: null,
        }],
      ]),
      activeFile: fileA,
    });
    useHistoryStore.setState({
      editHistory: new Map(),
      questBatchHistory: { past: [], future: [] },
      questNodePositions: new Map(),
    });
  };

  it('keeps file B\'s quest batch undoable after file A is saved', () => {
    openTwoFiles();

    // Quest batch on A, then a quest batch on B (B on top).
    useHistoryStore.getState().applyQuestModelWithHistory(fileA, makeModel('A1'));
    useHistoryStore.getState().applyQuestModelWithHistory(fileB, makeModel('B1'));
    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(true);

    // Simulate a source save of file A only: originalCode changes, isDirty=false.
    useFileStore.setState((state) => {
      const next = new Map(state.openFiles);
      const a = next.get(fileA)!;
      next.set(fileA, { ...a, originalCode: 'A-src-1', isDirty: false });
      return { openFiles: next };
    });

    // B's quest batch must survive (only batches containing A are cleared).
    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(true);
    useHistoryStore.getState().undoLastQuestBatch();
    expect(
      useFileStore.getState().getFileState(fileB)?.semanticModel.dialogs?.DIA_Test?.properties?.npc
    ).toBe('B0');
  });
});
