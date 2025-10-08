// String-based code generator for Daedalus semantic model
// Generates clean, readable Daedalus source code from semantic model

import {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogAction,
  DialogLine,
  CreateTopic,
  LogEntry,
  LogSetTopicStatus,
  Action,
  Choice,
  CreateInventoryItems,
  GiveInventoryItems,
  AttackAction,
  SetAttitudeAction,
  ExchangeRoutineAction,
  ChapterTransitionAction
} from './semantic-model';

export interface CodeGeneratorOptions {
  indentSize?: number;
  indentChar?: '\t' | ' ';
  includeComments?: boolean;
  sectionHeaders?: boolean;
  uppercaseKeywords?: boolean;
}

export class SemanticCodeGenerator {
  private options: Required<CodeGeneratorOptions>;

  constructor(options: CodeGeneratorOptions = {}) {
    this.options = {
      indentSize: 1,
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: false,
      ...options
    };
  }

  /**
   * Generate complete Daedalus source file from semantic model
   */
  generateSemanticModel(model: SemanticModel): string {
    const sections: string[] = [];

    // Group dialogs and their associated functions together
    const processedFunctions = new Set<string>();

    for (const dialogName in model.dialogs) {
      const dialog = model.dialogs[dialogName];
      const dialogSection = this.generateDialogSection(dialog, model, processedFunctions);
      sections.push(dialogSection);
    }

    // Generate any remaining functions not associated with dialogs
    for (const funcName in model.functions) {
      if (!processedFunctions.has(funcName)) {
        const func = model.functions[funcName];
        sections.push(this.generateFunction(func));
      }
    }

    return sections.join('\n');
  }

  /**
   * Generate a dialog section with its associated functions
   */
  private generateDialogSection(
    dialog: Dialog,
    model: SemanticModel,
    processedFunctions: Set<string>
  ): string {
    const parts: string[] = [];

    // Section header
    if (this.options.sectionHeaders && this.options.includeComments) {
      const displayName = this.extractDisplayName(dialog.name);
      parts.push(this.generateSectionHeader(displayName));
    }

    // Dialog instance
    parts.push(this.generateDialog(dialog));

    // Associated functions (condition, information)
    const associatedFuncs = this.getAssociatedFunctions(dialog, model);
    for (const func of associatedFuncs) {
      processedFunctions.add(func.name);
      parts.push(this.generateFunction(func));
    }

    return parts.join('\n');
  }

  /**
   * Extract display name from dialog instance name (e.g., DIA_Szmyk_Hello -> Hello)
   */
  private extractDisplayName(dialogName: string): string {
    const parts = dialogName.split('_');
    return parts.length > 2 ? parts.slice(2).join('_') : dialogName;
  }

  /**
   * Generate section header comment
   */
  private generateSectionHeader(name: string): string {
    const line = '*'.repeat(60);
    return `// ${line}\n//\t\t\t\t\t${name}\n// ${line}\n`;
  }

  /**
   * Get functions associated with a dialog (condition, information)
   */
  private getAssociatedFunctions(dialog: Dialog, model: SemanticModel): DialogFunction[] {
    const funcs: DialogFunction[] = [];

    if (dialog.properties.condition instanceof DialogFunction) {
      funcs.push(dialog.properties.condition);
    }
    if (dialog.properties.information instanceof DialogFunction) {
      funcs.push(dialog.properties.information);
    }

    return funcs;
  }

