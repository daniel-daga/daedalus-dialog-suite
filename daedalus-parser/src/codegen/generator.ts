// String-based code generator for Daedalus semantic model
// Generates clean, readable Daedalus source code from semantic model

import {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogAction,
  DialogCondition,
  CodeGeneratable
} from '../semantic/semantic-model';

export interface CodeGeneratorOptions {
  indentSize?: number;
  indentChar?: '\t' | ' ';
  includeComments?: boolean;
  sectionHeaders?: boolean;
  uppercaseKeywords?: boolean;
  preserveSourceStyle?: boolean;
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
      preserveSourceStyle: true,
      ...options
    };
  }

  /**
   * Generate complete Daedalus source file from semantic model
   */
  generateSemanticModel(model: SemanticModel): string {
    if (model.declarationOrder && model.declarationOrder.length > 0) {
      return this.generateByDeclarationOrder(model);
    }

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

  private generateByDeclarationOrder(model: SemanticModel): string {
    const sections: string[] = [];
    const emittedDialogs = new Set<string>();
    const emittedFunctions = new Set<string>();

    for (const declaration of model.declarationOrder || []) {
      if (declaration.type === 'dialog') {
        const dialog = model.dialogs[declaration.name];
        if (dialog && !emittedDialogs.has(dialog.name)) {
          const leading = this.renderLeadingComments(dialog.leadingComments);
          if (leading) {
            sections.push(leading);
          } else if (this.options.sectionHeaders && this.options.includeComments) {
            sections.push(this.generateSectionHeader(this.extractDisplayName(dialog.name)));
          }
          sections.push(this.generateDialog(dialog));
          emittedDialogs.add(dialog.name);
        }
      } else if (declaration.type === 'function') {
        const func = model.functions[declaration.name];
        if (func && !emittedFunctions.has(func.name)) {
          const leading = this.renderLeadingComments(func.leadingComments);
          if (leading) {
            sections.push(leading);
          }
          sections.push(this.generateFunction(func));
          emittedFunctions.add(func.name);
        }
      }
    }

    // Keep legacy robustness for manually constructed models that might miss order entries.
    for (const dialogName in model.dialogs) {
      if (!emittedDialogs.has(dialogName)) {
        const dialog = model.dialogs[dialogName];
        const leading = this.renderLeadingComments(dialog.leadingComments);
        if (leading) {
          sections.push(leading);
        } else if (this.options.sectionHeaders && this.options.includeComments) {
          sections.push(this.generateSectionHeader(this.extractDisplayName(dialog.name)));
        }
        sections.push(this.generateDialog(dialog));
      }
    }
    for (const funcName in model.functions) {
      if (!emittedFunctions.has(funcName)) {
        const func = model.functions[funcName];
        const leading = this.renderLeadingComments(func.leadingComments);
        if (leading) {
          sections.push(leading);
        }
        sections.push(this.generateFunction(func));
      }
    }

    return sections.join('\n');
  }

  /**
   * Generate code for a specific dialog and its associated functions
   */
  generateDialogWithFunctions(dialogName: string, model: SemanticModel): string {
    const dialog = model.dialogs[dialogName];
    if (!dialog) {
      throw new Error(`Dialog ${dialogName} not found in model`);
    }

    const processedFunctions = new Set<string>();
    return this.generateDialogSection(dialog, model, processedFunctions);
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
    const instanceKeyword = this.resolveKeyword('instance', dialog.keyword);
    const spaceBeforeParen = this.options.preserveSourceStyle && dialog.spaceBeforeParen ? ' ' : '';
    const lines: string[] = [];

    lines.push(`${instanceKeyword} ${dialog.name}${spaceBeforeParen}(C_INFO)`);
    lines.push('{');

    // Preserve original property insertion order to minimize style churn.
    for (const key in dialog.properties) {
      const value = dialog.properties[key];
      const spacing = this.resolvePropertySpacing(dialog, key);
      lines.push(`${indent}${key}${spacing.beforeEquals}=${spacing.afterEquals}${this.formatDialogPropertyValue(dialog, key, value)};`);
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

  private resolvePropertySpacing(dialog: Dialog, propertyName: string): { beforeEquals: string; afterEquals: string } {
    if (this.options.preserveSourceStyle && dialog.propertyFormatting && dialog.propertyFormatting[propertyName]) {
      return dialog.propertyFormatting[propertyName];
    }
    return { beforeEquals: this.alignProperty(propertyName), afterEquals: ' ' };
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

  private formatDialogPropertyValue(dialog: Dialog, key: string, value: string | number | boolean | DialogFunction): string {
    if (
      this.options.preserveSourceStyle &&
      typeof value === 'string' &&
      Array.isArray(dialog.propertyExpressionKeys) &&
      dialog.propertyExpressionKeys.includes(key)
    ) {
      return value;
    }
    return this.formatValue(value);
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
    const funcKeyword = this.resolveKeyword('func', func.keyword);
    const returnType = this.normalizeReturnType(func.returnType, func.returnType);
    const spaceBeforeParen = this.options.preserveSourceStyle && func.spaceBeforeParen ? ' ' : '';
    const returnTypeLower = func.returnType.toLowerCase();
    const lines: string[] = [];

    lines.push(`${funcKeyword} ${returnType} ${func.name}${spaceBeforeParen}()`);
    lines.push('{');

    // Use preserved body if provided
    if (preservedBody) {
      // Split preserved body and indent each line
      const bodyLines = preservedBody.trim().split('\n');
      bodyLines.forEach(line => {
        lines.push(`${indent}${line}`);
      });
    } else if (func.conditions.length > 0) {
      // Generate condition function body
      this.generateConditionBody(func.conditions, lines, indent);
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
      if (returnTypeLower === 'int') {
        if (!this.options.preserveSourceStyle || func.hasExplicitBodyContent !== false) {
          lines.push(`${indent}return TRUE;`);
        }
      } else if (returnTypeLower === 'void') {
        lines.push(`${indent}// T` + `ODO: Implement function body`);
      }
    }

    lines.push('};');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate condition function body with if statement(s)
   */
  private generateConditionBody(conditions: DialogCondition[], lines: string[], indent: string): void {
    if (conditions.length === 0) {
      lines.push(`${indent}return TRUE;`);
      return;
    }

    if (conditions.length === 1) {
      // Single condition - simple if
      const condCode = this.generateCondition(conditions[0]);
      lines.push(`${indent}if (${condCode})`);
      lines.push(`${indent}{`);
      lines.push(`${indent}${indent}return TRUE;`);
      lines.push(`${indent}};`);
    } else {
      // Multiple conditions - generate single if with && operators (matching Gothic style)
      const condCodes = conditions.map(c => this.generateCondition(c));
      lines.push(`${indent}if (${condCodes[0]}`);
      for (let i = 1; i < condCodes.length; i++) {
        lines.push(`${indent}&& ${condCodes[i]}`);
      }
      lines.push(`${indent})`);
      lines.push(`${indent}{`);
      lines.push(`${indent}${indent}return TRUE;`);
      lines.push(`${indent}};`);
    }
  }

  /**
   * Generate code for a dialog condition using polymorphism
   */
  private generateCondition(condition: DialogCondition): string {
    return (condition as CodeGeneratable).generateCode({
      includeComments: this.options.includeComments
    });
  }

  /**
   * Generate code for a dialog action using polymorphism
   * Each action knows how to generate its own code
   */
  generateAction(action: DialogAction): string {
    return (action as CodeGeneratable).generateCode({
      includeComments: this.options.includeComments
    });
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

  private resolveKeyword(defaultKeyword: string, sourceKeyword?: string): string {
    if (this.options.preserveSourceStyle && sourceKeyword) {
      return sourceKeyword;
    }
    return this.keyword(defaultKeyword);
  }

  /**
   * Normalize return type case (int/INT -> int/INT based on options)
   */
  private normalizeReturnType(type: string, sourceReturnType?: string): string {
    if (this.options.preserveSourceStyle && sourceReturnType) {
      return sourceReturnType;
    }
    const normalized = type.toLowerCase();
    return this.options.uppercaseKeywords ? normalized.toUpperCase() : normalized;
  }

  private renderLeadingComments(comments?: string[]): string | null {
    if (!this.options.includeComments) return null;
    if (!comments || comments.length === 0) return null;
    return comments.join('\n');
  }
}
