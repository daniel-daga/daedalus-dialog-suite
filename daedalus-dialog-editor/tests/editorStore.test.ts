/**
 * Tests for editorStore actions
 *
 * Testing the new updateDialog and updateFunction actions
 * that will replace prop drilling and callback patterns
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';

describe('EditorStore - updateDialog action', () => {
  beforeEach(() => {
    // Reset store before each test
    useEditorStore.setState({
      openFiles: new Map(),
      activeFile: null,
      selectedDialog: null,
      selectedAction: null,
      project: null,
      codeSettings: {
        indentChar: '\t',
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true,
      },
    });
  });

  test('should update dialog in semantic model and mark file as dirty', () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: {
        TestDialog: {
          properties: {
            npc: 'OldNPC',
            information: 'TestInfo'
          }
        }
      },
      functions: {}
    };

    // Setup initial file state
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date()
      }]])
    });

    // Update dialog
    const updatedDialog = {
      properties: {
        npc: 'NewNPC',
        information: 'TestInfo',
        description: 'Updated description'
      }
    };

    useEditorStore.getState().updateDialog(filePath, 'TestDialog', updatedDialog);

    // Verify dialog was updated
    const fileState = useEditorStore.getState().openFiles.get(filePath);
    expect(fileState?.semanticModel.dialogs.TestDialog).toEqual(updatedDialog);

    // Verify file is marked dirty
    expect(fileState?.isDirty).toBe(true);
  });

  test('should preserve other dialogs when updating one dialog', () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: {
        Dialog1: { properties: { npc: 'NPC1' } },
        Dialog2: { properties: { npc: 'NPC2' } }
      },
      functions: {}
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date()
      }]])
    });

    const updatedDialog = { properties: { npc: 'UpdatedNPC1' } };
    useEditorStore.getState().updateDialog(filePath, 'Dialog1', updatedDialog);

    const fileState = useEditorStore.getState().openFiles.get(filePath);
    expect(fileState?.semanticModel.dialogs.Dialog1).toEqual(updatedDialog);
    expect(fileState?.semanticModel.dialogs.Dialog2).toEqual({ properties: { npc: 'NPC2' } });
  });

  test('should handle updating non-existent file gracefully', () => {
    const updatedDialog = { properties: { npc: 'Test' } };

    // Should not throw
    expect(() => {
      useEditorStore.getState().updateDialog('nonexistent.d', 'Dialog', updatedDialog);
    }).not.toThrow();

    // File should not be created
    expect(useEditorStore.getState().openFiles.has('nonexistent.d')).toBe(false);
  });
});

describe('EditorStore - updateFunction action', () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map(),
      activeFile: null,
      selectedDialog: null,
      selectedAction: null,
      project: null,
      codeSettings: {
        indentChar: '\t',
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true,
      },
    });
  });

  test('should update function in semantic model and mark file as dirty', () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: {},
      functions: {
        TestFunc: {
          name: 'TestFunc',
          actions: []
        }
      }
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date()
      }]])
    });

    const updatedFunction = {
      name: 'TestFunc',
      actions: [{ text: 'New action' }]
    };

    useEditorStore.getState().updateFunction(filePath, 'TestFunc', updatedFunction);

    const fileState = useEditorStore.getState().openFiles.get(filePath);
    expect(fileState?.semanticModel.functions.TestFunc).toEqual(updatedFunction);
    expect(fileState?.isDirty).toBe(true);
  });

  test('should preserve other functions when updating one function', () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: {},
      functions: {
        Func1: { name: 'Func1', actions: [{ text: 'Action1' }] },
        Func2: { name: 'Func2', actions: [{ text: 'Action2' }] }
      }
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date()
      }]])
    });

    const updatedFunction = { name: 'Func1', actions: [{ text: 'Updated' }] };
    useEditorStore.getState().updateFunction(filePath, 'Func1', updatedFunction);

    const fileState = useEditorStore.getState().openFiles.get(filePath);
    expect(fileState?.semanticModel.functions.Func1).toEqual(updatedFunction);
    expect(fileState?.semanticModel.functions.Func2).toEqual({ name: 'Func2', actions: [{ text: 'Action2' }] });
  });

  test('should handle updating function in non-existent file gracefully', () => {
    const updatedFunction = { name: 'Test', actions: [] };

    expect(() => {
      useEditorStore.getState().updateFunction('nonexistent.d', 'Test', updatedFunction);
    }).not.toThrow();

    expect(useEditorStore.getState().openFiles.has('nonexistent.d')).toBe(false);
  });
});

describe('EditorStore - integration with existing actions', () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map(),
      activeFile: null,
      selectedDialog: null,
      selectedAction: null,
      project: null,
      codeSettings: {
        indentChar: '\t',
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true,
      },
    });
  });

  test('updateDialog and updateFunction should work together', () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: {
        TestDialog: { properties: { npc: 'NPC1', information: 'TestInfo' } }
      },
      functions: {
        TestInfo: { name: 'TestInfo', actions: [] }
      }
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date()
      }]])
    });

    // Update dialog
    useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
      properties: { npc: 'UpdatedNPC', information: 'TestInfo' }
    });

    // Update function
    useEditorStore.getState().updateFunction(filePath, 'TestInfo', {
      name: 'TestInfo',
      actions: [{ text: 'New line' }]
    });

    // Both should be updated
    const fileState = useEditorStore.getState().openFiles.get(filePath);
    expect(fileState?.semanticModel.dialogs.TestDialog.properties.npc).toBe('UpdatedNPC');
    expect(fileState?.semanticModel.functions.TestInfo.actions).toHaveLength(1);
    expect(fileState?.isDirty).toBe(true);
  });

  test('updateDialog and updateFunction should not conflict with updateModel', () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: { D1: { properties: { npc: 'NPC1' } } },
      functions: { F1: { name: 'F1', actions: [] } }
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date()
      }]])
    });

    // Use updateDialog
    useEditorStore.getState().updateDialog(filePath, 'D1', {
      properties: { npc: 'UpdatedNPC' }
    });

    // Then use updateModel (should still work)
    const newModel = {
      dialogs: { D1: { properties: { npc: 'UpdatedNPC' } }, D2: { properties: { npc: 'NPC2' } } },
      functions: { F1: { name: 'F1', actions: [] } }
    };
    useEditorStore.getState().updateModel(filePath, newModel);

    const fileState = useEditorStore.getState().openFiles.get(filePath);
    expect(fileState?.semanticModel.dialogs.D2).toBeDefined();
  });
});
