/**
 * Test suite for ValidationService - Validation Before Save Feature
 *
 * TDD: Tests use mocks for dependencies (ParserService, CodeGeneratorService)
 * to isolate ValidationService logic
 */

import { ValidationService } from '../src/main/services/ValidationService';

// Mock ParserService
const mockParseSource = jest.fn();
const mockParserService = {
  parseSource: mockParseSource
} as any;

// Mock CodeGeneratorService
const mockGenerateCode = jest.fn();
const mockCodeGeneratorService = {
  generateCode: mockGenerateCode
} as any;

describe('ValidationService', () => {
  let validationService: ValidationService;

  const defaultSettings = {
    indentChar: '\t' as const,
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
    validationService = new ValidationService(mockParserService, mockCodeGeneratorService);

    // Default successful behavior
    mockGenerateCode.mockReturnValue('// Generated code');
    mockParseSource.mockResolvedValue({
      dialogs: {},
      functions: {},
      hasErrors: false,
      errors: []
    });
  });

  describe('Syntax Validation (Round-trip parsing)', () => {
    test('should pass validation for valid semantic model', async () => {
      const validModel = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              npc: 'TestNpc',
              nr: 1
            }
          }
        },
        functions: {
          'DIA_Test_Condition': {
            name: 'DIA_Test_Condition',
            returnType: 'INT',
            actions: [],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      mockGenerateCode.mockReturnValue('FUNC INT DIA_Test_Condition() { return TRUE; };');
      mockParseSource.mockResolvedValue({ hasErrors: false, errors: [] });

      const result = await validationService.validate(validModel, defaultSettings);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(mockGenerateCode).toHaveBeenCalledWith(validModel, defaultSettings);
      expect(mockParseSource).toHaveBeenCalled();
    });

    test('should detect syntax errors from parser', async () => {
      const model = {
        dialogs: {},
        functions: {
          'BrokenFunc': {
            name: 'BrokenFunc',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      mockGenerateCode.mockReturnValue('FUNC VOID BrokenFunc() { broken };');
      mockParseSource.mockResolvedValue({
        hasErrors: true,
        errors: [
          { type: 'syntax_error', message: 'Unexpected token', position: { row: 0, column: 25 } }
        ]
      });

      const result = await validationService.validate(model, defaultSettings);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'syntax_error',
          message: expect.stringContaining('Unexpected token')
        })
      );
    });

    test('should handle code generation failure', async () => {
      const model = {
        dialogs: {},
        functions: {},
        hasErrors: false,
        errors: []
      };

      mockGenerateCode.mockImplementation(() => {
        throw new Error('Generation failed');
      });

      const result = await validationService.validate(model, defaultSettings);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'syntax_error',
          message: expect.stringContaining('Generation failed')
        })
      );
    });
  });

  describe('Duplicate Dialog Name Detection', () => {
    test('should detect duplicate dialog names', async () => {
      const modelWithDuplicates = {
        dialogs: {
          'DIA_Duplicate': {
            name: 'DIA_Duplicate',
            parent: 'C_INFO',
            properties: { npc: 'NPC1' }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const existingDialogs = ['DIA_Duplicate', 'DIA_Other'];
      const result = await validationService.validate(modelWithDuplicates, defaultSettings, {
        existingDialogs
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'duplicate_dialog',
          message: expect.stringContaining('DIA_Duplicate')
        })
      );
    });

    test('should pass when no duplicates exist', async () => {
      const model = {
        dialogs: {
          'DIA_Unique': {
            name: 'DIA_Unique',
            parent: 'C_INFO',
            properties: { npc: 'NPC1' }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const existingDialogs = ['DIA_Other', 'DIA_Another'];
      const result = await validationService.validate(model, defaultSettings, {
        existingDialogs
      });

      const duplicateErrors = result.errors.filter(e => e.type === 'duplicate_dialog');
      expect(duplicateErrors).toHaveLength(0);
    });

    test('should pass when no existing dialogs provided', async () => {
      const model = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: { npc: 'NPC1' }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(model, defaultSettings);

      const duplicateErrors = result.errors.filter(e => e.type === 'duplicate_dialog');
      expect(duplicateErrors).toHaveLength(0);
    });
  });

  describe('Missing Function Reference Detection', () => {
    test('should detect missing condition function reference (string)', async () => {
      const modelWithMissingRef = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              npc: 'TestNpc',
              condition: 'NonExistentCondition'
            }
          }
        },
        functions: {
          'DIA_Test_Info': {
            name: 'DIA_Test_Info',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(modelWithMissingRef, defaultSettings);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'missing_function',
          message: expect.stringContaining('NonExistentCondition')
        })
      );
    });

    test('should detect missing condition function reference (object)', async () => {
      const modelWithMissingRef = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              npc: 'TestNpc',
              condition: { name: 'NonExistentCondition', returnType: 'INT' }
            }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(modelWithMissingRef, defaultSettings);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'missing_function',
          message: expect.stringContaining('NonExistentCondition')
        })
      );
    });

    test('should detect missing information function reference', async () => {
      const modelWithMissingRef = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              npc: 'TestNpc',
              information: 'NonExistentInfo'
            }
          }
        },
        functions: {
          'DIA_Test_Condition': {
            name: 'DIA_Test_Condition',
            returnType: 'INT',
            actions: [],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(modelWithMissingRef, defaultSettings);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'missing_function',
          message: expect.stringContaining('NonExistentInfo')
        })
      );
    });

    test('should pass when all function references exist', async () => {
      const validModel = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              npc: 'TestNpc',
              condition: { name: 'DIA_Test_Condition', returnType: 'INT' },
              information: { name: 'DIA_Test_Info', returnType: 'VOID' }
            }
          }
        },
        functions: {
          'DIA_Test_Condition': {
            name: 'DIA_Test_Condition',
            returnType: 'INT',
            actions: [],
            conditions: [],
            calls: []
          },
          'DIA_Test_Info': {
            name: 'DIA_Test_Info',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(validModel, defaultSettings);

      const missingFuncErrors = result.errors.filter(e => e.type === 'missing_function');
      expect(missingFuncErrors).toHaveLength(0);
    });
  });

  describe('Required Properties Validation', () => {
    test('should detect missing required NPC property for C_INFO dialog', async () => {
      const modelWithMissingNpc = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              nr: 1
            }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(modelWithMissingNpc, defaultSettings);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'missing_required_property',
          message: expect.stringContaining('npc')
        })
      );
    });

    test('should pass when NPC property is present', async () => {
      const model = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              npc: 'TestNpc',
              nr: 1
            }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(model, defaultSettings);

      const missingPropErrors = result.errors.filter(e => e.type === 'missing_required_property');
      expect(missingPropErrors).toHaveLength(0);
    });

    test('should not require NPC for non-C_INFO dialogs', async () => {
      const model = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'OTHER_TYPE',
            properties: {
              nr: 1
            }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(model, defaultSettings);

      const missingPropErrors = result.errors.filter(e => e.type === 'missing_required_property');
      expect(missingPropErrors).toHaveLength(0);
    });
  });

  describe('Choice Target Validation', () => {
    test('should detect missing choice target function', async () => {
      const modelWithInvalidChoice = {
        dialogs: {},
        functions: {
          'DIA_Test_Info': {
            name: 'DIA_Test_Info',
            returnType: 'VOID',
            actions: [
              {
                dialogRef: 'DIA_Choice',
                text: 'Choose this',
                targetFunction: 'NonExistentTarget'
              }
            ],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(modelWithInvalidChoice, defaultSettings);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'missing_function',
          message: expect.stringContaining('NonExistentTarget')
        })
      );
    });

    test('should pass when choice target function exists', async () => {
      const model = {
        dialogs: {},
        functions: {
          'DIA_Test_Info': {
            name: 'DIA_Test_Info',
            returnType: 'VOID',
            actions: [
              {
                dialogRef: 'DIA_Choice',
                text: 'Choose this',
                targetFunction: 'DIA_Test_Choice1'
              }
            ],
            conditions: [],
            calls: []
          },
          'DIA_Test_Choice1': {
            name: 'DIA_Test_Choice1',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(model, defaultSettings);

      // No missing function errors for choice targets
      const choiceMissingErrors = result.errors.filter(
        e => e.type === 'missing_function' && e.message.includes('DIA_Test_Choice1')
      );
      expect(choiceMissingErrors).toHaveLength(0);
    });
  });

  describe('ValidationResult Structure', () => {
    test('should return proper validation result structure', async () => {
      const model = {
        dialogs: {},
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(model, defaultSettings);

      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    test('should include generated code in result', async () => {
      const model = {
        dialogs: {},
        functions: {
          'TestFunc': {
            name: 'TestFunc',
            returnType: 'VOID',
            actions: [],
            conditions: [],
            calls: []
          }
        },
        hasErrors: false,
        errors: []
      };

      mockGenerateCode.mockReturnValue('FUNC VOID TestFunc() {};');

      const result = await validationService.validate(model, defaultSettings);

      expect(result).toHaveProperty('generatedCode');
      expect(result.generatedCode).toBe('FUNC VOID TestFunc() {};');
    });
  });

  describe('Skip Validation Options', () => {
    test('should skip syntax validation when option is set', async () => {
      const model = {
        dialogs: {},
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(model, defaultSettings, {
        skipSyntaxValidation: true
      });

      expect(mockGenerateCode).toHaveBeenCalled();
      expect(mockParseSource).not.toHaveBeenCalled();
      expect(result.isValid).toBe(true);
    });
  });

  describe('Multiple Errors', () => {
    test('should collect all errors from different validation steps', async () => {
      const model = {
        dialogs: {
          'DIA_Test': {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: {
              // Missing npc
              condition: 'MissingCondition'
            }
          }
        },
        functions: {},
        hasErrors: false,
        errors: []
      };

      const result = await validationService.validate(model, defaultSettings);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);

      // Should have missing property error
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'missing_required_property' })
      );

      // Should have missing function error
      expect(result.errors).toContainEqual(
        expect.objectContaining({ type: 'missing_function' })
      );
    });
  });
});
