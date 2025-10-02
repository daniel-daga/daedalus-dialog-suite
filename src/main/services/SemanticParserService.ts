import * as fs from 'fs';
import Parser from 'tree-sitter';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

export class SemanticParserService {
  private parser: Parser;
  private Daedalus: any;

  constructor() {
    this.parser = new Parser();
    // Load the Daedalus language from the parser package
    this.Daedalus = require('daedalus-parser/bindings/node');
    this.parser.setLanguage(this.Daedalus);
  }

  parseFile(filePath: string) {
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    return this.parseSource(sourceCode);
  }

  parseSource(sourceCode: string) {
    const tree = this.parser.parse(sourceCode);
    const visitor = new SemanticModelBuilderVisitor();

    // Two-pass parsing as per architecture
    visitor.pass1_createObjects(tree.rootNode as any);
    visitor.pass2_analyzeAndLink(tree.rootNode as any);

    return visitor.semanticModel;
  }

  validateSyntax(sourceCode: string) {
    const tree = this.parser.parse(sourceCode);
    const hasError = tree.rootNode.hasError;

    return {
      isValid: !hasError,
      errors: hasError ? this.extractErrors(tree.rootNode) : []
    };
  }

  private extractErrors(node: Parser.SyntaxNode): any[] {
    const errors: any[] = [];

    if (node.hasError) {
      if (node.type === 'ERROR') {
        errors.push({
          type: 'syntax_error',
          startPosition: node.startPosition,
          endPosition: node.endPosition,
          text: node.text
        });
      }

      for (const child of node.children) {
        errors.push(...this.extractErrors(child));
      }
    }

    return errors;
  }
}