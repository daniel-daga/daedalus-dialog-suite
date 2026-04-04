import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
import * as historyActions from '../src/renderer/store/historyActions';
import type { SemanticModel } from '../src/renderer/types/global';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const filePath = 'C:/tmp/dialog.d';

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

const resetStores = () => {
  useFileStore.setState({
    openFiles: new Map([
      [filePath, {
        filePath,
        semanticModel: makeModel('initial'),
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
    questHistory: new Map(),
    questBatchHistory: { past: [], future: [] },
    questNodePositions: new Map(),
  });
};

const getModel = () =>
  useFileStore.getState().getFileState(filePath)?.semanticModel;

// ---------------------------------------------------------------------------
// updateFunction
// ---------------------------------------------------------------------------

describe('historyActions – updateFunction', () => {
  beforeEach(resetStores);

  it('pushes a snapshot before applying the update', () => {
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(false);

    historyActions.updateFunction(filePath, 'DIA_Test_Info', {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'DialogLine', text: 'modified', speaker: 'Hero', id: 'id_modified' }],
      conditions: [],
      calls: []
    });

    // Snapshot should have been pushed
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
    // The function should be updated
    expect(getModel()?.functions.DIA_Test_Info.actions[0]).toMatchObject({ text: 'modified' });
  });

  it('allows undoing the updateFunction call', () => {
    historyActions.updateFunction(filePath, 'DIA_Test_Info', {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'DialogLine', text: 'modified', speaker: 'Hero', id: 'id_modified' }],
      conditions: [],
      calls: []
    });

    useHistoryStore.getState().undo(filePath);

    expect(getModel()?.functions.DIA_Test_Info.actions[0]).toMatchObject({ text: 'initial' });
  });

  it('does not throw for a non-existent file', () => {
    expect(() => {
      historyActions.updateFunction('nonexistent.d', 'Func', {
        name: 'Func', returnType: 'VOID', actions: [], conditions: [], calls: []
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateDialog
// ---------------------------------------------------------------------------

describe('historyActions – updateDialog', () => {
  beforeEach(resetStores);

  it('pushes a snapshot and updates the dialog', () => {
    historyActions.updateDialog(filePath, 'DIA_Test', {
      properties: { npc: 'NewNPC', information: 'DIA_Test_Info' }
    });

    expect(getModel()?.dialogs.DIA_Test.properties.npc).toBe('NewNPC');
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });

  it('allows undoing the updateDialog call', () => {
    historyActions.updateDialog(filePath, 'DIA_Test', {
      properties: { npc: 'NewNPC', information: 'DIA_Test_Info' }
    });

    useHistoryStore.getState().undo(filePath);

    expect(getModel()?.dialogs.DIA_Test.properties.npc).toBe('initial');
  });
});

// ---------------------------------------------------------------------------
// updateFunctionWithUpdater
// ---------------------------------------------------------------------------

describe('historyActions – updateFunctionWithUpdater', () => {
  beforeEach(resetStores);

  it('pushes a snapshot and applies the updater', () => {
    historyActions.updateFunctionWithUpdater(filePath, 'DIA_Test_Info', (fn) => ({
      ...fn,
      actions: [{ type: 'DialogLine', text: 'from updater', speaker: 'Hero', id: 'x' }]
    }));

    expect(getModel()?.functions.DIA_Test_Info.actions[0]).toMatchObject({ text: 'from updater' });
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });

  it('allows undoing the updater result', () => {
    historyActions.updateFunctionWithUpdater(filePath, 'DIA_Test_Info', (fn) => ({
      ...fn,
      actions: [{ type: 'DialogLine', text: 'from updater', speaker: 'Hero', id: 'x' }]
    }));

    useHistoryStore.getState().undo(filePath);

    expect(getModel()?.functions.DIA_Test_Info.actions[0]).toMatchObject({ text: 'initial' });
  });
});

// ---------------------------------------------------------------------------
// updateDialogWithNormalizedProperties
// ---------------------------------------------------------------------------

describe('historyActions – updateDialogWithNormalizedProperties', () => {
  beforeEach(resetStores);

  it('pushes a snapshot and applies the updater', () => {
    historyActions.updateDialogWithNormalizedProperties(filePath, 'DIA_Test', (dialog) => ({
      ...dialog,
      properties: { ...dialog.properties, npc: 'NormalizedNPC' }
    }));

    expect(getModel()?.dialogs.DIA_Test.properties.npc).toBe('NormalizedNPC');
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renameFunction
// ---------------------------------------------------------------------------

describe('historyActions – renameFunction', () => {
  beforeEach(resetStores);

  it('pushes a snapshot and renames the function', () => {
    historyActions.renameFunction(filePath, 'DIA_Test_Info', 'DIA_Test_Info_Renamed');

    expect(getModel()?.functions['DIA_Test_Info_Renamed']).toBeDefined();
    expect(getModel()?.functions['DIA_Test_Info']).toBeUndefined();
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });

  it('allows undoing the rename', () => {
    historyActions.renameFunction(filePath, 'DIA_Test_Info', 'DIA_Test_Info_Renamed');
    useHistoryStore.getState().undo(filePath);

    expect(getModel()?.functions['DIA_Test_Info']).toBeDefined();
    expect(getModel()?.functions['DIA_Test_Info_Renamed']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateModel
// ---------------------------------------------------------------------------

describe('historyActions – updateModel', () => {
  beforeEach(resetStores);

  it('pushes a snapshot and replaces the entire model', () => {
    const newModel = makeModel('replaced');

    historyActions.updateModel(filePath, newModel);

    expect(getModel()?.dialogs.DIA_Test.properties.npc).toBe('replaced');
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });

  it('allows undoing the full model replacement', () => {
    historyActions.updateModel(filePath, makeModel('replaced'));
    useHistoryStore.getState().undo(filePath);

    expect(getModel()?.dialogs.DIA_Test.properties.npc).toBe('initial');
  });
});

// ---------------------------------------------------------------------------
// Snapshot isolation: mutations receive a deep clone, not a reference
// ---------------------------------------------------------------------------

describe('historyActions – snapshot isolation', () => {
  beforeEach(resetStores);

  it('snapshot model is independent of subsequent mutations', () => {
    // Push snapshot, then mutate
    historyActions.updateFunction(filePath, 'DIA_Test_Info', {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{ type: 'DialogLine', text: 'modified', speaker: 'Hero', id: 'x' }],
      conditions: [],
      calls: []
    });

    // The snapshot captured the 'initial' state; undo should restore it
    useHistoryStore.getState().undo(filePath);
    expect(getModel()?.functions.DIA_Test_Info.actions[0]).toMatchObject({ text: 'initial' });

    // Redo should bring back 'modified'
    useHistoryStore.getState().redo(filePath);
    expect(getModel()?.functions.DIA_Test_Info.actions[0]).toMatchObject({ text: 'modified' });
  });
});
