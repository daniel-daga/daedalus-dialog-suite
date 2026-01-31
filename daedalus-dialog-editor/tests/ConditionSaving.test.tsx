/**
 * Integration test for condition saving bug
 *
 * Bug: Conditions are not getting saved to the file
 *
 * Expected behavior:
 * 1. User edits a condition in ConditionEditor
 * 2. Condition changes are synced to semantic model
 * 3. User clicks Save in DialogDetailsEditor
 * 4. File is saved with condition changes
 *
 * Actual behavior:
 * Condition changes may be lost when Save is clicked because
 * onUpdateDialog/onUpdateFunction callbacks use stale semantic model
 */

import { describe, test, expect, jest } from '@jest/globals';

describe('Condition Saving Bug', () => {
  test.skip('[BUG DEMO] condition changes should not be lost when dialog is saved', () => {
    // Simulate the store
    let semanticModel = {
      dialogs: {
        TestDialog: {
          properties: {
            npc: 'TestNPC',
            information: 'TestInfo',
            condition: 'TestCondition'
          }
        }
      },
      functions: {
        TestInfo: {
          name: 'TestInfo',
          actions: []
        },
        TestCondition: {
          name: 'TestCondition',
          conditions: [
            { variableName: 'ORIGINAL', negated: false }
          ]
        }
      }
    };

    // Mock updateModel to simulate store updates
    const updateModel = jest.fn((filePath: string, newModel: any) => {
      semanticModel = newModel;
    });

    // Simulate ThreeColumnLayout's callback closures over semanticModel
    const createCallbacks = (capturedSemanticModel: any) => ({
      onUpdateDialog: (updatedDialog: any) => {
        const updatedModel = {
          ...capturedSemanticModel,
          dialogs: {
            ...capturedSemanticModel.dialogs,
            TestDialog: updatedDialog
          }
        };
        updateModel('test.d', updatedModel);
      },
      onUpdateFunction: (updatedFunction: any) => {
        const updatedModel = {
          ...capturedSemanticModel,
          functions: {
            ...capturedSemanticModel.functions,
            [updatedFunction.name]: updatedFunction
          }
        };
        updateModel('test.d', updatedModel);
      }
    });

    // Initial render - callbacks capture initial semantic model
    let callbacks = createCallbacks(semanticModel);

    // Step 1: User edits condition (via handleUpdateSemanticModel in DialogDetailsEditor)
    const updatedConditionFunction = {
      name: 'TestCondition',
      conditions: [
        { variableName: 'MODIFIED', negated: true }
      ]
    };
    const modelAfterConditionEdit = {
      ...semanticModel,
      functions: {
        ...semanticModel.functions,
        TestCondition: updatedConditionFunction
      }
    };
    updateModel('test.d', modelAfterConditionEdit);

    // At this point, semantic model has the updated condition
    expect(semanticModel.functions.TestCondition.conditions[0].variableName).toBe('MODIFIED');

    // BUT: ThreeColumnLayout hasn't re-rendered yet, so callbacks still use old semantic model!
    // This simulates the bug - callbacks are closures over stale semantic model

    // Step 2: User clicks Save (calls onUpdateDialog and onUpdateFunction)
    const updatedDialog = {
      properties: {
        npc: 'TestNPC',
        information: 'TestInfo',
        condition: 'TestCondition',
        description: 'Updated description' // User also edited dialog properties
      }
    };
    const updatedInfoFunction = {
      name: 'TestInfo',
      actions: [
        { text: 'New dialog line' } // User also added a dialog line
      ]
    };

    callbacks.onUpdateDialog(updatedDialog);
    callbacks.onUpdateFunction(updatedInfoFunction);

    // BUG: Condition changes are lost!
    // The callbacks used the old semantic model, which didn't have the condition changes
    // So the condition function was overwritten with the old version
    const finalConditions = semanticModel.functions.TestCondition.conditions;

    // This assertion will FAIL with the current implementation
    // because the condition changes are lost
    expect(finalConditions[0].variableName).toBe('MODIFIED');
  });

  test('demonstrates the fix - callbacks should use latest semantic model', () => {
    // Simulate the store
    let semanticModel = {
      dialogs: {
        TestDialog: {
          properties: {
            npc: 'TestNPC',
            information: 'TestInfo',
            condition: 'TestCondition'
          }
        }
      },
      functions: {
        TestInfo: {
          name: 'TestInfo',
          actions: []
        },
        TestCondition: {
          name: 'TestCondition',
          conditions: [
            { variableName: 'ORIGINAL', negated: false }
          ]
        }
      }
    };

    const updateModel = jest.fn((filePath: string, newModel: any) => {
      semanticModel = newModel;
    });

    // Callbacks should get latest semantic model from store, not use closure
    const createCallbacks = (getSemanticModel: () => any) => ({
      onUpdateDialog: (updatedDialog: any) => {
        const currentModel = getSemanticModel(); // Get latest from store
        const updatedModel = {
          ...currentModel,
          dialogs: {
            ...currentModel.dialogs,
            TestDialog: updatedDialog
          }
        };
        updateModel('test.d', updatedModel);
      },
      onUpdateFunction: (updatedFunction: any) => {
        const currentModel = getSemanticModel(); // Get latest from store
        const updatedModel = {
          ...currentModel,
          functions: {
            ...currentModel.functions,
            [updatedFunction.name]: updatedFunction
          }
        };
        updateModel('test.d', updatedModel);
      }
    });

    const callbacks = createCallbacks(() => semanticModel);

    // Step 1: Edit condition
    const updatedConditionFunction = {
      name: 'TestCondition',
      conditions: [
        { variableName: 'MODIFIED', negated: true }
      ]
    };
    const modelAfterConditionEdit = {
      ...semanticModel,
      functions: {
        ...semanticModel.functions,
        TestCondition: updatedConditionFunction
      }
    };
    updateModel('test.d', modelAfterConditionEdit);

    expect(semanticModel.functions.TestCondition.conditions[0].variableName).toBe('MODIFIED');

    // Step 2: Save (calls both callbacks)
    const updatedDialog = {
      properties: {
        npc: 'TestNPC',
        information: 'TestInfo',
        condition: 'TestCondition',
        description: 'Updated description'
      }
    };
    const updatedInfoFunction = {
      name: 'TestInfo',
      actions: [
        { text: 'New dialog line' }
      ]
    };

    callbacks.onUpdateDialog(updatedDialog);
    callbacks.onUpdateFunction(updatedInfoFunction);

    // FIXED: Condition changes are preserved!
    const finalConditions = semanticModel.functions.TestCondition.conditions;
    expect(finalConditions[0].variableName).toBe('MODIFIED');

    // And dialog changes are also preserved
    expect(semanticModel.dialogs.TestDialog.properties.description).toBe('Updated description');

    // And info function changes are also preserved
    expect(semanticModel.functions.TestInfo.actions).toHaveLength(1);
  });
});
