import Parser from 'tree-sitter';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

// @ts-ignore - CommonJS module
const DaedalusParser = require('daedalus-parser');
const Daedalus = DaedalusParser.DaedalusLanguage;

export class ParserService {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Daedalus);
  }

  /**
   * Parse Daedalus source code and return semantic model
   * Returns a plain serializable object (no class instances with methods)
   * If syntax errors are detected, returns model with hasErrors: true and errors array
   */
  parseSource(sourceCode: string): any {
    const tree = this.parser.parse(sourceCode);

    const visitor = new SemanticModelBuilderVisitor();

    // Check for syntax errors first
    visitor.checkForSyntaxErrors(tree.rootNode as any, sourceCode);

    // If there are syntax errors, return the model with errors immediately
    if (visitor.semanticModel.hasErrors) {
      return visitor.semanticModel;
    }

    // Otherwise, proceed with semantic analysis
    visitor.pass1_createObjects(tree.rootNode as any);
    visitor.pass2_analyzeAndLink(tree.rootNode as any);

    // Return the semantic model - it's serializable (plain objects)
    return visitor.semanticModel;
  }
}
