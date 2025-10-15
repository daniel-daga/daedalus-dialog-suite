// Utility functions for parser setup and common operations

/**
 * Create and configure a Daedalus parser instance
 * @returns Configured tree-sitter parser ready for Daedalus source
 */
export function createDaedalusParser(): any {
  const Parser = require('tree-sitter');
  const Daedalus = require('../bindings/node');
  const parser = new Parser();
  parser.setLanguage(Daedalus);
  return parser;
}

/**
 * Parse Daedalus source code and return the syntax tree
 * @param sourceCode - Daedalus source code to parse
 * @returns Parse tree
 */
export function parseDaedalusSource(sourceCode: string): any {
  const parser = createDaedalusParser();
  return parser.parse(sourceCode);
}
