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

/**
 * The 1-based source line a construct was parsed from.
 *
 * Intersected into the `DialogAction` and `DialogCondition` unions rather than
 * declared on each of the 35 action and condition classes: the linking visitor
 * stamps it in one place from the node it already holds, and nothing else ever
 * sets it. Optional because a model can also be built by hand or deserialized
 * from an editor edit, neither of which has a source line to give (#267).
 */
export interface SourceLine {
  line?: number;
}
