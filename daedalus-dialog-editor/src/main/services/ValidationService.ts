import type { ParserService } from './ParserService';
import type { CodeGeneratorService } from './CodeGeneratorService';
import { deserializeSemanticModel } from 'daedalus-parser/semantic-model';

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

    // Normalize the model to ensure all types are present
    const semanticModel = deserializeSemanticModel(model);

    // Step 1: Generate code
    try {
      generatedCode = this.codeGeneratorService.generateCode(semanticModel, settings);
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
    const duplicateErrors = this.validateDuplicateDialogs(semanticModel, options.existingDialogs);
    errors.push(...duplicateErrors);

    // Compute function names set once for multiple validations
    const functionNames = new Set<string>(Object.keys(semanticModel.functions || {}));

    // Step 4: Missing function reference detection
    const missingFuncErrors = this.validateFunctionReferences(semanticModel, functionNames);
    errors.push(...missingFuncErrors);

    // Step 5: Required property validation
    const requiredPropErrors = this.validateRequiredProperties(semanticModel);
    errors.push(...requiredPropErrors);

    // Step 6: Choice target validation
    const choiceErrors = this.validateChoiceTargets(semanticModel, functionNames);
    errors.push(...choiceErrors);

    // Step 7: Comprehensive action validation
    const actionErrors = this.validateActions(semanticModel);
    errors.push(...actionErrors);

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

      if (parseResult.hasErrors) {
        if (parseResult.errors && parseResult.errors.length > 0) {
          for (const parseError of parseResult.errors) {
            errors.push({
              type: 'syntax_error',
              message: parseError.message || 'Syntax error in generated code',
              position: parseError.position
            });
          }
        } else {
          // Fallback if errors array is empty but hasErrors is true
          errors.push({
            type: 'syntax_error',
            message: 'Syntax error detected in generated code (check parser logs)',
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
    const functionNameMap = this.createCaseInsensitiveMap(Array.from(functionNames));
    const dialogNameMap = this.createCaseInsensitiveMap(Object.keys(model.dialogs || {}));

    for (const funcName in model.functions) {
      const func = model.functions[funcName];
      const actions = func.actions || [];

      for (const action of actions) {
        // Check if this is a choice action
        if ('dialogRef' in action && 'targetFunction' in action) {
          const targetFunc = action.targetFunction;
          if (targetFunc && !this.isResolvableChoiceTarget(targetFunc, model, functionNames, functionNameMap, dialogNameMap)) {
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

  private createCaseInsensitiveMap(names: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const name of names) {
      map.set(name.toLowerCase(), name);
    }
    return map;
  }

  private resolveFunctionName(
    target: string,
    functionNames: Set<string>,
    functionNameMap: Map<string, string>
  ): string | null {
    if (functionNames.has(target)) {
      return target;
    }

    const caseInsensitive = functionNameMap.get(target.toLowerCase());
    return caseInsensitive || null;
  }

  private isResolvableChoiceTarget(
    target: string,
    model: any,
    functionNames: Set<string>,
    functionNameMap: Map<string, string>,
    dialogNameMap: Map<string, string>
  ): boolean {
    // 1) Direct function reference (case-insensitive)
    if (this.resolveFunctionName(target, functionNames, functionNameMap)) {
      return true;
    }

    // 2) Dialog instance reference (case-insensitive): resolve to dialog.information function
    const dialogName = dialogNameMap.get(target.toLowerCase());
    if (!dialogName) {
      return false;
    }

    const dialog = model.dialogs?.[dialogName];
    const infoRef = dialog?.properties?.information;
    const infoFuncName = this.extractFunctionName(infoRef);

    if (!infoFuncName) {
      return false;
    }

    return this.resolveFunctionName(infoFuncName, functionNames, functionNameMap) !== null;
  }

  /**
   * Comprehensive validation for all action types
   */
  private validateActions(model: any): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const funcName in model.functions) {
      const func = model.functions[funcName];
      const actions = func.actions || [];

      actions.forEach((action: any, index: number) => {
        const actionType = action.type;
        const location = `action ${index + 1} in function '${funcName}'`;

        switch (actionType) {
          case 'SetVariableAction':
            if (!action.variableName || !action.variableName.trim()) {
              errors.push({
                type: 'missing_required_property',
                message: `Set Variable ${location} is missing a variable name`,
                functionName: funcName
              });
            }
            break;
          case 'DialogLine':
            if (!action.speaker || !action.id) {
              errors.push({
                type: 'missing_required_property',
                message: `Dialog Line ${location} is missing speaker or ID`,
                functionName: funcName
              });
            }
            break;
          case 'Choice':
            if (!action.dialogRef || !action.targetFunction) {
              errors.push({
                type: 'missing_required_property',
                message: `Choice ${location} is missing dialog reference or target function`,
                functionName: funcName
              });
            }
            break;
          case 'LogEntry':
          case 'CreateTopic':
          case 'LogSetTopicStatus':
            if (!action.topic) {
              errors.push({
                type: 'missing_required_property',
                message: `${actionType} ${location} is missing a topic`,
                functionName: funcName
              });
            }
            break;
          case 'CreateInventoryItems':
            if (!action.target || !action.item) {
              errors.push({
                type: 'missing_required_property',
                message: `Create Inventory Items ${location} is missing target or item`,
                functionName: funcName
              });
            }
            break;
          case 'GiveInventoryItems':
            if (!action.giver || !action.receiver || !action.item) {
              errors.push({
                type: 'missing_required_property',
                message: `Give Inventory Items ${location} is missing giver, receiver, or item`,
                functionName: funcName
              });
            }
            break;
          case 'AttackAction':
            if (!action.attacker || !action.target || !action.attackReason) {
              errors.push({
                type: 'missing_required_property',
                message: `Attack Action ${location} is missing attacker, target, or reason`,
                functionName: funcName
              });
            }
            break;
          case 'SetAttitudeAction':
            if (!action.target || !action.attitude) {
              errors.push({
                type: 'missing_required_property',
                message: `Set Attitude ${location} is missing target or attitude`,
                functionName: funcName
              });
            }
            break;
          case 'ExchangeRoutineAction':
            if (!action.target || !action.routine) {
              errors.push({
                type: 'missing_required_property',
                message: `Exchange Routine ${location} is missing target or routine`,
                functionName: funcName
              });
            }
            break;
          case 'PlayAniAction':
            if (!action.target || !action.animationName) {
              errors.push({
                type: 'missing_required_property',
                message: `Play Animation ${location} is missing target or animation name`,
                functionName: funcName
              });
            }
            break;
          case 'GivePlayerXPAction':
            if (!action.xpAmount || !String(action.xpAmount).trim()) {
              errors.push({
                type: 'missing_required_property',
                message: `Give XP ${location} is missing XP amount`,
                functionName: funcName
              });
            }
            break;
          case 'PickpocketAction':
            if (!action.pickpocketMode) {
              errors.push({
                type: 'missing_required_property',
                message: `Pickpocket ${location} is missing mode`,
                functionName: funcName
              });
            }
            if (action.pickpocketMode === 'C_Beklauen' && (!action.minChance || !action.maxChance)) {
              errors.push({
                type: 'missing_required_property',
                message: `Pickpocket ${location} requires min/max chance for C_Beklauen`,
                functionName: funcName
              });
            }
            break;
          case 'StartOtherRoutineAction':
            if (!action.routineFunctionName || !action.routineNpc || !action.routineName) {
              errors.push({
                type: 'missing_required_property',
                message: `Start Other Routine ${location} is missing function, NPC, or routine name`,
                functionName: funcName
              });
            }
            break;
          case 'TeachAction':
            if (!action.teachFunctionName || !Array.isArray(action.teachArgs)) {
              errors.push({
                type: 'missing_required_property',
                message: `Teach ${location} is missing teach function or argument list`,
                functionName: funcName
              });
            }
            break;
          case 'GiveTradeInventoryAction':
            if (!action.tradeTarget) {
              errors.push({
                type: 'missing_required_property',
                message: `Give Trade Inventory ${location} is missing target`,
                functionName: funcName
              });
            }
            break;
          case 'RemoveInventoryItemsAction':
            if (!action.removeFunctionName || !action.removeNpc || !action.removeItem || !action.removeQuantity) {
              errors.push({
                type: 'missing_required_property',
                message: `Remove Inventory Items ${location} is missing function, NPC, item, or quantity`,
                functionName: funcName
              });
            }
            break;
          case 'InsertNpcAction':
            if (!action.npcInstance || !action.spawnPoint) {
              errors.push({
                type: 'missing_required_property',
                message: `Insert NPC ${location} is missing NPC instance or spawn point`,
                functionName: funcName
              });
            }
            break;
        }
      });
    }

    return errors;
  }
}
