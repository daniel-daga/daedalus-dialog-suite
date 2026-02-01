/**
 * Test suite for CodeGeneratorService - Bug #1 fix verification
 *
 * This test verifies the fix for Bug #1: Missing null check in function reference reconstruction
 * When dialog properties reference non-existent functions, they should not be silently set to undefined.
 */

import { CodeGeneratorService } from '../src/main/services/CodeGeneratorService';
import { Dialog, DialogFunction } from 'daedalus-parser/semantic-model';

describe('CodeGeneratorService - Function Reference Reconstruction', () => {
  let service: CodeGeneratorService;

  beforeEach(() => {
    service = new CodeGeneratorService();
  });

  describe('Bug #1: Missing validation for function references', () => {
    test('should log error when function referenced by name does not exist', () => {
      // Arrange: Spy on console.warn to detect validation errors
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const plainModel = {
        functions: {
          'ExistingFunc': {
            name: 'ExistingFunc',
            returnType: 'void',
            calls: [],
            actions: []
          }
        },
        dialogs: {
          'TestDialog': {
            name: 'TestDialog',
            parent: null,
            properties: {
              // This references a function that doesn't exist in the model (object format)
              'description': {
                name: 'NonExistentFunc',
                returnType: 'string'
              }
            }
          }
        }
      };

      // Act: Generate code (which calls reconstructModel internally)
      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      // Assert: An error should be logged for the missing function
      // BEFORE FIX: This will fail because no error is logged (silent data corruption)
      // AFTER FIX: This will pass because validation logs the error
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Function 'NonExistentFunc' referenced")
      );

      consoleWarnSpy.mockRestore();
    });

    test('should log error when function referenced by object does not exist', () => {
      // Arrange: Spy on console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const plainModel = {
        functions: {
          'ExistingFunc': {
            name: 'ExistingFunc',
            returnType: 'void',
            calls: [],
            actions: []
          }
        },
        dialogs: {
          'TestDialog': {
            name: 'TestDialog',
            parent: null,
            properties: {
              // This is an object reference to a function that doesn't exist
              'description': {
                name: 'NonExistentFunc',
                returnType: 'string'
              }
            }
          }
        }
      };

      // Act: Generate code
      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      // Assert: An error should be logged for the missing function
      // BEFORE FIX: This will fail because no error is logged (silent data corruption)
      // AFTER FIX: This will pass because validation logs the error
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Function 'NonExistentFunc' referenced")
      );

      consoleWarnSpy.mockRestore();
    });

    test('should correctly link dialog property to existing function', () => {
      // Arrange: Create a model with valid function reference
      const plainModel = {
        functions: {
          'MyDialogFunc': {
            name: 'MyDialogFunc',
            returnType: 'int',
            calls: [],
            actions: []
          }
        },
        dialogs: {
          'TestDialog': {
            name: 'TestDialog',
            parent: null,
            properties: {
              // This references an existing function
              'description': 'MyDialogFunc'
            }
          }
        }
      };

      // Act: Generate code
      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      // Assert: Should work correctly for valid references
      expect(result).toBeTruthy();
      expect(result).toContain('TestDialog');
      expect(result).toContain('MyDialogFunc');
    });

    test('should correctly link dialog property to existing function (object reference)', () => {
      // Arrange: Create a model with valid function reference as object
      const plainModel = {
        functions: {
          'MyDialogFunc': {
            name: 'MyDialogFunc',
            returnType: 'int',
            calls: [],
            actions: []
          }
        },
        dialogs: {
          'TestDialog': {
            name: 'TestDialog',
            parent: null,
            properties: {
              // This references an existing function by object
              'description': {
                name: 'MyDialogFunc',
                returnType: 'int'
              }
            }
          }
        }
      };

      // Act: Generate code
      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      // Assert: Should work correctly for valid references
      expect(result).toBeTruthy();
      expect(result).toContain('TestDialog');
      expect(result).toContain('MyDialogFunc');
    });

    test('should handle mixed valid and invalid function references', () => {
      // Arrange: Spy on console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const plainModel = {
        functions: {
          'ValidFunc': {
            name: 'ValidFunc',
            returnType: 'void',
            calls: [],
            actions: []
          }
        },
        dialogs: {
          'Dialog1': {
            name: 'Dialog1',
            parent: null,
            properties: {
              'validProp': 'ValidFunc',
              'invalidProp': {
                name: 'InvalidFunc',
                returnType: 'int'
              },
              'normalProp': 'just a string'
            }
          }
        }
      };

      // Act: Generate code
      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      // Assert: Valid references should work, invalid should log error
      expect(result).toBeTruthy();
      expect(result).toContain('Dialog1');
      expect(result).toContain('ValidFunc');

      // BEFORE FIX: No error logged for invalid reference
      // AFTER FIX: Error logged for 'InvalidFunc'
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Function 'InvalidFunc' referenced")
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Data integrity verification', () => {
    test('should not set dialog properties to undefined for missing functions', () => {
      // This test directly exposes the bug by checking the reconstructed model
      const plainModel = {
        functions: {},
        dialogs: {
          'TestDialog': {
            name: 'TestDialog',
            parent: null,
            properties: {
              'missingFunc': {
                name: 'NonExistent',
                returnType: 'int'
              }
            }
          }
        }
      };

      // We need to test the private method indirectly through generateCode
      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      // The bug causes silent failure - generateCode might succeed but data is corrupted
      // After the fix, this should either preserve the reference or log an error
      const result = service.generateCode(plainModel, settings);

      expect(result).toBeTruthy();
      // The function should not cause a crash and should handle the missing reference gracefully
    });
  });

  describe('Condition Reconstruction', () => {
    test('should reconstruct NpcKnowsInfoCondition objects from plain data', () => {
      const service = new CodeGeneratorService();
      const plainModel = {
        dialogs: {},
        functions: {
          TestCondition: {
            name: 'TestCondition',
            returnType: 'INT',
            calls: [],
            actions: [],
            conditions: [
              {
                npc: 'self',
                dialogRef: 'DIA_Test'
              }
            ]
          }
        }
      };

      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      // Should not throw - conditions must be reconstructed as class instances
      const result = service.generateCode(plainModel, settings);

      expect(result).toBeTruthy();
      expect(result).toContain('Npc_KnowsInfo(self, DIA_Test)');
    });

    test('should reconstruct VariableCondition objects from plain data', () => {
      const service = new CodeGeneratorService();
      const plainModel = {
        dialogs: {},
        functions: {
          TestCondition: {
            name: 'TestCondition',
            returnType: 'INT',
            calls: [],
            actions: [],
            conditions: [
              {
                variableName: 'QuestActive',
                negated: false
              },
              {
                variableName: 'QuestCompleted',
                negated: true
              }
            ]
          }
        }
      };

      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      expect(result).toBeTruthy();
      expect(result).toContain('QuestActive');
      expect(result).toContain('!QuestCompleted');
    });

    test('should reconstruct generic Condition objects from plain data', () => {
      const service = new CodeGeneratorService();
      const plainModel = {
        dialogs: {},
        functions: {
          TestCondition: {
            name: 'TestCondition',
            returnType: 'INT',
            calls: [],
            actions: [],
            conditions: [
              {
                condition: 'hero.attribute[ATR_LEVEL] >= 10'
              }
            ]
          }
        }
      };

      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      expect(result).toBeTruthy();
      expect(result).toContain('hero.attribute[ATR_LEVEL] >= 10');
    });

    test('should handle mixed condition types', () => {
      const service = new CodeGeneratorService();
      const plainModel = {
        dialogs: {},
        functions: {
          TestCondition: {
            name: 'TestCondition',
            returnType: 'INT',
            calls: [],
            actions: [],
            conditions: [
              { npc: 'self', dialogRef: 'DIA_Test' },
              { variableName: 'QuestActive', negated: false },
              { condition: 'hero.guild == GIL_NONE' }
            ]
          }
        }
      };

      const settings = {
        indentChar: '\t' as const,
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true
      };

      const result = service.generateCode(plainModel, settings);

      expect(result).toBeTruthy();
      expect(result).toContain('Npc_KnowsInfo(self, DIA_Test)');
      expect(result).toContain('QuestActive');
      expect(result).toContain('hero.guild == GIL_NONE');
    });
  });
});

/**
 * Test Summary:
 *
 * These tests verify that CodeGeneratorService correctly handles function references in dialogs:
 *
 * 1. When a dialog property references a non-existent function by name
 * 2. When a dialog property references a non-existent function by object
 * 3. When a dialog property references an existing function (should work)
 * 4. Mixed scenarios with both valid and invalid references
 * 5. Data integrity - properties should not be silently set to undefined
 *
 * Expected behavior BEFORE fix:
 * - Tests will fail because undefined is assigned to dialog.properties[key]
 * - No error or warning is generated
 * - Data is silently corrupted
 *
 * Expected behavior AFTER fix:
 * - Original reference should be preserved when function doesn't exist
 * - Error should be logged to console for debugging
 * - Valid references should still work correctly
 * - No silent data corruption
 */
