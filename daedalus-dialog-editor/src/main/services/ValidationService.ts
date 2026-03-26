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
 * Maps action type names to human-readable display labels used in error messages.
 */
const ACTION_DISPLAY_NAMES: Readonly<Partial<Record<string, string>>> = {
  SetVariableAction:        'Set Variable',
  DialogLine:               'Dialog Line',
  Choice:                   'Choice',
  LogEntry:                 'Log Entry',
  CreateTopic:              'Create Topic',
  LogSetTopicStatus:        'Log Set Topic Status',
  CreateInventoryItems:     'Create Inventory Items',
  GiveInventoryItems:       'Give Inventory Items',
  AttackAction:             'Attack Action',
  SetAttitudeAction:        'Set Attitude',
  ExchangeRoutineAction:    'Exchange Routine',
  PlayAniAction:            'Play Animation',
  GivePlayerXPAction:       'Give XP',
  PickpocketAction:         'Pickpocket',
  StartOtherRoutineAction:  'Start Other Routine',
  TeachAction:              'Teach',
  GiveTradeInventoryAction: 'Give Trade Inventory',
  RemoveInventoryItemsAction: 'Remove Inventory Items',
  InsertNpcAction:          'Insert NPC',
};

/**
 * Registry of required-field validators, one per action type.
 * Each function returns a human-readable error suffix (starting with "is missing …")
 * or null when the action is valid. PickpocketAction has mode-dependent rules and is
 * handled separately in validateActions().
 */
type ActionValidatorFn = (action: any) => string | null;

const ACTION_REQUIRED_FIELD_VALIDATORS: Readonly<Partial<Record<string, ActionValidatorFn>>> = {
  SetVariableAction:        (a) => (!a.variableName || !a.variableName.trim())    ? 'is missing a variable name' : null,
  DialogLine:               (a) => (!a.speaker || !a.id)                          ? 'is missing speaker or ID' : null,
  Choice:                   (a) => (!a.dialogRef || !a.targetFunction)            ? 'is missing dialog reference or target function' : null,
  LogEntry:                 (a) => (!a.topic)                                     ? 'is missing a topic' : null,
  CreateTopic:              (a) => (!a.topic)                                     ? 'is missing a topic' : null,
  LogSetTopicStatus:        (a) => (!a.topic)                                     ? 'is missing a topic' : null,
  CreateInventoryItems:     (a) => (!a.target || !a.item)                         ? 'is missing target or item' : null,
  GiveInventoryItems:       (a) => (!a.giver || !a.receiver || !a.item)           ? 'is missing giver, receiver, or item' : null,
  AttackAction:             (a) => (!a.attacker || !a.target || !a.attackReason)  ? 'is missing attacker, target, or reason' : null,
  SetAttitudeAction:        (a) => (!a.target || !a.attitude)                     ? 'is missing target or attitude' : null,
  ExchangeRoutineAction:    (a) => (!a.target || !a.routine)                      ? 'is missing target or routine' : null,
  PlayAniAction:            (a) => (!a.target || !a.animationName)                ? 'is missing target or animation name' : null,
  GivePlayerXPAction:       (a) => (!a.xpAmount || !String(a.xpAmount).trim())    ? 'is missing XP amount' : null,
  StartOtherRoutineAction:  (a) => (!a.routineFunctionName || !a.routineNpc || !a.routineName) ? 'is missing function, NPC, or routine name' : null,
  TeachAction:              (a) => (!a.teachFunctionName || !Array.isArray(a.teachArgs))        ? 'is missing teach function or argument list' : null,
  GiveTradeInventoryAction: (a) => (!a.tradeTarget)                               ? 'is missing target' : null,
  RemoveInventoryItemsAction: (a) => (!a.removeFunctionName || !a.removeNpc || !a.removeItem || !a.removeQuantity) ? 'is missing function, NPC, item, or quantity' : null,
  InsertNpcAction:          (a) => (!a.npcInstance || !a.spawnPoint)              ? 'is missing NPC instance or spawn point' : null,
};

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
   * Comprehensive validation for all action types.
   * Most types are handled via ACTION_REQUIRED_FIELD_VALIDATORS; PickpocketAction
   * has mode-dependent rules and is handled inline below.
   */
  private validateActions(model: any): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const funcName in model.functions) {
      const func = model.functions[funcName];
      const actions = func.actions || [];

      actions.forEach((action: any, index: number) => {
        const actionType = action.type;
        const location = `action ${index + 1} in function '${funcName}'`;
        const displayName = ACTION_DISPLAY_NAMES[actionType] ?? actionType;

        // Registry-based required-field check
        const validator = ACTION_REQUIRED_FIELD_VALIDATORS[actionType];
        if (validator) {
          const errorSuffix = validator(action);
          if (errorSuffix) {
            errors.push({
              type: 'missing_required_property',
              message: `${displayName} ${location} ${errorSuffix}`,
              functionName: funcName
            });
          }
        }

        // PickpocketAction: mode-dependent validation not expressible as a single-line rule
        if (actionType === 'PickpocketAction') {
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
        }
      });
    }

    return errors;
  }
}
