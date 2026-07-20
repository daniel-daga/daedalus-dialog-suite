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
  | 'circular_dependency'
  | 'invalid_string_content'
  | 'duplicate_voice_id'
  | 'malformed_voice_id';

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
  /**
   * Project-wide AI_Output voice ids (excluding the file being validated),
   * keyed by UPPERCASED id — same shape as ProjectIndex.voiceIds.
   */
  existingVoiceIds?: Record<string, Array<{ filePath: string; functionName: string }>>;
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
 * Action fields that are emitted as quoted string content. Daedalus has no
 * escape sequences, so an embedded double quote cannot be represented and
 * would corrupt the generated code. Returns the text to check, or undefined
 * when the field is not emitted as a string literal.
 */
const QUOTED_STRING_FIELDS: Readonly<Partial<Record<string, (action: any) => string | undefined>>> = {
  Choice:   (a) => (a.textIsExpression ? undefined : a.text),
  LogEntry: (a) => a.text,
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
  // Npc_RemoveInvItem is the 2-arg engine form and has no quantity argument;
  // only the 3-arg Npc_RemoveInvItems form requires removeQuantity.
  RemoveInventoryItemsAction: (a) => (!a.removeFunctionName || !a.removeNpc || !a.removeItem || (a.removeFunctionName === 'Npc_RemoveInvItems' && !a.removeQuantity)) ? 'is missing function, NPC, item, or quantity' : null,
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

    // Pre-check: a model opened with parse errors is a partial parse that no
    // editor mutation can make whole. Saving it drops the unreadable content,
    // so surface it as an error (the forced-save path turns this into informed
    // consent). Generation below uses allowPartialModel so we report the real
    // problems instead of the fix-01 P7 hard throw.
    if (semanticModel.hasErrors) {
      const parseErrorCount = semanticModel.errors?.length ?? 0;
      errors.push({
        type: 'syntax_error',
        message: `File was opened with ${parseErrorCount} parse error(s); saving from the visual editor will drop the content the parser could not read.`
      });
    }

    // Step 1: Generate code
    try {
      generatedCode = this.codeGeneratorService.generateCode(semanticModel, settings, { allowPartialModel: true });
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

    // Step 8: Quoted string content validation
    const stringErrors = this.validateStringContent(semanticModel);
    errors.push(...stringErrors);

    // Step 9: Voice ID validation (warnings only — must never block saves)
    warnings.push(...this.validateVoiceIds(semanticModel, options.existingVoiceIds));

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
   * Reject double quotes in fields emitted as Daedalus string literals.
   * Daedalus strings have no escape sequences, so embedded quotes cannot
   * be represented in generated code.
   */
  private validateStringContent(model: any): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const funcName in model.functions) {
      const func = model.functions[funcName];
      const actions = func.actions || [];

      actions.forEach((action: any, index: number) => {
        const getText = QUOTED_STRING_FIELDS[action.type];
        const text = getText?.(action);
        if (typeof text === 'string' && text.includes('"')) {
          const displayName = ACTION_DISPLAY_NAMES[action.type] ?? action.type;
          errors.push({
            type: 'invalid_string_content',
            message: `${displayName} action ${index + 1} in function '${funcName}' contains a double quote (") — Daedalus strings cannot contain quotes`,
            functionName: funcName
          });
        }
      });
    }

    return errors;
  }

  /**
   * Warn about duplicate or malformed AI_Output voice IDs. A duplicate voice ID
   * makes the game silently skip the line, so these are surfaced as warnings —
   * never errors, so they cannot block saves. Expression-valued ids are skipped
   * entirely; empty ids are already reported by the DialogLine required-field
   * validator.
   */
  private validateVoiceIds(
    model: any,
    existingVoiceIds?: Record<string, Array<{ filePath: string; functionName: string }>>
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Collect literal-id dialog lines from all functions, including lines
    // nested inside conditional actions.
    const lines: Array<{ id: string; functionName: string }> = [];
    const collect = (actions: any[], functionName: string): void => {
      for (const action of actions || []) {
        if (!action) {
          continue;
        }
        if (action.type === 'DialogLine') {
          if (typeof action.id === 'string' && action.id && !action.idIsExpression) {
            lines.push({ id: action.id, functionName });
          }
          continue;
        }
        if (Array.isArray(action.thenActions) || Array.isArray(action.elseActions)) {
          collect(action.thenActions || [], functionName);
          collect(action.elseActions || [], functionName);
        }
      }
    };
    for (const funcName in model.functions) {
      collect(model.functions[funcName].actions || [], funcName);
    }

    // Daedalus is case-insensitive: group by uppercased id.
    const byUpperId = new Map<string, Array<{ id: string; functionName: string }>>();
    for (const line of lines) {
      const key = line.id.toUpperCase();
      const entries = byUpperId.get(key);
      if (entries) {
        entries.push(line);
      } else {
        byUpperId.set(key, [line]);
      }
    }

    for (const [key, entries] of byUpperId) {
      // (a) Intra-file duplicates
      if (entries.length > 1) {
        const locations = entries.map((entry) => `'${entry.functionName}'`).join(', ');
        warnings.push({
          type: 'duplicate_voice_id',
          message: `Voice ID '${entries[0].id}' is used ${entries.length} times in this file (functions ${locations}) — the game silently skips lines with a duplicate voice ID`,
          functionName: entries[0].functionName
        });
      }

      // (b) Cross-file duplicates against the project-wide index
      const external = existingVoiceIds?.[key];
      if (external && external.length > 0) {
        const locations = external
          .map((entry) => `'${entry.functionName}' in ${entry.filePath}`)
          .join(', ');
        warnings.push({
          type: 'duplicate_voice_id',
          message: `Voice ID '${entries[0].id}' is already used elsewhere in the project (${locations}) — the game silently skips lines with a duplicate voice ID`,
          functionName: entries[0].functionName
        });
      }
    }

    // (c) Malformed ids: the vanilla convention ends in two numeric segments
    // (e.g. DIA_Alrik_Teach_15_00).
    for (const line of lines) {
      if (!/_\d+_\d+$/.test(line.id)) {
        warnings.push({
          type: 'malformed_voice_id',
          message: `Voice ID '${line.id}' in function '${line.functionName}' does not end in two numeric segments (expected the vanilla convention, e.g. DIA_Alrik_Teach_15_00)`,
          functionName: line.functionName
        });
      }
    }

    return warnings;
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