  /**
   * Generate a dialog instance declaration
   */
  generateDialog(dialog: Dialog): string {
    const indent = this.indent();
    const instanceKeyword = this.keyword('instance');
    const lines: string[] = [];

    lines.push(`${instanceKeyword} ${dialog.name}(C_INFO)`);
    lines.push('{');

    // Generate properties in conventional order
    const propertyOrder = ['npc', 'nr', 'condition', 'information', 'permanent', 'important', 'description'];

    for (const key of propertyOrder) {
      if (key in dialog.properties) {
        const value = dialog.properties[key];
        lines.push(`${indent}${key}${this.alignProperty(key)}= ${this.formatValue(value)};`);
      }
    }

    // Add any remaining properties not in the standard order
    for (const key in dialog.properties) {
      if (!propertyOrder.includes(key)) {
        const value = dialog.properties[key];
        lines.push(`${indent}${key}${this.alignProperty(key)}= ${this.formatValue(value)};`);
      }
    }

    lines.push('};');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate alignment spacing for property assignment
   */
  private alignProperty(propertyName: string): string {
    // Align property assignments using single tab spacing (Gothic convention)
    return '\t';
  }

  /**
   * Format a property value for output
   */
  private formatValue(value: string | number | boolean | DialogFunction): string {
    if (value instanceof DialogFunction) {
      return value.name;
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    // String - check if it looks like an identifier, already quoted, or needs quotes
    if (this.isIdentifier(value)) {
      return value;
    }
    // Check if already quoted
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value;
    }
    return `"${value}"`;
  }

  /**
   * Check if a string looks like an identifier (no spaces, special chars)
   */
  private isIdentifier(str: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(str);
  }

  /**
   * Generate a function declaration
   */
  generateFunction(func: DialogFunction, preservedBody?: string): string {
    const indent = this.indent();
    const funcKeyword = this.keyword('func');
    const returnType = this.normalizeReturnType(func.returnType);
    const lines: string[] = [];

    lines.push(`${funcKeyword} ${returnType} ${func.name}()`);
    lines.push('{');

    // Use preserved body if provided, otherwise generate from actions
    if (preservedBody) {
      // Split preserved body and indent each line
      const bodyLines = preservedBody.trim().split('\n');
      bodyLines.forEach(line => {
        lines.push(`${indent}${line}`);
      });
    } else if (func.actions.length > 0) {
      // Generate body from semantic actions
      func.actions.forEach(action => {
        const actionCode = this.generateAction(action);
        if (actionCode) {
          const actionLines = actionCode.split('\n');
          actionLines.forEach(line => {
            if (line.trim()) {
              lines.push(`${indent}${line}`);
            } else {
              lines.push('');
            }
          });
        }
      });
    } else {
      // Empty function - add a simple return or placeholder
      if (returnType === 'int') {
        lines.push(`${indent}return TRUE;`);
      } else if (returnType === 'void') {
        lines.push(`${indent}// TODO: Implement function body`);
      }
    }

    lines.push('};');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate code for a dialog action
   */
  generateAction(action: DialogAction): string {
    if (action instanceof DialogLine) {
      return this.generateDialogLine(action);
    } else if (action instanceof Choice) {
      return this.generateChoice(action);
    } else if (action instanceof CreateTopic) {
      return this.generateCreateTopic(action);
    } else if (action instanceof LogEntry) {
      return this.generateLogEntry(action);
    } else if (action instanceof LogSetTopicStatus) {
      return this.generateLogSetTopicStatus(action);
    } else if (action instanceof CreateInventoryItems) {
      return this.generateCreateInventoryItems(action);
    } else if (action instanceof GiveInventoryItems) {
      return this.generateGiveInventoryItems(action);
    } else if (action instanceof AttackAction) {
      return this.generateAttackAction(action);
    } else if (action instanceof SetAttitudeAction) {
      return this.generateSetAttitudeAction(action);
    } else if (action instanceof ExchangeRoutineAction) {
      return this.generateExchangeRoutineAction(action);
    } else if (action instanceof ChapterTransitionAction) {
      return this.generateChapterTransitionAction(action);
    } else if (action instanceof Action) {
      return this.generateGenericAction(action);
    }
    return '';
  }

  private generateDialogLine(action: DialogLine): string {
    const comment = this.options.includeComments ? ` //${action.text}` : '';
    return `AI_Output(${action.speaker}, other, "${action.id}");${comment}`;
  }

  private generateChoice(action: Choice): string {
    return `Info_AddChoice(${action.dialogRef}, "${action.text}", ${action.targetFunction});`;
  }

  private generateCreateTopic(action: CreateTopic): string {
    if (action.topicType) {
      return `Log_CreateTopic(${action.topic}, ${action.topicType});`;
    }
    return `Log_CreateTopic(${action.topic});`;
  }

  private generateLogEntry(action: LogEntry): string {
    return `B_LogEntry(${action.topic}, "${action.text}");`;
  }

  private generateLogSetTopicStatus(action: LogSetTopicStatus): string {
    return `Log_SetTopicStatus(${action.topic}, ${action.status});`;
  }

  private generateCreateInventoryItems(action: CreateInventoryItems): string {
    return `CreateInvItems(${action.target}, ${action.item}, ${action.quantity});`;
  }

  private generateGiveInventoryItems(action: GiveInventoryItems): string {
    return `B_GiveInvItems(${action.giver}, ${action.receiver}, ${action.item}, ${action.quantity});`;
  }

  private generateAttackAction(action: AttackAction): string {
    return `B_Attack(${action.attacker}, ${action.target}, ${action.attackReason}, ${action.damage});`;
  }

  private generateSetAttitudeAction(action: SetAttitudeAction): string {
    return `B_SetAttitude(${action.target}, ${action.attitude});`;
  }

  private generateExchangeRoutineAction(action: ExchangeRoutineAction): string {
    return `Npc_ExchangeRoutine(${action.target}, "${action.routine}");`;
  }

  private generateChapterTransitionAction(action: ChapterTransitionAction): string {
    return `B_Kapitelwechsel(${action.chapter}, ${action.world});`;
  }

  private generateGenericAction(action: Action): string {
    // Add semicolon if not present
    const code = action.action.trim();
    return code.endsWith(';') ? code : `${code};`;
  }

  /**
   * Get indentation string
   */
  private indent(level: number = 1): string {
    return this.options.indentChar.repeat(this.options.indentSize * level);
  }

  /**
   * Format keyword according to options
   */
  private keyword(kw: string): string {
    return this.options.uppercaseKeywords ? kw.toUpperCase() : kw;
  }

  /**
   * Normalize return type case (int/INT -> int/INT based on options)
   */
  private normalizeReturnType(type: string): string {
    const normalized = type.toLowerCase();
    return this.options.uppercaseKeywords ? normalized.toUpperCase() : normalized;
  }
}