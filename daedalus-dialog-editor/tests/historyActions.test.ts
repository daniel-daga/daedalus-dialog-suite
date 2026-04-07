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

// ---------------------------------------------------------------------------
// removeDialog
// ---------------------------------------------------------------------------

describe('historyActions – removeDialog', () => {
  beforeEach(resetStores);

  it('pushes a snapshot and removes the dialog and its function', () => {
    historyActions.removeDialog(filePath, 'DIA_Test');

    expect(getModel()?.dialogs['DIA_Test']).toBeUndefined();
    expect(getModel()?.functions['DIA_Test_Info']).toBeUndefined();
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });

  it('allows undoing the removal', () => {
    historyActions.removeDialog(filePath, 'DIA_Test');
    useHistoryStore.getState().undo(filePath);

    expect(getModel()?.dialogs['DIA_Test']).toBeDefined();
    expect(getModel()?.functions['DIA_Test_Info']).toBeDefined();
  });

  it('does not delete a function shared by another dialog', () => {
    // Set up model where DIA_Test2 also uses DIA_Test_Info
    useFileStore.setState({
      openFiles: new Map([
        [filePath, {
          filePath,
          semanticModel: {
            dialogs: {
              DIA_Test: { properties: { npc: 'NPC', information: 'DIA_Test_Info' } },
              DIA_Test2: { properties: { npc: 'NPC', information: 'DIA_Test_Info' } },
            },
            functions: {
              DIA_Test_Info: { name: 'DIA_Test_Info', returnType: 'VOID', actions: [], conditions: [], calls: [] },
            },
            constants: {},
            variables: {},
            instances: {},
            hasErrors: false,
            errors: [],
          },
          isDirty: false,
          lastSaved: new Date(),
          originalCode: '',
          workingCode: '',
          hasErrors: false,
          errors: [],
        }]
      ]),
      activeFile: filePath,
    });

    historyActions.removeDialog(filePath, 'DIA_Test');

    // DIA_Test_Info is still referenced by DIA_Test2, so it should NOT be deleted
    expect(getModel()?.functions['DIA_Test_Info']).toBeDefined();
    expect(getModel()?.dialogs['DIA_Test']).toBeUndefined();
    expect(getModel()?.dialogs['DIA_Test2']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// renameDialog
// ---------------------------------------------------------------------------

describe('historyActions – renameDialog', () => {
  beforeEach(() => {
    useFileStore.setState({
      openFiles: new Map([
        [filePath, {
          filePath,
          semanticModel: {
            dialogs: {
              DIA_Npc_Hello: {
                name: 'DIA_Npc_Hello',
                parent: 'C_INFO',
                properties: {
                  npc: 'NPC_Npc',
                  information: 'DIA_Npc_Hello_Info',
                  condition: 'DIA_Npc_Hello_Condition',
                },
              },
            },
            functions: {
              DIA_Npc_Hello_Info: {
                name: 'DIA_Npc_Hello_Info',
                returnType: 'VOID',
                actions: [],
                conditions: [],
                calls: [],
              },
              DIA_Npc_Hello_Condition: {
                name: 'DIA_Npc_Hello_Condition',
                returnType: 'int',
                actions: [],
                conditions: [],
                calls: [],
              },
            },
            constants: {},
            variables: {},
            instances: {},
            hasErrors: false,
            errors: [],
          },
          isDirty: false,
          lastSaved: new Date(),
          originalCode: '',
          workingCode: '',
          hasErrors: false,
          errors: [],
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
  });

  it('pushes a snapshot and renames the dialog and cascade functions', () => {
    historyActions.renameDialog(filePath, 'DIA_Npc_Hello', 'DIA_Npc_Greeting', true);

    expect(getModel()?.dialogs['DIA_Npc_Hello']).toBeUndefined();
    expect(getModel()?.dialogs['DIA_Npc_Greeting']).toBeDefined();
    expect(getModel()?.functions['DIA_Npc_Hello_Info']).toBeUndefined();
    expect(getModel()?.functions['DIA_Npc_Greeting_Info']).toBeDefined();
    expect(getModel()?.functions['DIA_Npc_Hello_Condition']).toBeUndefined();
    expect(getModel()?.functions['DIA_Npc_Greeting_Condition']).toBeDefined();
    expect(useHistoryStore.getState().canUndo(filePath)).toBe(true);
  });

  it('updates the dialog property references to renamed functions', () => {
    historyActions.renameDialog(filePath, 'DIA_Npc_Hello', 'DIA_Npc_Greeting', true);

    const renamedDialog = getModel()?.dialogs['DIA_Npc_Greeting'];
    expect(renamedDialog?.properties?.information).toBe('DIA_Npc_Greeting_Info');
    expect(renamedDialog?.properties?.condition).toBe('DIA_Npc_Greeting_Condition');
  });

  it('allows undoing the rename', () => {
    historyActions.renameDialog(filePath, 'DIA_Npc_Hello', 'DIA_Npc_Greeting', true);
    useHistoryStore.getState().undo(filePath);

    expect(getModel()?.dialogs['DIA_Npc_Hello']).toBeDefined();
    expect(getModel()?.dialogs['DIA_Npc_Greeting']).toBeUndefined();
    expect(getModel()?.functions['DIA_Npc_Hello_Info']).toBeDefined();
    expect(getModel()?.functions['DIA_Npc_Greeting_Info']).toBeUndefined();
  });
});
