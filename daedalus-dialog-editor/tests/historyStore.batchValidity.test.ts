/**
 * Quest batch snapshot-identity validity (fix-05 §2.1, finding U1).
 *
 * Quest batch entries record the exact per-file snapshot id they pushed, so
 * batch undo/redo validate at read time and refuse (button disables) whenever
 * a member file received a newer edit, its snapshot was consumed by per-file
 * undo, or was evicted/cleared — instead of reverting the wrong edit.
 *
 * This replaces the old codified-bug behavior ("batch undo pops whatever is on
 * top of each member file").
 */

import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import type { SemanticModel } from '../src/renderer/types/global';

const makeModel = (value: string): SemanticModel => ({
  dialogs: {},
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'SetVariableAction', variableName: 'MIS_TEST', operator: '=', value }],
      conditions: [],
      calls: [],
    },
  },
  constants: {}, variables: {}, instances: {}, hasErrors: false, errors: [],
});

const fileA = 'C:/tmp/A.d';
const fileB = 'C:/tmp/B.d';

const valueOf = (filePath: string) =>
  ((useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info
    .actions[0]) as { value?: string }).value;

const seed = (a: string, b: string) => {
  useFileStore.setState({
    openFiles: new Map([
      [fileA, {
        filePath: fileA, semanticModel: makeModel(a), isDirty: false,
        lastSaved: new Date(), originalCode: '', workingCode: '',
        hasErrors: false, errors: [], validationResult: null,
      }],
      [fileB, {
        filePath: fileB, semanticModel: makeModel(b), isDirty: false,
        lastSaved: new Date(), originalCode: '', workingCode: '',
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

describe('historyStore – quest batch validity (U1)', () => {
  beforeEach(() => seed('A0', 'B0'));

  it('refuses the batch and leaves per-file history intact after a member gets a newer dialog edit', () => {
    // Batch over A + B.
    useHistoryStore.getState().applyQuestModelsWithHistory([
      { filePath: fileA, model: makeModel('A1') },
      { filePath: fileB, model: makeModel('B1') },
    ]);
    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(true);

    // A newer dialog edit lands on top of A.
    useHistoryStore.getState().pushSnapshot(fileA);
    useFileStore.getState()._applyHistoryModelUpdate(fileA, makeModel('A-dialog'));

    // Batch undo is now ill-defined -> disabled and a no-op.
    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(false);
    const result = useHistoryStore.getState().undoLastQuestBatch();
    expect(result.ok).toBe(false);
    expect(valueOf(fileA)).toBe('A-dialog');
    expect(valueOf(fileB)).toBe('B1');

    // Everything remains undoable per-file: A's dialog edit, then A's quest edit.
    useHistoryStore.getState().undo(fileA);
    expect(valueOf(fileA)).toBe('A1');
    useHistoryStore.getState().undo(fileA);
    expect(valueOf(fileA)).toBe('A0');
    useHistoryStore.getState().undo(fileB);
    expect(valueOf(fileB)).toBe('B0');
  });

  it('undoes and redoes a clean batch across both files', () => {
    useHistoryStore.getState().applyQuestModelsWithHistory([
      { filePath: fileA, model: makeModel('A1') },
      { filePath: fileB, model: makeModel('B1') },
    ]);

    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(true);
    expect(useHistoryStore.getState().undoLastQuestBatch().ok).toBe(true);
    expect(valueOf(fileA)).toBe('A0');
    expect(valueOf(fileB)).toBe('B0');

    expect(useHistoryStore.getState().canRedoLastQuestBatch()).toBe(true);
    expect(useHistoryStore.getState().redoLastQuestBatch().ok).toBe(true);
    expect(valueOf(fileA)).toBe('A1');
    expect(valueOf(fileB)).toBe('B1');
  });

  it('invalidates the batch when a per-file undo consumes a member snapshot', () => {
    useHistoryStore.getState().applyQuestModelsWithHistory([
      { filePath: fileA, model: makeModel('A1') },
      { filePath: fileB, model: makeModel('B1') },
    ]);
    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(true);

    // Per-file undo on A consumes A's batch snapshot from its past stack.
    useHistoryStore.getState().undo(fileA);
    expect(valueOf(fileA)).toBe('A0');

    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(false);
    expect(useHistoryStore.getState().undoLastQuestBatch().ok).toBe(false);
  });

  it('invalidates batch redo when a member future is cleared by a newer edit', () => {
    useHistoryStore.getState().applyQuestModelsWithHistory([
      { filePath: fileA, model: makeModel('A1') },
      { filePath: fileB, model: makeModel('B1') },
    ]);
    useHistoryStore.getState().undoLastQuestBatch();
    expect(useHistoryStore.getState().canRedoLastQuestBatch()).toBe(true);

    // A new edit on B clears B's redo future -> batch redo becomes invalid.
    useHistoryStore.getState().pushSnapshot(fileB);
    useFileStore.getState()._applyHistoryModelUpdate(fileB, makeModel('B-new'));

    expect(useHistoryStore.getState().canRedoLastQuestBatch()).toBe(false);
    expect(useHistoryStore.getState().redoLastQuestBatch().ok).toBe(false);
    expect(valueOf(fileB)).toBe('B-new');
  });
});
