declare module 'daedalus-parser' {
  // Core Types
  interface Position {
    row: number;
    column: number;
  }

  interface ParseOptions {
    includeSource?: boolean;
  }

  interface ParseResult {
    tree: any;
    rootNode: any;
    hasErrors: boolean;
    parseTime: number;
    sourceLength: number;
    throughput: number;
    sourceCode?: string;
    filePath?: string;
  }

  interface ValidationError {
    type: string;
    message: string;
    position?: Position;
    line?: number;
    column?: number;
  }

  interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
  }

  // Comment Types
  interface Comment {
    type: 'line' | 'block';
    text: string;
    content: string;
    startPosition: Position;
    endPosition: Position;
    node: any;
  }

  // Declaration Types
  interface Declaration {
    type: 'function' | 'instance' | 'var' | 'const' | 'class' | 'prototype';
    name: string;
    node: any;
    startPosition: Position;
    endPosition: Position;
    returnType?: string;
    parameters?: string[];
    body?: string;
    baseClass?: string;
    properties?: Record<string, any>;
  }

  // Dialog Types
  interface DialogConditionStatement {
    type: 'if_statement' | 'statement' | 'return';
    condition?: string;
    body?: DialogConditionStatement[];
    code?: string;
    value?: string;
  }

  interface DialogConditionLogic {
    statements: DialogConditionStatement[];
    returnValue: string | null;
  }

  interface DialogStep {
    type: 'line' | 'choice' | 'action' | 'logEntry' | 'createTopic' | 'clearChoices' | 'logSetTopicStatus';
    speaker?: string;
    listener?: string;
    dialogId?: string;
    text?: string;
    lineNumber?: number;
    action?: string;
    topic?: string;
    topicType?: string;
    status?: string;
    dialogRef?: string;
    targetFunction?: string;
    comment?: string;
    dialogFlow?: DialogFlow;
  }

  interface DialogFlow {
    steps: DialogStep[];
    functionName: string;
    totalLines: number;
    totalChoices: number;
    hasActions: boolean;
  }

  interface Dialog {
    name: string;
    npc: string;
    nr: number;
    condition: string;
    information: string;
    permanent: boolean | null;
    important: boolean | null;
    description: string;
    conditionLogic?: DialogConditionLogic;
    dialogFlow?: DialogFlow;
  }

  interface NPC {
    name: string;
    dialogs: Dialog[];
  }

  interface DialogData {
    npcs: Record<string, NPC>;
    metadata: {
      totalDialogs: number;
      totalNPCs: number;
      relatedFunctions: number;
      parseTime: number;
    };
    choiceTargetFunctions?: Declaration[];
    orphanedFunctions?: Declaration[];
  }

  // Generation Options
  interface GenerationOptions {
    includeComments?: boolean;
    preserveFormatting?: boolean;
    indentSize?: number;
  }

  // Main Parser Class
  class DaedalusParser {
    constructor();

    // Core parsing methods
    parse(sourceCode: string, options?: ParseOptions): ParseResult;
    parseFile(filePath: string, options?: ParseOptions): ParseResult;
    validate(sourceCode: string): ValidationResult;

    // Data extraction methods
    extractComments(parseResult: ParseResult): Comment[];
    extractDeclarations(parseResult: ParseResult): Declaration[];

    // Dialog-specific methods
    interpretDialogs(parseResult: ParseResult): DialogData;
    generateDaedalus(dialogData: DialogData, options?: GenerationOptions): string;
    generateDaedalusSimple(dialogData: DialogData, options?: GenerationOptions): string;

    // Convenience methods for library usage
    parseDialogFile(filePath: string): DialogData;
    parseDialogSource(sourceCode: string): DialogData;
    convertToJson(sourceCode: string, pretty?: boolean): string;
    convertFromJson(jsonData: string | DialogData): string;
    validateDialogFile(filePath: string): ValidationResult;
    validateDialogSource(sourceCode: string): ValidationResult;

    // Utility methods
    isDialogInstance(declaration: Declaration, sourceCode: string): boolean;
    extractDialogProperties(declaration: Declaration, sourceCode: string): Dialog;
  }

  // Default export
  export = DaedalusParser;
}

// Re-export types for convenience
export interface DaedalusParseResult {
  tree: any;
  rootNode: any;
  hasErrors: boolean;
  parseTime: number;
  sourceLength: number;
  throughput: number;
  sourceCode?: string;
  filePath?: string;
}

export interface DaedalusDialogData {
  npcs: Record<string, {
    name: string;
    dialogs: Array<{
      name: string;
      npc: string;
      nr: number;
      condition: string;
      information: string;
      permanent: boolean | null;
      important: boolean | null;
      description: string;
      conditionLogic?: {
        statements: Array<{
          type: 'if_statement' | 'statement' | 'return';
          condition?: string;
          body?: any[];
          code?: string;
          value?: string;
        }>;
        returnValue: string | null;
      };
      dialogFlow?: {
        steps: any[];
        functionName: string;
        totalLines: number;
        totalChoices: number;
        hasActions: boolean;
      };
    }>;
  }>;
  metadata: {
    totalDialogs: number;
    totalNPCs: number;
    relatedFunctions: number;
    parseTime: number;
  };
}

export interface DaedalusValidationResult {
  isValid: boolean;
  errors: Array<{
    type: string;
    message: string;
    position?: { row: number; column: number };
    line?: number;
    column?: number;
  }>;
  warnings: Array<{
    type: string;
    message: string;
    position?: { row: number; column: number };
    line?: number;
    column?: number;
  }>;
}