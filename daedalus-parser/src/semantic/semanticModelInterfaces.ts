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
  sourceText?: string;
  sourceCall?: SourceCall;
  sourceAssignment?: SourceAssignment;
  generateCode(options: CodeGenOptions): string;
  toDisplayString(): string;
  getTypeName(): string;
}

/** JSON-safe ownership and baseline for a parsed, commented action call. */
export interface SourceCall {
  version: 1;
  name: { start: number; end: number; initialValue: string };
  closeEnd: number;
  arguments: { start: number; end: number; initialValue: string }[];
  outsideComments: string[];
  /** Original gap after the closing `)` and before the statement's `;`. */
  statementSuffix?: string;
}

/** JSON-safe editable ranges and generated baseline for a commented assignment. */
export interface SourceAssignment {
  version: 1;
  left: { start: number; end: number; initialValue: string };
  operator: { start: number; end: number; initialValue: string };
  right: { start: number; end: number; initialValue: string };
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
