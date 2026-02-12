// Utility functions for parser setup and common operations

import * as fs from 'fs';
import * as path from 'path';
import DaedalusParser from '../core/parser';
import { SemanticModelBuilderVisitor } from '../semantic/semantic-visitor';
import { SemanticModel } from '../semantic/semantic-model';

/**
 * Create and configure a Daedalus parser instance
 * @returns Configured parser wrapper ready for Daedalus source
 */
export function createDaedalusParser(): DaedalusParser {
  return DaedalusParser.create();
}

/**
 * Parse Daedalus source code and return the syntax tree
 * @param sourceCode - Daedalus source code to parse
 * @returns Parse tree
 */
export function parseDaedalusSource(sourceCode: string): any {
  return createDaedalusParser().parse(sourceCode).tree;
}

/**
 * Parse Daedalus source code and build semantic model with error handling
 * @param sourceCode - Daedalus source code to parse
 * @returns Semantic model with error information if syntax errors exist
 */
export function parseSemanticModel(sourceCode: string): SemanticModel {
  const parseResult = createDaedalusParser().parse(sourceCode);
  const tree = parseResult.tree;

  const visitor = new SemanticModelBuilderVisitor();

  // Check for syntax errors first
  visitor.checkForSyntaxErrors(tree.rootNode, sourceCode);

  // If there are syntax errors, return the model with errors
  if (visitor.semanticModel.hasErrors) {
    return visitor.semanticModel;
  }

  // Otherwise, proceed with normal semantic analysis
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  return visitor.semanticModel;
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
