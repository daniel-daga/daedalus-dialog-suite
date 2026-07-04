// String-based code generator for Daedalus semantic model
// Generates clean, readable Daedalus source code from semantic model

import {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogAction,
  DialogCondition,
  CodeGeneratable,
  getDialogProperty
} from '../semantic/semantic-model';
import { Choice } from '../semantic/dialogActions';
import { resolveCaseInsensitive } from '../semantic/name-utils';

// Structural shape shared by GlobalConstant / GlobalVariable / GlobalInstance
// as far as code generation is concerned.
interface GlobalSymbol {
  name: string;
  type?: string;
  value?: string | number | boolean;
  parent?: string;
  sourceText?: string;
  leadingComments?: string[];
}

export interface CodeGeneratorOptions {
  indentSize?: number;
  indentChar?: '\t' | ' ';
  includeComments?: boolean;
  sectionHeaders?: boolean;
  uppercaseKeywords?: boolean;
  preserveSourceStyle?: boolean;
  allowPartialModel?: boolean;
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
      allowPartialModel: false,
      ...options
    };
  }

  /**
   * Generate complete Daedalus source file from semantic model
   */
  generateSemanticModel(model: SemanticModel): string {
    if (model.hasErrors && !this.options.allowPartialModel) {
      throw new Error(
        `Refusing to generate code from a model with ${model.errors?.length ?? 0} parse error(s); pass allowPartialModel: true to override.`
      );
    }

    if (model.declarationOrder && model.declarationOrder.length > 0) {
      return this.generateByDeclarationOrder(model);
    }

    const sections: string[] = [];

    // Without declaration order, classes/prototypes/constants/variables lead the
    // file (declare-before-use) and instances trail it.
    const globalLeading: string[] = [];
    for (const name in model.classes || {}) {
      globalLeading.push(this.generateGlobalDeclaration('class', model.classes![name]));
    }
    for (const name in model.prototypes || {}) {
      globalLeading.push(this.generateGlobalDeclaration('prototype', model.prototypes![name]));
    }
    for (const name in model.constants || {}) {
      globalLeading.push(this.generateGlobalDeclaration('constant', model.constants![name]));
    }
    for (const name in model.variables || {}) {
      globalLeading.push(this.generateGlobalDeclaration('variable', model.variables![name]));
    }
    if (globalLeading.length > 0) {
      sections.push(globalLeading.join('\n') + '\n');
    }

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

    const globalTrailing: string[] = [];
    for (const name in model.instances || {}) {
      globalTrailing.push(this.generateGlobalDeclaration('instance', model.instances![name]));
    }
    if (globalTrailing.length > 0) {
      sections.push(globalTrailing.join('\n') + '\n');
    }

    const trailing = this.renderTrailingComments(model.trailingComments);
    if (trailing) {
      sections.push(trailing);
    }

    return sections.join('\n');
  }

  private generateByDeclarationOrder(model: SemanticModel): string {
    const sections: string[] = [];
    const emittedDialogs = new Set<string>();
    const emittedFunctions = new Set<string>();
    const emittedGlobals = new Set<string>();

    // Consecutive globals are grouped into one section so adjacent constants
    // stay adjacent instead of being separated by blank lines.
    const globalBuffer: string[] = [];
    const flushGlobals = () => {
      if (globalBuffer.length > 0) {
        sections.push(globalBuffer.join('\n') + '\n');
        globalBuffer.length = 0;
      }
    };

    // N10 — declaration-order fidelity: when the model carries a declaration
    // order (i.e. it came from a parse), emit strictly in that order. Every
    // parsed declaration has its own order entry, so dialog-clustering and
    // synthesized section headers are NOT applied here — they only rearrange
    // or invent content. Clustering / header synthesis remain the fallback for
    // dialogs and functions missing from the order (the leftover loops below).
    for (const declaration of model.declarationOrder || []) {
      if (
        declaration.type === 'constant' ||
        declaration.type === 'variable' ||
        declaration.type === 'instance' ||
        declaration.type === 'class' ||
        declaration.type === 'prototype'
      ) {
        const symbol = this.lookupGlobalSymbol(declaration.type, declaration.name, model);
        const key = `${declaration.type}:${declaration.name}`;
        if (symbol && !emittedGlobals.has(key)) {
          globalBuffer.push(this.generateGlobalDeclaration(declaration.type, symbol));
          emittedGlobals.add(key);
        }
        continue;
      }

      if (declaration.type === 'dialog') {
        const dialog = model.dialogs[declaration.name];
        if (dialog && !emittedDialogs.has(dialog.name)) {
          flushGlobals();
          // Emit leading comments verbatim; do NOT synthesize a section header
          // for a dialog that has its own order entry (invented content).
          const leading = this.renderLeadingComments(dialog.leadingComments);
          if (leading) {
            sections.push(leading);
          }
          sections.push(this.generateDialog(dialog));
          emittedDialogs.add(dialog.name);
        }
      } else if (declaration.type === 'function') {
        const func = model.functions[declaration.name];
        if (func && !emittedFunctions.has(func.name)) {
          flushGlobals();
          const leading = this.renderLeadingComments(func.leadingComments);
          if (leading) {
            sections.push(leading);
          }
          sections.push(this.generateFunction(func));
          emittedFunctions.add(func.name);
        }
      }
    }
    flushGlobals();

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
        emittedDialogs.add(dialogName);

        // Also cluster associated functions for fallback dialogs
        const associatedFuncs = this.getAssociatedFunctions(dialog, model);
        for (const func of associatedFuncs) {
          if (!emittedFunctions.has(func.name)) {
            const funcLeading = this.renderLeadingComments(func.leadingComments);
            if (funcLeading) {
              sections.push(funcLeading);
            }
            sections.push(this.generateFunction(func));
            emittedFunctions.add(func.name);
          }
        }
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

    // Globals missing from declarationOrder (e.g. manually constructed models):
    // classes/prototypes/constants/variables lead the file (declare-before-use),
    // instances trail it.
    const leftoverLeading: string[] = [];
    for (const name in model.classes || {}) {
      if (!emittedGlobals.has(`class:${name}`)) {
        leftoverLeading.push(this.generateGlobalDeclaration('class', model.classes![name]));
      }
    }
    for (const name in model.prototypes || {}) {
      if (!emittedGlobals.has(`prototype:${name}`)) {
        leftoverLeading.push(this.generateGlobalDeclaration('prototype', model.prototypes![name]));
      }
    }
    for (const name in model.constants || {}) {
      if (!emittedGlobals.has(`constant:${name}`)) {
        leftoverLeading.push(this.generateGlobalDeclaration('constant', model.constants![name]));
      }
    }
    for (const name in model.variables || {}) {
      if (!emittedGlobals.has(`variable:${name}`)) {
        leftoverLeading.push(this.generateGlobalDeclaration('variable', model.variables![name]));
      }
    }
    if (leftoverLeading.length > 0) {
      sections.unshift(leftoverLeading.join('\n') + '\n');
    }
    const leftoverInstances: string[] = [];
    for (const name in model.instances || {}) {
      if (!emittedGlobals.has(`instance:${name}`)) {
        leftoverInstances.push(this.generateGlobalDeclaration('instance', model.instances![name]));
      }
    }
    if (leftoverInstances.length > 0) {
      sections.push(leftoverInstances.join('\n') + '\n');
    }

    const trailing = this.renderTrailingComments(model.trailingComments);
    if (trailing) {
      sections.push(trailing);
    }

    return sections.join('\n');
  }

  private lookupGlobalSymbol(
    type: 'constant' | 'variable' | 'instance' | 'class' | 'prototype',
    name: string,
    model: SemanticModel
  ): GlobalSymbol | undefined {
    if (type === 'constant') return model.constants?.[name];
    if (type === 'variable') return model.variables?.[name];
    if (type === 'class') return model.classes?.[name];
    if (type === 'prototype') return model.prototypes?.[name];
    return model.instances?.[name];
  }

  /**
   * Generate a global declaration. The verbatim source text is preferred when
   * available (it is the only faithful representation for const arrays and
   * instance bodies); otherwise a canonical form is built from the model fields.
   */
  private generateGlobalDeclaration(
    type: 'constant' | 'variable' | 'instance' | 'class' | 'prototype',
    symbol: GlobalSymbol
  ): string {
    const parts: string[] = [];
    const leading = this.renderLeadingComments(symbol.leadingComments);
    if (leading) {
      parts.push(leading);
    }

    if (symbol.sourceText) {
      parts.push(symbol.sourceText);
    } else if (type === 'constant') {
      parts.push(`const ${symbol.type} ${symbol.name} = ${this.formatValue(symbol.value!)};`);
    } else if (type === 'variable') {
      parts.push(`var ${symbol.type} ${symbol.name};`);
    } else if (type === 'class') {
      parts.push(`class ${symbol.name} {};`);
    } else if (type === 'prototype') {
      parts.push(`prototype ${symbol.name}(${symbol.parent}) {};`);
    } else {
      parts.push(`instance ${symbol.name}(${symbol.parent}) {};`);
    }

    return parts.join('\n');
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
   * Get all functions associated with a dialog, ordered for readability:
   *   1. Condition function
   *   2. Information function
   *   3. Choice target functions (sub-dialog branches)
   *
   * Choice target functions are discovered by inspecting Choice actions
   * inside the information function.
   */
  private getAssociatedFunctions(dialog: Dialog, model: SemanticModel): DialogFunction[] {
    const funcs: DialogFunction[] = [];
    const seen = new Set<string>();

    const condProp = getDialogProperty(dialog.properties, 'condition');
    if (condProp instanceof DialogFunction) {
      funcs.push(condProp);
      seen.add(condProp.name);
    }

    let infoFunc: DialogFunction | undefined;
    const infoProp = getDialogProperty(dialog.properties, 'information');
    if (infoProp instanceof DialogFunction) {
      infoFunc = infoProp;
      funcs.push(infoFunc);
      seen.add(infoFunc.name);
    }

    // Collect choice target functions from the information function's actions
    if (infoFunc) {
      for (const action of infoFunc.actions) {
        if (action instanceof Choice && action.targetFunction) {
          // Case-insensitive: a case-drifted choice target must still cluster
          // (and, via generateDialogWithFunctions, still be emitted at all).
          const targetFunc = resolveCaseInsensitive(model.functions, action.targetFunction);
          if (targetFunc && !seen.has(targetFunc.name)) {
            funcs.push(targetFunc);
            seen.add(targetFunc.name);
          }
        }
      }
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
    const parent = dialog.parent || 'C_INFO';
    const lines: string[] = [];

    lines.push(`${instanceKeyword} ${dialog.name}${spaceBeforeParen}(${parent})`);
    lines.push('{');

    // Preserve original property insertion order to minimize style churn.
    for (const key in dialog.properties) {
      const value = dialog.properties[key];
      if (value === undefined) continue;
      // Standalone comments preceding this property (P6).
      if (this.options.includeComments && dialog.propertyLeadingComments) {
        for (const comment of dialog.propertyLeadingComments[key] || []) {
          lines.push(`${indent}${comment}`);
        }
      }
      const spacing = this.resolvePropertySpacing(dialog, key);
      const trailing =
        this.options.includeComments && dialog.propertyTrailingComments && dialog.propertyTrailingComments[key]
          ? ` ${dialog.propertyTrailingComments[key]}`
          : '';
      lines.push(`${indent}${key}${spacing.beforeEquals}=${spacing.afterEquals}${this.formatDialogPropertyValue(dialog, key, value)};${trailing}`);
    }

    // Standalone comments after the last property, before the closing brace (P6).
    if (this.options.includeComments && dialog.trailingBodyComments) {
      for (const comment of dialog.trailingBodyComments) {
        lines.push(`${indent}${comment}`);
      }
    }

    lines.push('};');
    lines.push('');

    return lines.join('\n');
  }

  private resolvePropertySpacing(dialog: Dialog, propertyName: string): { beforeEquals: string; afterEquals: string } {
    if (this.options.preserveSourceStyle && dialog.propertyFormatting && dialog.propertyFormatting[propertyName]) {
      return dialog.propertyFormatting[propertyName];
    }
    // Align property assignments using single tab spacing (Gothic convention)
    return { beforeEquals: '\t', afterEquals: ' ' };
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

    const parameters = (func.parameters || [])
      .map(p => [p.keyword, p.type, p.name].filter(Boolean).join(' '))
      .join(', ');
    lines.push(`${funcKeyword} ${returnType} ${func.name}${spaceBeforeParen}(${parameters})`);
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
      this.generateConditionBody(func.conditions, lines, indent, func.conditionOperator);
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
        // N4: never invent a placeholder comment for a function that had an
        // empty body in source. Only emit the placeholder for hand-built models.
        if (!this.options.preserveSourceStyle || func.hasExplicitBodyContent !== false) {
          lines.push(`${indent}// T` + `ODO: Implement function body`);
        }
      }
    }

    lines.push('};');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate condition function body with if statement(s)
   */
  private generateConditionBody(conditions: DialogCondition[], lines: string[], indent: string, conditionOperator: 'AND' | 'OR' = 'AND'): void {
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
      // Multiple conditions - generate single if with && or || operators (matching Gothic style)
      const joiner = conditionOperator === 'OR' ? '|| ' : '&& ';
      const condCodes = conditions.map(c => this.generateCondition(c));
      lines.push(`${indent}if (${condCodes[0]}`);
      for (let i = 1; i < condCodes.length; i++) {
        lines.push(`${indent}${joiner}${condCodes[i]}`);
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
      includeComments: this.options.includeComments,
      indentUnit: this.indent()
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

  private renderTrailingComments(comments?: string[]): string | null {
    const rendered = this.renderLeadingComments(comments);
    // EOF comments are the last thing in the file; the source ends with a
    // trailing newline after them, so preserve it for byte fidelity (the
    // sections join adds no newline after the final section).
    return rendered === null ? null : `${rendered}\n`;
  }
}
