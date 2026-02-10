import {
  TreeSitterNode,
  TreeCursor,
  Dialog,
  DialogFunction,
  SemanticModel,
  SetVariableAction,
  Action
} from '../semantic-model';
import { ActionParsers } from '../parsers/action-parsers';
import { ConditionParsers } from '../parsers/condition-parsers';

export class LinkingVisitor {
  private semanticModel: SemanticModel;
  private functionNameMap: Map<string, string>;
  private currentInstance: Dialog | null;
  private currentFunction: DialogFunction | null;
  private conditionFunctions: Set<string>;
  private functionToDialog: Map<string, Dialog>;
  private conditionRawMode: Set<string>;
  private preservedStatementRanges: Map<string, Set<string>>;

  constructor(semanticModel: SemanticModel, functionNameMap: Map<string, string>) {
    this.semanticModel = semanticModel;
    this.functionNameMap = functionNameMap;
    this.currentInstance = null;
    this.currentFunction = null;
    this.conditionFunctions = new Set<string>();
    this.functionToDialog = new Map<string, Dialog>();
    this.conditionRawMode = new Set<string>();
    this.preservedStatementRanges = new Map<string, Set<string>>();
  }

  /**
   * Second pass: Link properties and analyze function bodies
   */
  visit(node: TreeSitterNode): void {
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
    let skipChildren = false;

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

    const isConditionFunc = this.currentFunction && this.conditionFunctions.has(this.currentFunction.name);
    const currentFunctionName = this.currentFunction?.name;

    if (isConditionFunc && currentFunctionName) {
      if (this.conditionRawMode.has(currentFunctionName)) {
        if (this.isTopLevelStatement(cursor.currentNode)) {
          this.preserveConditionStatement(cursor.currentNode);
        }
        // In raw mode, never parse nested condition nodes.
        skipChildren = true;
      } else if (type === 'if_statement') {
        if (!node) node = cursor.currentNode;
        const alternative = node.childForFieldName('alternative');
        if (alternative) {
          this.triggerConditionRawMode(node);
          skipChildren = true;
        }
      }
    }

    // Preserve unsupported statements in non-condition functions to avoid flattening control flow
    if (this.currentFunction && !isConditionFunc) {
      if (type === 'if_statement' || type === 'return_statement') {
        if (!node) node = cursor.currentNode;
        this.preserveUnsupportedStatement(node);
        skipChildren = true;
      }
    }

    // Process nodes based on the current context
    if (!skipChildren && type === 'assignment_statement') {
        if (!node) node = cursor.currentNode;
        if (this.currentInstance) {
            this.processAssignment(node);
        } else if (this.currentFunction) {
            this.processFunctionAssignment(node);
        }
    } else if (!skipChildren && type === 'call_expression' && this.currentFunction) {
        if (!node) node = cursor.currentNode;
        this.processFunctionCall(node);
    } else if (!skipChildren && this.currentFunction && this.conditionFunctions.has(this.currentFunction.name)) {
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
    if (!skipChildren && cursor.gotoFirstChild()) {
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

          if (isConditionFunc) {
            this.triggerConditionRawMode(node);
            return;
          } else {
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
        if (this.conditionRawMode.has(this.currentFunction.name)) {
          return;
        }

        // In condition functions, calls are allowed only when part of an if-condition expression.
        // Standalone calls imply side effects and must fall back to raw preservation.
        if (!this.isCallInsideIfCondition(node)) {
          this.triggerConditionRawMode(node);
          return;
        }

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

  private isTopLevelStatement(node: TreeSitterNode): boolean {
    if (!node.type.endsWith('_statement')) {
      return false;
    }
    const parent = node.parent;
    if (!parent || parent.type !== 'block') return false;
    const grandParent = parent.parent;
    return !!grandParent && grandParent.type === 'function_declaration';
  }

  private preserveConditionStatement(node: TreeSitterNode): void {
    if (!this.currentFunction) return;
    const topLevel = this.getTopLevelStatement(node) || node;
    const rangeKey = `${topLevel.startIndex}:${topLevel.endIndex}`;
    const funcName = this.currentFunction.name;
    let ranges = this.preservedStatementRanges.get(funcName);
    if (!ranges) {
      ranges = new Set<string>();
      this.preservedStatementRanges.set(funcName, ranges);
    }
    if (ranges.has(rangeKey)) return;
    ranges.add(rangeKey);

    const action = new Action(topLevel.text.trim());
    this.currentFunction.actions.push(action);
  }

  private getTopLevelStatement(node: TreeSitterNode): TreeSitterNode | null {
    let current: TreeSitterNode | null = node;
    while (current && current.parent) {
      if (this.isTopLevelStatement(current)) return current;
      current = current.parent;
    }
    return null;
  }

  private triggerConditionRawMode(node: TreeSitterNode): void {
    if (!this.currentFunction) return;
    const funcName = this.currentFunction.name;
    if (!this.conditionRawMode.has(funcName)) {
      this.conditionRawMode.add(funcName);
      this.currentFunction.conditions = [];
    }
    this.preserveConditionStatement(node);
  }

  private isCallInsideIfCondition(node: TreeSitterNode): boolean {
    let current: TreeSitterNode | null = node;
    while (current && current.parent) {
      const parent = current.parent;
      if (parent.type === 'if_statement') {
        const cond = parent.childForFieldName('condition');
        return !!cond && this.nodeIsWithin(node, cond);
      }
      if (parent.type === 'block' || parent.type === 'function_declaration') {
        return false;
      }
      current = parent;
    }
    return false;
  }

  private nodeIsWithin(node: TreeSitterNode, container: TreeSitterNode): boolean {
    return node.startIndex >= container.startIndex && node.endIndex <= container.endIndex;
  }

  /**
   * Preserve unsupported statements as raw actions (existing arbitrary text field)
   */
  private preserveUnsupportedStatement(node: TreeSitterNode): void {
    if (!this.currentFunction) return;

    const action = new Action(node.text.trim());
    this.currentFunction.actions.push(action);

    const dialog = this.findDialogForFunction(this.currentFunction.name);
    if (dialog) {
      dialog.actions.push(action);
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
