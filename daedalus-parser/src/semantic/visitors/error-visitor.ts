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
    // A missing token can sit under a zero-width node the cursor never descends
    // into (`identifier` with `childCount: 0`), which leaves `hasErrors` with an
    // empty error list: a file that cannot be saved and says nothing why (#447).
    if (this.semanticModel.hasErrors && (this.semanticModel.errors?.length ?? 0) === 0) {
      this.recordUnreportedError(node);
    }
  }

  /** Report the first zero-width `hasError` node, or the root, when the walk found nothing. */
  private recordUnreportedError(root: TreeSitterNode): void {
    const zeroWidth = this.findZeroWidthErrorNode(root);
    const node = zeroWidth ?? root;
    const row = node.startPosition.row + 1;
    const column = node.startPosition.column + 1;
    if (!this.semanticModel.errors) this.semanticModel.errors = [];
    this.semanticModel.errors.push({
      type: zeroWidth ? 'missing_token' : 'syntax_error',
      message: zeroWidth
        ? `Missing ${node.type} at line ${row}, column ${column}`
        : `Syntax error at line ${row}, column ${column}`,
      position: { row, column },
      text: ''
    });
  }

  private findZeroWidthErrorNode(node: TreeSitterNode): TreeSitterNode | undefined {
    if (node.hasError && node.startIndex === node.endIndex) return node;
    for (let index = 0; index < node.childCount; index++) {
      const child = node.child(index);
      if (!child.hasError) continue;
      const found = this.findZeroWidthErrorNode(child);
      if (found) return found;
    }
    return undefined;
  }

  private checkForSyntaxErrorsRecursively(cursor: TreeCursor, sourceCode?: string): void {
    const node = cursor.currentNode;

    // Optimization: Skip subtrees that don't contain errors
    if (!node.hasError) {
      return;
    }

    this.semanticModel.hasErrors = true;

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
