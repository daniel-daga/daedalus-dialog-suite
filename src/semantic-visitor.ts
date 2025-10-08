// Core semantic visitor for Daedalus dialog parsing

import {
  TreeSitterNode,
  Dialog,
  DialogFunction,
  SemanticModel,
  DialogProperties,
  Choice
} from './semantic-model';
import { ActionParsers } from './action-parsers';

export class SemanticModelBuilderVisitor {
  public semanticModel: SemanticModel;
  private currentInstance: Dialog | null;
  private currentFunction: DialogFunction | null;

  constructor() {
    this.semanticModel = { dialogs: {}, functions: {} };
    this.currentInstance = null;
    this.currentFunction = null;
  }

  // ===================================================================
  // PASS 1: CREATE SKELETON OBJECTS
  // ===================================================================

  /**
   * First pass: Create all skeleton objects to ensure they exist before linking
   */
  pass1_createObjects(node: TreeSitterNode): void {
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      const typeNode = node.childForFieldName('return_type');
      if (nameNode && typeNode) {
        const func = new DialogFunction(nameNode.text, typeNode.text);
        this.semanticModel.functions[func.name] = func;
      }
    } else if (node.type === 'instance_declaration') {
      const nameNode = node.childForFieldName('name');
      const parentNode = node.childForFieldName('parent');
      if (nameNode) {
        const dialog = new Dialog(nameNode.text, parentNode ? parentNode.text : null);
        this.semanticModel.dialogs[dialog.name] = dialog;
      }
    }

    for (const child of node.children) {
      this.pass1_createObjects(child);
    }
  }

  // ===================================================================
  // PASS 2: LINK PROPERTIES AND ANALYZE BODIES
  // ===================================================================

  /**
   * Second pass: Link properties and analyze function bodies
   */
  pass2_analyzeAndLink(node: TreeSitterNode): void {
    // Set the current context when entering an instance or function
    if (node.type === 'instance_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.currentInstance = this.semanticModel.dialogs[nameNode.text];
      }
    } else if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.currentFunction = this.semanticModel.functions[nameNode.text];
      }
    }

    // Process nodes based on the current context
    if (node.type === 'assignment_statement' && this.currentInstance) {
        this.processAssignment(node);
    } else if (node.type === 'call_expression' && this.currentFunction) {
        this.processFunctionCall(node);
    }

    // Recurse to children
    for (const child of node.children) {
      this.pass2_analyzeAndLink(child);
    }

    // Unset the context after visiting all children
    if (node.type === 'instance_declaration') {
      this.currentInstance = null;
    } else if (node.type === 'function_declaration') {
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
          // Since all functions were created in Pass 1, this lookup will now succeed.
          if (this.semanticModel.functions[rightNode.text]) {
            value = this.semanticModel.functions[rightNode.text];
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
   * Process function calls in function bodies
   */
  private processFunctionCall(node: TreeSitterNode): void {
    const funcToCallNode = node.childForFieldName('function');
    if (funcToCallNode && this.currentFunction) {
      const functionName = funcToCallNode.text;
      this.currentFunction.calls.push(functionName);

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

  // ===================================================================
  // UTILITY METHODS
  // ===================================================================

  /**
   * Find which dialog uses a function as its information function
   */
  private findDialogForFunction(functionName: string): Dialog | null {
    for (const dialogName in this.semanticModel.dialogs) {
      const dialog = this.semanticModel.dialogs[dialogName];
      if (dialog.properties.information &&
          (dialog.properties.information as DialogFunction).name === functionName) {
        return dialog;
      }
    }
    return null;
  }
}