// Utility functions for parser setup and common operations

import * as fs from 'fs';
import * as path from 'path';

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

/**
 * Validate that a file exists and has the expected .d extension
 * @param filename - Path to file to validate
 * @throws Error if file doesn't exist
 */
export function validateDaedalusFile(filename: string): void {
  if (!fs.existsSync(filename)) {
    throw new Error(`File not found: ${filename}`);
  }

  const ext = path.extname(filename);
  if (ext !== '.d') {
    console.warn(`Warning: Expected .d file extension, got '${ext}'`);
  }
}
