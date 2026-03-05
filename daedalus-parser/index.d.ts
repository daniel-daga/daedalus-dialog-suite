interface Position {
  row: number;
  column: number;
}

interface ParseOptions {
  bufferSize?: number;
  [key: string]: unknown;
}

interface ParseFileOptions extends ParseOptions {
  encoding?: string;
  detectEncoding?: boolean;
}

interface ValidationError {
  type: string;
  message: string;
  position: Position;
  text: string;
}

interface ParseResult {
  tree: any;
  rootNode: any;
  hasErrors: boolean;
  parseTime: number;
  sourceLength: number;
  throughput: number;
  errors?: ValidationError[];
  filePath?: string;
  encoding?: string | null;
  encodingConfidence?: number;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  parseTime: number;
  throughput: number;
}

interface Comment {
  type: 'line' | 'block';
  text: string;
  content: string;
  startPosition: Position;
  endPosition: Position;
  node: any;
}

type DeclarationType = 'instance' | 'function' | 'variable' | 'class' | 'prototype';

interface Declaration {
  type: DeclarationType;
  name: string;
  startPosition: Position;
  endPosition: Position;
  node: any;
  parent?: string | null;
  returnType?: string | null;
  varType?: string | null;
  isConst?: boolean;
  value?: string | null;
}

declare class DaedalusParser {
  constructor();

  parse(sourceCode: string, options?: ParseOptions): ParseResult;
  parseFile(filePath: string, options?: ParseFileOptions): ParseResult;
  validate(sourceCode: string): ValidationResult;

  extractComments(parseResult: ParseResult): Comment[];
  extractDeclarations(parseResult: ParseResult): Declaration[];

  static parseSource(sourceCode: string, options?: ParseOptions): ParseResult;
  static create(): DaedalusParser;
}

declare namespace DaedalusParser {
  const DaedalusLanguage: unknown;
}

export = DaedalusParser;
