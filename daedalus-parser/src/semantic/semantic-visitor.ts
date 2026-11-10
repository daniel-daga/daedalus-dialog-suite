// Core semantic visitor for Daedalus dialog parsing

import {
  TreeSitterNode,
  SemanticModel,
} from './semantic-model';
import { ErrorVisitor } from './visitors/error-visitor';
import { DeclarationVisitor } from './visitors/declaration-visitor';
import { LinkingVisitor, NestingTooDeepError, MAX_NESTING_DEPTH } from './visitors/linking-visitor';
import { createNameRecord } from './name-utils';

export class SemanticModelBuilderVisitor {
  public semanticModel: SemanticModel;
  private functionNameMap: Map<string, string>; // Maps lowercase name -> original name

  constructor() {
    this.semanticModel = {
      dialogs: createNameRecord(),
      functions: createNameRecord(),
      declarationOrder: [],
      constants: createNameRecord(),
      variables: createNameRecord(),
      instances: createNameRecord(),
      items: createNameRecord(),
      hasErrors: false,
      errors: []
    };
    this.functionNameMap = new Map<string, string>();
  }

  /**
   * Check for syntax errors in the parse tree and populate semantic model errors
   */
  checkForSyntaxErrors(node: TreeSitterNode, sourceCode?: string): void {
    const errorVisitor = new ErrorVisitor(this.semanticModel);
    errorVisitor.checkForSyntaxErrors(node, sourceCode);
  }

  // ===================================================================
  // PASS 1: CREATE SKELETON OBJECTS
  // ===================================================================

  /**
   * First pass: Create all skeleton objects to ensure they exist before linking
   */
  pass1_createObjects(node: TreeSitterNode): void {
    // #440: the file's own line ending, from its first line break, so a save
    // writes the file back the way it was written.
    const firstNewline = node.text.indexOf('\n');
    this.semanticModel.lineEnding = firstNewline > 0 && node.text[firstNewline - 1] === '\r' ? '\r\n' : '\n';
    const declarationVisitor = new DeclarationVisitor(this.semanticModel, this.functionNameMap);
    declarationVisitor.visit(node);
  }

  // ===================================================================
  // PASS 2: LINK PROPERTIES AND ANALYZE BODIES
  // ===================================================================

  /**
   * Second pass: Link properties and analyze function bodies
   */
  pass2_analyzeAndLink(node: TreeSitterNode): void {
    const linkingVisitor = new LinkingVisitor(this.semanticModel, this.functionNameMap);
    try {
      linkingVisitor.visit(node);
    } catch (error) {
      // #538: a file nested deeper than the model can carry is reported, not
      // analysed. Conditionals and nested calls have a fixed bound; anything
      // else that nests past the JS stack (a 20,000-clause guard) overflows a
      // walk that recurses per tree level. Any other error is rethrown.
      if (error instanceof NestingTooDeepError) {
        this.recordNestingTooDeep(error.node, `more than ${MAX_NESTING_DEPTH} ${error.what} levels`);
      } else if (error instanceof RangeError && /call stack/i.test(error.message)) {
        const { node: deepest, depth } = deepestNode(node);
        this.recordNestingTooDeep(deepest, `${depth} levels`);
      } else {
        throw error;
      }
    }
  }

  private recordNestingTooDeep(node: TreeSitterNode, extent: string): void {
    const row = node.startPosition.row + 1;
    const column = node.startPosition.column + 1;
    this.semanticModel.hasErrors = true;
    (this.semanticModel.errors ??= []).push({
      type: 'nesting_too_deep',
      message: `Too deeply nested to analyse (${extent}) at line ${row}, column ${column}`,
      position: { row, column },
      text: ''
    });
  }
}

/** The first node at the tree's greatest depth, found without recursion. */
function deepestNode(root: TreeSitterNode): { node: TreeSitterNode; depth: number } {
  const cursor = root.walk();
  let depth = 0;
  let deepest = { node: root, depth: 0 };
  for (;;) {
    if (depth > deepest.depth) deepest = { node: cursor.currentNode, depth };
    if (cursor.gotoFirstChild()) {
      depth++;
      continue;
    }
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) return deepest;
      depth--;
    }
  }
}
