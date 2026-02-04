// Core semantic visitor for Daedalus dialog parsing

import {
  TreeSitterNode,
  TreeCursor,
  Dialog,
  DialogFunction,
  SemanticModel,
  DialogProperties,
  Choice,
  GlobalConstant,
  GlobalVariable,
  SetVariableAction
} from './semantic-model';
import { ActionParsers } from './parsers/action-parsers';
import { ConditionParsers } from './parsers/condition-parsers';

export class SemanticModelBuilderVisitor {
  public semanticModel: SemanticModel;
  private currentInstance: Dialog | null;
  private currentFunction: DialogFunction | null;
  private conditionFunctions: Set<string>;
  private functionToDialog: Map<string, Dialog>;
  private functionNameMap: Map<string, string>; // Maps lowercase name -> original name

  constructor() {
    this.semanticModel = {
      dialogs: {},
      functions: {},
      constants: {},
      variables: {},
      hasErrors: false,
      errors: []
    };
    this.currentInstance = null;
    this.currentFunction = null;
    this.conditionFunctions = new Set<string>();
    this.functionToDialog = new Map<string, Dialog>();
    this.functionNameMap = new Map<string, string>();
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
      this.semanticModel.errors!.push({
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
      this.semanticModel.errors!.push({
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

  // ===================================================================
  // PASS 1: CREATE SKELETON OBJECTS
  // ===================================================================

  /**
   * First pass: Create all skeleton objects to ensure they exist before linking
   */
  pass1_createObjects(node: TreeSitterNode): void {
    const cursor = node.walk();
    this.pass1_createObjectsRecursively(cursor);
  }

  private pass1_createObjectsRecursively(cursor: TreeCursor): void {
    const node = cursor.currentNode;

    // Optimization: Handle root node specifically to skip non-declaration children
    if (node.type === 'program' || node.type === 'source_file') {
      if (cursor.gotoFirstChild()) {
        do {
          const child = cursor.currentNode;
          // Only recurse into declarations we care about
          if (child.type === 'function_declaration' ||
              child.type === 'instance_declaration' ||
              child.type === 'variable_declaration') {
            this.pass1_createObjectsRecursively(cursor);
          }
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
      return;
    }

    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      const typeNode = node.childForFieldName('return_type');
      if (nameNode && typeNode) {
        const func = new DialogFunction(nameNode.text, typeNode.text);
        this.semanticModel.functions[func.name] = func;
        this.functionNameMap.set(func.name.toLowerCase(), func.name);
      }
      return; // Optimization: Don't recurse into function bodies during object creation
    } else if (node.type === 'instance_declaration') {
      const nameNode = node.childForFieldName('name');
      const parentNode = node.childForFieldName('parent');
      if (nameNode) {
        const dialog = new Dialog(nameNode.text, parentNode ? parentNode.text : null);
        this.semanticModel.dialogs[dialog.name] = dialog;
      }
      return; // Optimization: Don't recurse into instance bodies during object creation
    } else if (node.type === 'variable_declaration') {
      this.createGlobalSymbol(node);
      return;
    }

    // For any other node types (e.g. if passed directly in tests), we don't expect nested declarations
    // so we don't need to recurse.
  }

  /**
   * Create GlobalConstant or GlobalVariable from variable declaration node
   */
  private createGlobalSymbol(node: TreeSitterNode): void {
    const keywordNode = node.childForFieldName('keyword');
    const typeNode = node.childForFieldName('type');
    const nameNode = node.childForFieldName('name');
    const valueNode = node.childForFieldName('value');

    if (!keywordNode || !typeNode || !nameNode) {
      return;
    }

    const keyword = keywordNode.text.toLowerCase();
    const type = typeNode.text;
    const name = nameNode.text;

    if (keyword === 'const') {
      let value: string | number | boolean = 0;
      if (valueNode) {
        if (valueNode.type === 'string') {
          value = valueNode.text;
        } else if (valueNode.type === 'number') {
          value = Number(valueNode.text);
        } else if (valueNode.type === 'boolean') {
          value = (valueNode.text.toLowerCase() === 'true');
        } else {
          // Identifier or expression
          value = valueNode.text;
        }
      }

      const constant = new GlobalConstant(name, type, value);
      constant.position = {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1
      };
      constant.range = {
        startIndex: node.startIndex,
        endIndex: node.endIndex
      };

      if (!this.semanticModel.constants) {
        this.semanticModel.constants = {};
      }
      this.semanticModel.constants[name] = constant;

    } else if (keyword === 'var') {
      const variable = new GlobalVariable(name, type);
      variable.position = {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1
      };
      variable.range = {
        startIndex: node.startIndex,
        endIndex: node.endIndex
      };

      if (!this.semanticModel.variables) {
        this.semanticModel.variables = {};
      }
      this.semanticModel.variables[name] = variable;
    }
  }

  // ===================================================================
  // PASS 2: LINK PROPERTIES AND ANALYZE BODIES
  // ===================================================================

  /**
   * Second pass: Link properties and analyze function bodies
   */
  pass2_analyzeAndLink(node: TreeSitterNode): void {
    const cursor = node.walk();
    const currentNode = cursor.currentNode;

    // Optimization: Handle root node specifically to skip non-declaration children
    if (currentNode.type === 'program' || currentNode.type === 'source_file') {
      if (cursor.gotoFirstChild()) {
        do {
          const child = cursor.currentNode;
          // Only recurse into declarations we care about
          if (child.type === 'function_declaration' || child.type === 'instance_declaration') {
            this.analyzeNodeRecursively(cursor);
          }
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
      return;
    }

    // Fallback for non-root nodes (e.g. tests)
    this.analyzeNodeRecursively(cursor);
  }

  /**
   * Internal method for analyzing nodes recursively
   */
  private analyzeNodeRecursively(cursor: TreeCursor): void {
    const type = cursor.nodeType;
    let node: TreeSitterNode | null = null;

    // Set the current context when entering an instance or function
    if (type === 'instance_declaration') {
      node = cursor.currentNode;
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.currentInstance = this.semanticModel.dialogs[nameNode.text];
      }
    } else if (type === 'function_declaration') {
      node = cursor.currentNode;
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.currentFunction = this.semanticModel.functions[nameNode.text];
      }
    }

    // Process nodes based on the current context
    if (type === 'assignment_statement') {
        if (!node) node = cursor.currentNode;
        if (this.currentInstance) {
            this.processAssignment(node);
        } else if (this.currentFunction) {
            this.processFunctionAssignment(node);
        }
    } else if (type === 'call_expression' && this.currentFunction) {
        if (!node) node = cursor.currentNode;
        this.processFunctionCall(node);
    } else if (this.currentFunction && this.conditionFunctions.has(this.currentFunction.name)) {
        // Process condition-specific node types
        if (type === 'binary_expression') {
            if (!node) node = cursor.currentNode;
            // Only process comparison binaries. Logical binaries (&&, ||) are containers.
            // binary_expression has children [left, operator, right]
            const operator = node.childCount >= 2 ? node.child(1).text : null;
            if (operator && ['==', '!=', '<', '>', '<=', '>='].includes(operator)) {
                this.processCondition(node);
            }
        } else if (type === 'identifier' || type === 'unary_expression') {
            if (!node) node = cursor.currentNode;
            const parent = node.parent;
            if (!parent) return;

            // If we are identifier, and parent is unary, we SKIP (let unary handle it).
            if (type === 'identifier' && parent.type === 'unary_expression') return;

            // Determine if this node is in a "Condition Context"
            const allowedParents = ['if_statement', 'parenthesized_expression'];
            let isAllowed = allowedParents.includes(parent.type);

            if (parent.type === 'binary_expression') {
                 // Check if logical (&&, ||)
                 const operator = parent.childCount >= 2 ? parent.child(1).text : null;
                 const isComparison = operator && ['==', '!=', '<', '>', '<=', '>='].includes(operator);
                 if (!isComparison) {
                     isAllowed = true;
                 }
            }

            if (isAllowed) {
                this.processCondition(node);
            }
        }
    }

    // Recurse to children
    if (cursor.gotoFirstChild()) {
      do {
        this.analyzeNodeRecursively(cursor);
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }

    // Unset the context after visiting all children
    if (type === 'instance_declaration') {
      this.currentInstance = null;
    } else if (type === 'function_declaration') {
      this.currentFunction = null;
    }
  }

  // ===================================================================
  // PROCESSING METHODS
  // ===================================================================

  /**
   * Process assignment statements in instance declarations
   */
  private processAssignment(node: TreeSitterNode): void {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');

    if (leftNode && rightNode && this.currentInstance) {
      const propertyName = leftNode.text;
      let value: string | number | boolean | DialogFunction;

      switch (rightNode.type) {
        case 'number':
          value = Number(rightNode.text);
          break;
        case 'boolean':
          value = (rightNode.text.toLowerCase() === 'true');
          break;
        case 'identifier':
          // Track condition functions
          if (propertyName === 'condition') {
            this.conditionFunctions.add(rightNode.text);
          }

          // Since all functions were created in Pass 1, this lookup will now succeed.
          // Handle case-insensitive lookup
          const originalName = this.functionNameMap.get(rightNode.text.toLowerCase());
          const functionName = originalName || rightNode.text;

          if (this.semanticModel.functions[functionName]) {
            value = this.semanticModel.functions[functionName];

            // Optimize lookup: Map information function to dialog
            if (propertyName === 'information') {
              this.functionToDialog.set(functionName, this.currentInstance);
            }
          } else {
            value = rightNode.text;
          }
          break;
        default:
          value = rightNode.text;
          break;
      }
      this.currentInstance.properties[propertyName] = value;
    }
  }

  /**
   * Process assignment statements in function bodies (variable updates)
   */
  private processFunctionAssignment(node: TreeSitterNode): void {
      if (!this.currentFunction) return;

      const leftNode = node.childForFieldName('left');
      const rightNode = node.childForFieldName('right');
      const operatorNode = node.childForFieldName('operator');

      if (leftNode && rightNode) {
          const variableName = leftNode.text;
          const operator = operatorNode ? operatorNode.text : '=';

          let value: string | number | boolean;
          if (rightNode.type === 'number') {
              value = Number(rightNode.text);
          } else if (rightNode.type === 'boolean') {
              value = (rightNode.text.toLowerCase() === 'true');
          } else {
              // For identifier or strings, keep the text
              value = rightNode.text;
          }

          const action = new SetVariableAction(variableName, operator, value);

          // Check if this is a condition function logic
          const isConditionFunc = this.conditionFunctions.has(this.currentFunction.name);

          if (!isConditionFunc) {
            this.currentFunction.actions.push(action);

            // Also add to dialog if linked
            const dialog = this.findDialogForFunction(this.currentFunction.name);
            if (dialog) {
              dialog.actions.push(action);
            }
          }
      }
  }

  /**
   * Process function calls in function bodies
   */
  private processFunctionCall(node: TreeSitterNode): void {
    const funcToCallNode = node.childForFieldName('function');
    if (funcToCallNode && this.currentFunction) {
      const functionName = funcToCallNode.text;
      this.currentFunction.calls.push(functionName);

      // Check if current function is a condition function
      const isConditionFunc = this.conditionFunctions.has(this.currentFunction.name);

      if (isConditionFunc) {
        // Parse semantic conditions and add to dialog
        this.processCondition(node, functionName);
      } else {
        // Parse semantic actions and add to current function
        const action = ActionParsers.parseSemanticAction(node, functionName);
        if (action) {
          this.currentFunction.actions.push(action);
        }

        // Also add to dialog if this function is a dialog information function
        const dialog = this.findDialogForFunction(this.currentFunction.name);
        if (dialog) {
          if (action) {
            dialog.actions.push(action);
          }
        }
      }
    }
  }

  /**
   * Process condition expressions (call expressions, identifiers, unary expressions)
   */
  private processCondition(node: TreeSitterNode, functionName?: string): void {
    if (!this.currentFunction) return;

    const condition = ConditionParsers.parseSemanticCondition(node, functionName);
    if (condition) {
      this.currentFunction.conditions.push(condition);
    }
  }

  // ===================================================================
  // UTILITY METHODS
  // ===================================================================

  /**
   * Find which dialog uses a function as its information function
   * Optimized to O(1) lookup using functionToDialog map
   */
  private findDialogForFunction(functionName: string): Dialog | null {
    return this.functionToDialog.get(functionName) || null;
  }
}