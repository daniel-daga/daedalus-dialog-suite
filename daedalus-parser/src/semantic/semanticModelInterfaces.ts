/**
 * Shared interfaces for the semantic model.
 *
 * Extracted to break the circular-import chain that would arise if domain
 * action/condition files (dialogActions, npcActions, …) imported directly
 * from semantic-model.ts while semantic-model.ts imports from them.
 */

/**
 * Interface for code generation options
 */
export interface CodeGenOptions {
  includeComments?: boolean;
  preserveSourceStyle?: boolean;
  indentUnit?: string;
}

/**
 * Interface for action code generation and display.
 * All action and condition classes implement this to generate their own
 * code and display strings.
 */
export interface CodeGeneratable {
  generateCode(options: CodeGenOptions): string;
  toDisplayString(): string;
  getTypeName(): string;
}
