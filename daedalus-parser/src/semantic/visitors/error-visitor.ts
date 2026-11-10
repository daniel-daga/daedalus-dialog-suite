import {
  TreeSitterNode,
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
    this.collectErrors(node, sourceCode);
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

  /** Pre-order, entering only nodes with `hasError`; iterative, like `collectErrors` (#538). */
  private findZeroWidthErrorNode(root: TreeSitterNode): TreeSitterNode | undefined {
    const cursor = root.walk();
    for (;;) {
      const node = cursor.currentNode;
      if (node.hasError) {
        if (node.startIndex === node.endIndex) return node;
        if (cursor.gotoFirstChild()) continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return undefined;
      }
    }
  }

  /**
   * Record every ERROR and missing node, entering only subtrees with
   * `hasError`. Iterative, so an error nested deeper than the JS stack is
   * still reported with its own line (#538).
   */
  private collectErrors(root: TreeSitterNode, sourceCode?: string): void {
    const cursor = root.walk();
    for (;;) {
      const node = cursor.currentNode;
      if (node.hasError) {
        this.recordError(node, sourceCode);
        if (cursor.gotoFirstChild()) continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return;
      }
    }
  }

  private recordError(node: TreeSitterNode, sourceCode?: string): void {
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
  }
}
