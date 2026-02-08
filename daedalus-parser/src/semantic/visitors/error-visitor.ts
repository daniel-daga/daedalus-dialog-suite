import {
  TreeSitterNode,
  TreeCursor,
  SemanticModel
} from '../semantic-model';

export class ErrorVisitor {
  private semanticModel: SemanticModel;

  constructor(semanticModel: SemanticModel) {
    this.semanticModel = semanticModel;
  }

  /**
   * Check for syntax errors in the parse tree and populate semantic model errors
   */
  checkForSyntaxErrors(node: TreeSitterNode, sourceCode?: string): void {
    const cursor = node.walk();
    this.checkForSyntaxErrorsRecursively(cursor, sourceCode);
  }

  private checkForSyntaxErrorsRecursively(cursor: TreeCursor, sourceCode?: string): void {
    const node = cursor.currentNode;

    // Optimization: Skip subtrees that don't contain errors
    if (!node.hasError) {
      return;
    }

    if (node.hasError) {
      this.semanticModel.hasErrors = true;
    }

    if (node.type === 'ERROR') {
      if (!this.semanticModel.errors) {
        this.semanticModel.errors = [];
      }

      this.semanticModel.errors.push({
        type: 'syntax_error',
        message: `Syntax error at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`,
        position: {
          row: node.startPosition.row + 1,
          column: node.startPosition.column + 1
        },
        text: sourceCode ? sourceCode.slice(node.startIndex, node.endIndex) : node.text
      });
    }

    if (node.isMissing) {
      if (!this.semanticModel.errors) {
        this.semanticModel.errors = [];
      }

      this.semanticModel.errors.push({
        type: 'missing_token',
        message: `Missing ${node.type} at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`,
        position: {
          row: node.startPosition.row + 1,
          column: node.startPosition.column + 1
        },
        text: ''
      });
    }

    if (cursor.gotoFirstChild()) {
      do {
        this.checkForSyntaxErrorsRecursively(cursor, sourceCode);
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  }
}
