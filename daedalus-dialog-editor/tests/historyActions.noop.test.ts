/**
 * Phantom-undo transactional push (fix-05 §2.2, finding F-A).
 *
 * `withHistory` pushes a snapshot before delegating to the fileStore mutation.
 * Several fileStore mutations have silent no-op exits (missing dialog/function,
 * updater returning null). Before the transactional fix, a no-op mutation still:
 *   - added a phantom past entry (one Ctrl+Z consumed doing nothing), and
 *   - wiped the existing redo `future` (redo destroyed by a no-op).
 *
 * The transactional push must detect that the model reference is unchanged and
 * restore the pre-call past/future stacks.
 */

import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import * as historyActions from '../src/renderer/store/historyActions';
import type { Dialog, SemanticModel } from '../src/renderer/types/global';

const makeModel = (tag: string): SemanticModel => ({
  dialogs: {
    DIA_Test: {
      properties: { npc: tag, information: 'DIA_Test_Info' }
    }
  },
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

const filePath = 'C:/tmp/noop.d';

const resetStores = () => {
  useFileStore.setState({
    openFiles: new Map([
      [filePath, {
        filePath,
        semanticModel: makeModel('initial'),
        isDirty: false,
        lastSaved: new Date(),
        originalCode: '',
        hasErrors: false,
        errors: [],
        validationResult: null,
      }]
    ]),
    activeFile: filePath,
  });
  useHistoryStore.setState({
    editHistory: new Map(),
  });
};

/**
 * Build a real redo `future`: one edit, then undo. After this the file has
 * canUndo=false, canRedo=true (the undone edit sits in `future`).
 */
const seedRedoableFuture = () => {
  historyActions.updateDialog(filePath, 'DIA_Test', {
    properties: { npc: 'edited', information: 'DIA_Test_Info' }
  } as Dialog);
  useHistoryStore.getState().undo(filePath);
};

describe('historyActions – no-op mutations push no phantom snapshot (F-A)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    resetStores();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('preserves redo future when the updater returns null', () => {
    seedRedoableFuture();
    expect(useHistoryStore.getState().canRedo(filePath)).toBe(true);
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);

    // Advance well past the coalesce window so a phantom push would be a fresh entry.
    jest.advanceTimersByTime(1000);

    // Updater returns null -> fileStore leaves the model untouched (no-op).
    historyActions.updateDialogWithUpdater(filePath, 'DIA_Test', () => null);

    // Future must survive; no phantom past entry may appear.
    expect(useHistoryStore.getState().canRedo(filePath)).toBe(true);
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);
  });

  it('preserves redo future when the target dialog does not exist', () => {
    seedRedoableFuture();
    expect(useHistoryStore.getState().canRedo(filePath)).toBe(true);

    jest.advanceTimersByTime(1000);

    // Missing dialog -> fileStore no-ops.
    historyActions.updateDialogWithUpdater(filePath, 'DIA_Missing', (existing) => existing);

    expect(useHistoryStore.getState().canRedo(filePath)).toBe(true);
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);
  });

  it('still records a snapshot when the mutation actually changes the model', () => {
    // Sanity: a real edit must produce an undoable step (guards against the fix
    // over-restoring and eating legitimate history).
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);

    historyActions.updateDialog(filePath, 'DIA_Test', {
      properties: { npc: 'changed', information: 'DIA_Test_Info' }
    } as Dialog);

    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });
});
