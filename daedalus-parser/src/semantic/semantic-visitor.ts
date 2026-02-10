// Core semantic visitor for Daedalus dialog parsing

import {
  TreeSitterNode,
  SemanticModel,
} from './semantic-model';
import { ErrorVisitor } from './visitors/error-visitor';
import { DeclarationVisitor } from './visitors/declaration-visitor';
import { LinkingVisitor } from './visitors/linking-visitor';

export class SemanticModelBuilderVisitor {
  public semanticModel: SemanticModel;
  private functionNameMap: Map<string, string>; // Maps lowercase name -> original name

  constructor() {
    this.semanticModel = {
      dialogs: {},
      functions: {},
      declarationOrder: [],
      constants: {},
      variables: {},
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
    linkingVisitor.visit(node);
  }
}
