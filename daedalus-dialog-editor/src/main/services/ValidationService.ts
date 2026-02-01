import type { ParserService } from './ParserService';
import type { CodeGeneratorService } from './CodeGeneratorService';

/**
 * Validation error types
 */
export type ValidationErrorType =
  | 'syntax_error'
  | 'duplicate_dialog'
  | 'missing_function'
  | 'missing_required_property'
  | 'circular_dependency';

/**
 * A single validation error
 */
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  dialogName?: string;
  functionName?: string;
  position?: { row: number; column: number };
}

/**
 * A validation warning (non-blocking)
 */
export interface ValidationWarning {
  type: string;
  message: string;
  dialogName?: string;
  functionName?: string;
}

/**
 * Options for validation context
 */
export interface ValidationOptions {
  /** Existing dialog names in the project (for duplicate detection) */
  existingDialogs?: string[];
  /** Skip syntax validation (round-trip parsing) */
  skipSyntaxValidation?: boolean;
}

/**
 * Result of validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  generatedCode?: string;
}

/**
 * Code generation settings
 */
interface CodeGeneratorSettings {
  indentChar: '\t' | ' ';
  includeComments: boolean;
  sectionHeaders: boolean;
  uppercaseKeywords: boolean;
}

/**
 * ValidationService - Validates semantic models before saving
 *
 * Performs the following validations:
 * 1. Syntax validation - generates code and parses it back to detect syntax errors
 * 2. Duplicate dialog name detection
 * 3. Missing function reference detection
 * 4. Required property validation
 * 5. Choice target function validation
 */
export class ValidationService {
  private parserService: ParserService;
  private codeGeneratorService: CodeGeneratorService;

  constructor(parserService: ParserService, codeGeneratorService: CodeGeneratorService) {
    this.parserService = parserService;
    this.codeGeneratorService = codeGeneratorService;
  }

  /**
   * Validate a semantic model before saving
   */
  async validate(
    model: any,
    settings: CodeGeneratorSettings,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let generatedCode: string | undefined;

    // Step 1: Generate code
    try {
      generatedCode = this.codeGeneratorService.generateCode(model, settings);
    } catch (error) {
      errors.push({
        type: 'syntax_error',
        message: `Code generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      return { isValid: false, errors, warnings };
    }

    // Step 2: Syntax validation via round-trip parsing
    if (!options.skipSyntaxValidation) {
      const syntaxErrors = await this.validateSyntax(generatedCode);
      errors.push(...syntaxErrors);
    }

    // Step 3: Duplicate dialog detection
    const duplicateErrors = this.validateDuplicateDialogs(model, options.existingDialogs);
    errors.push(...duplicateErrors);

    // Compute function names set once for multiple validations
    const functionNames = new Set<string>(Object.keys(model.functions || {}));

    // Step 4: Missing function reference detection
    const missingFuncErrors = this.validateFunctionReferences(model, functionNames);
    errors.push(...missingFuncErrors);

    // Step 5: Required property validation
    const requiredPropErrors = this.validateRequiredProperties(model);
    errors.push(...requiredPropErrors);

    // Step 6: Choice target validation
    const choiceErrors = this.validateChoiceTargets(model, functionNames);
    errors.push(...choiceErrors);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      generatedCode
    };
  }

  /**
   * Validate generated code by parsing it back
   */
  private async validateSyntax(code: string): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    try {
      const parseResult = await this.parserService.parseSource(code);

      if (parseResult.hasErrors && parseResult.errors) {
        for (const parseError of parseResult.errors) {
          errors.push({
            type: 'syntax_error',
            message: parseError.message || 'Syntax error in generated code',
            position: parseError.position
          });
        }
      }
    } catch (error) {
      errors.push({
        type: 'syntax_error',
        message: `Failed to parse generated code: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    return errors;
  }

  /**
   * Check for duplicate dialog names
   */
  private validateDuplicateDialogs(
    model: any,
    existingDialogs?: string[]
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!existingDialogs || existingDialogs.length === 0) {
      return errors;
    }

    const existingSet = new Set(existingDialogs);

    for (const dialogName in model.dialogs) {
      if (existingSet.has(dialogName)) {
        errors.push({
          type: 'duplicate_dialog',
          message: `Dialog '${dialogName}' already exists in the project`,
          dialogName
        });
      }
    }

    return errors;
  }

  /**
   * Check for missing function references in dialogs
   */
  private validateFunctionReferences(model: any, functionNames: Set<string>): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const dialogName in model.dialogs) {
      const dialog = model.dialogs[dialogName];
      const props = dialog.properties || {};

      // Check condition reference
      if (props.condition) {
        const conditionName = this.extractFunctionName(props.condition);
        if (conditionName && !functionNames.has(conditionName)) {
          errors.push({
            type: 'missing_function',
            message: `Dialog '${dialogName}' references missing condition function '${conditionName}'`,
            dialogName,
            functionName: conditionName
          });
        }
      }

      // Check information reference
      if (props.information) {
        const infoName = this.extractFunctionName(props.information);
        if (infoName && !functionNames.has(infoName)) {
          errors.push({
            type: 'missing_function',
            message: `Dialog '${dialogName}' references missing information function '${infoName}'`,
            dialogName,
            functionName: infoName
          });
        }
      }
    }

    return errors;
  }

  /**
   * Extract function name from property value (could be string or object)
   */
  private extractFunctionName(value: any): string | null {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && value !== null && 'name' in value) {
      return value.name;
    }
    return null;
  }

  /**
   * Validate required properties for dialogs
   */
  private validateRequiredProperties(model: any): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const dialogName in model.dialogs) {
      const dialog = model.dialogs[dialogName];
      const props = dialog.properties || {};

      // NPC is required for C_INFO dialogs
      if (dialog.parent === 'C_INFO' && !props.npc) {
        errors.push({
          type: 'missing_required_property',
          message: `Dialog '${dialogName}' is missing required property 'npc'`,
          dialogName
        });
      }
    }

    return errors;
  }

  /**
   * Validate choice action target functions
   */
  private validateChoiceTargets(model: any, functionNames: Set<string>): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const funcName in model.functions) {
      const func = model.functions[funcName];
      const actions = func.actions || [];

      for (const action of actions) {
        // Check if this is a choice action
        if ('dialogRef' in action && 'targetFunction' in action) {
          const targetFunc = action.targetFunction;
          if (targetFunc && !functionNames.has(targetFunc)) {
            errors.push({
              type: 'missing_function',
              message: `Choice in function '${funcName}' references missing target function '${targetFunc}'`,
              functionName: funcName
            });
          }
        }
      }
    }

    return errors;
  }
}
