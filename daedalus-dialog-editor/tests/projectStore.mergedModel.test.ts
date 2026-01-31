/**
 * Test suite for projectStore merged semantic model functionality
 *
 * Tests that the store properly:
 * - Merges semantic models from multiple files
 * - Caches merged models per NPC
 * - Handles model updates and invalidation
 * - Clears cache appropriately
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { useProjectStore } from '../src/renderer/store/projectStore';

describe('projectStore - merged semantic model', () => {
  beforeEach(() => {
    // Reset store before each test
    useProjectStore.getState().closeProject();
  });

  describe('mergeSemanticModels', () => {
    test('should merge dialogs from multiple semantic models', () => {
      const model1 = {
        dialogs: { DIA_Test1: { name: 'DIA_Test1' } },
        functions: { Func1: { name: 'Func1' } },
        constants: {},
        instances: {}
      };

      const model2 = {
        dialogs: { DIA_Test2: { name: 'DIA_Test2' } },
        functions: { Func2: { name: 'Func2' } },
        constants: {},
        instances: {}
      };

      useProjectStore.getState().mergeSemanticModels([model1, model2]);

      const merged = useProjectStore.getState().mergedSemanticModel;

      expect(merged.dialogs).toEqual({
        DIA_Test1: { name: 'DIA_Test1' },
        DIA_Test2: { name: 'DIA_Test2' }
      });
      expect(merged.functions).toEqual({
        Func1: { name: 'Func1' },
        Func2: { name: 'Func2' }
      });
    });

    test('should handle models with overlapping keys (last wins)', () => {
      const model1 = {
        dialogs: { DIA_Test: { name: 'DIA_Test', version: 1 } },
        functions: {},
        constants: {},
        instances: {}
      };

      const model2 = {
        dialogs: { DIA_Test: { name: 'DIA_Test', version: 2 } },
        functions: {},
        constants: {},
        instances: {}
      };

      useProjectStore.getState().mergeSemanticModels([model1, model2]);

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs.DIA_Test.version).toBe(2);
    });

    test('should handle empty model array', () => {
      useProjectStore.getState().mergeSemanticModels([]);

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toEqual({});
      expect(merged.functions).toEqual({});
    });

    test('should skip models with hasErrors flag', () => {
      const validModel = {
        dialogs: { DIA_Valid: { name: 'DIA_Valid' } },
        functions: {},
        constants: {},
        instances: {},
        hasErrors: false
      };

      const errorModel = {
        dialogs: { DIA_Error: { name: 'DIA_Error' } },
        functions: {},
        constants: {},
        instances: {},
        hasErrors: true,
        errors: [{ message: 'Syntax error' }]
      };

      useProjectStore.getState().mergeSemanticModels([validModel, errorModel]);

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toEqual({
        DIA_Valid: { name: 'DIA_Valid' }
      });
      expect(merged.dialogs.DIA_Error).toBeUndefined();
      expect(merged.hasErrors).toBe(true);
    });

    test('should aggregate errors from all models', () => {
      const model1 = {
        dialogs: {},
        functions: {},
        constants: {},
        instances: {},
        hasErrors: true,
        errors: [{ message: 'Error 1' }]
      };

      const model2 = {
        dialogs: {},
        functions: {},
        constants: {},
        instances: {},
        hasErrors: true,
        errors: [{ message: 'Error 2' }]
      };

      useProjectStore.getState().mergeSemanticModels([model1, model2]);

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.hasErrors).toBe(true);
      expect(merged.errors).toHaveLength(2);
      expect(merged.errors[0].message).toBe('Error 1');
      expect(merged.errors[1].message).toBe('Error 2');
    });

    test('should merge constants and instances', () => {
      const model1 = {
        dialogs: {},
        functions: {},
        constants: { CONST1: 'value1' },
        instances: { INST1: { name: 'INST1' } }
      };

      const model2 = {
        dialogs: {},
        functions: {},
        constants: { CONST2: 'value2' },
        instances: { INST2: { name: 'INST2' } }
      };

      useProjectStore.getState().mergeSemanticModels([model1, model2]);

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.constants).toEqual({
        CONST1: 'value1',
        CONST2: 'value2'
      });
      expect(merged.instances).toEqual({
        INST1: { name: 'INST1' },
        INST2: { name: 'INST2' }
      });
    });
  });

  describe('loadAndMergeNpcModels', () => {
    test('should load and merge models for selected NPC', () => {
      // Mock dialog index with 2 files for one NPC
      const mockDialogIndex = new Map([
        ['SLD_Farim', [
          { dialogName: 'DIA_Farim_1', npc: 'SLD_Farim', filePath: '/path/to/file1.d' },
          { dialogName: 'DIA_Farim_2', npc: 'SLD_Farim', filePath: '/path/to/file2.d' }
        ]]
      ]);

      // Mock parsed files cache
      const mockParsedFiles = new Map([
        ['/path/to/file1.d', {
          filePath: '/path/to/file1.d',
          semanticModel: {
            dialogs: { DIA_Farim_1: { name: 'DIA_Farim_1' } },
            functions: { Func1: { name: 'Func1' } },
            constants: {},
            instances: {}
          },
          lastParsed: new Date()
        }],
        ['/path/to/file2.d', {
          filePath: '/path/to/file2.d',
          semanticModel: {
            dialogs: { DIA_Farim_2: { name: 'DIA_Farim_2' } },
            functions: { Func2: { name: 'Func2' } },
            constants: {},
            instances: {}
          },
          lastParsed: new Date()
        }]
      ]);

      // Set up store state
      useProjectStore.setState({
        dialogIndex: mockDialogIndex,
        parsedFiles: mockParsedFiles,
        selectedNpc: 'SLD_Farim'
      });

      // Load and merge
      useProjectStore.getState().loadAndMergeNpcModels('SLD_Farim');

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toEqual({
        DIA_Farim_1: { name: 'DIA_Farim_1' },
        DIA_Farim_2: { name: 'DIA_Farim_2' }
      });
      expect(merged.functions).toEqual({
        Func1: { name: 'Func1' },
        Func2: { name: 'Func2' }
      });
    });

    test('should handle NPC with no dialogs', () => {
      const mockDialogIndex = new Map([
        ['EmptyNPC', []]
      ]);

      useProjectStore.setState({
        dialogIndex: mockDialogIndex
      });

      useProjectStore.getState().loadAndMergeNpcModels('EmptyNPC');

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toEqual({});
    });

    test('should handle unknown NPC', () => {
      useProjectStore.setState({
        dialogIndex: new Map()
      });

      useProjectStore.getState().loadAndMergeNpcModels('UnknownNPC');

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged).toBeDefined();
      expect(merged.dialogs).toEqual({});
    });
  });

  describe('clearMergedModel', () => {
    test('should clear merged semantic model', () => {
      // Set up a merged model
      const model = {
        dialogs: { DIA_Test: { name: 'DIA_Test' } },
        functions: {},
        constants: {},
        instances: {}
      };

      useProjectStore.getState().mergeSemanticModels([model]);

      expect(useProjectStore.getState().mergedSemanticModel.dialogs.DIA_Test).toBeDefined();

      // Clear it
      useProjectStore.getState().clearMergedModel();

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toEqual({});
      expect(merged.functions).toEqual({});
    });
  });

  describe('closeProject', () => {
    test('should clear merged model when closing project', () => {
      const model = {
        dialogs: { DIA_Test: { name: 'DIA_Test' } },
        functions: {},
        constants: {},
        instances: {}
      };

      useProjectStore.getState().mergeSemanticModels([model]);
      useProjectStore.getState().closeProject();

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toEqual({});
    });
  });

  describe('integration with selectNpc', () => {
    test('should update merged model when NPC is selected', () => {
      // Mock setup
      const mockDialogIndex = new Map([
        ['NPC1', [
          { dialogName: 'DIA_1', npc: 'NPC1', filePath: '/file1.d' }
        ]],
        ['NPC2', [
          { dialogName: 'DIA_2', npc: 'NPC2', filePath: '/file2.d' }
        ]]
      ]);

      const mockParsedFiles = new Map([
        ['/file1.d', {
          filePath: '/file1.d',
          semanticModel: {
            dialogs: { DIA_1: { name: 'DIA_1', npc: 'NPC1' } },
            functions: {},
            constants: {},
            instances: {}
          },
          lastParsed: new Date()
        }],
        ['/file2.d', {
          filePath: '/file2.d',
          semanticModel: {
            dialogs: { DIA_2: { name: 'DIA_2', npc: 'NPC2' } },
            functions: {},
            constants: {},
            instances: {}
          },
          lastParsed: new Date()
        }]
      ]);

      useProjectStore.setState({
        dialogIndex: mockDialogIndex,
        parsedFiles: mockParsedFiles
      });

      // Select NPC1
      useProjectStore.getState().selectNpc('NPC1');
      useProjectStore.getState().loadAndMergeNpcModels('NPC1');

      expect(useProjectStore.getState().mergedSemanticModel.dialogs.DIA_1).toBeDefined();
      expect(useProjectStore.getState().mergedSemanticModel.dialogs.DIA_2).toBeUndefined();

      // Select NPC2
      useProjectStore.getState().selectNpc('NPC2');
      useProjectStore.getState().loadAndMergeNpcModels('NPC2');

      expect(useProjectStore.getState().mergedSemanticModel.dialogs.DIA_1).toBeUndefined();
      expect(useProjectStore.getState().mergedSemanticModel.dialogs.DIA_2).toBeDefined();
    });
  });
});
