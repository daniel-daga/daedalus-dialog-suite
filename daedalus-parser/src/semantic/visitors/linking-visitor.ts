import {
  TreeSitterNode,
  TreeCursor,
  Dialog,
  DialogFunction,
  SemanticModel,
  SetVariableAction,
  Action,
  DialogAction
} from '../semantic-model';
import { ActionParsers } from '../parsers/action-parsers';
import { ConditionParsers } from '../parsers/condition-parsers';
import { getBinaryOperator, isComparisonOperator, isLogicalOperator } from '../parsers/ast-constants';
import { parseLiteralOrIdentifier } from '../parsers/literal-parsing';

export class LinkingVisitor {
  private dialogs: SemanticModel['dialogs'];
  private functions: SemanticModel['functions'];
  private functionNameMap: Map<string, string>;
  private currentInstance: Dialog | null;
  private currentFunction: DialogFunction | null;
  private conditionFunctions: Set<string>;
  private functionToDialog: Map<string, Dialog>;
  private conditionRawMode: Set<string>;
  private preservedStatementRanges: Map<string, Set<string>>;

  constructor(semanticModel: SemanticModel, functionNameMap: Map<string, string>) {
    this.dialogs = semanticModel.dialogs;
    this.functions = semanticModel.functions;
    this.functionNameMap = functionNameMap;
    this.currentInstance = null;
    this.currentFunction = null;
    this.conditionFunctions = new Set<string>();
    this.functionToDialog = new Map<string, Dialog>();
    this.conditionRawMode = new Set<string>();
    this.preservedStatementRanges = new Map<string, Set<string>>;
  }

  /**
   * Second pass: Link properties and analyze function bodies
   */
  visit(node: TreeSitterNode): void {
    const cursor = node.walk();
    const currentNode = cursor.currentNode;

    if (currentNode.type === 'program' || currentNode.type === 'source_file') {
      if (cursor.gotoFirstChild()) {
        do {
          const child = cursor.currentNode;
          if (child.type === 'function_declaration' || child.type === 'instance_declaration') {
            this.analyzeNodeRecursively(cursor);
          }
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
      return;
    }

    this.analyzeNodeRecursively(cursor);
  }

  private analyzeNodeRecursively(cursor: TreeCursor): void {
    const type = cursor.nodeType;
    const node = cursor.currentNode;

    this.enterDeclarationContext(type, node);

    const skipChildren = this.shouldSkipChildren(type, node);

    if (!skipChildren) {
      this.handleStatementNode(type, node);
      this.handleConditionNode(type, node);
    }

    if (!skipChildren && cursor.gotoFirstChild()) {
      do {
        this.analyzeNodeRecursively(cursor);
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }

    this.leaveDeclarationContext(type);
  }

  private enterDeclarationContext(type: string, node: TreeSitterNode): void {
    if (type === 'instance_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.currentInstance = this.dialogs[nameNode.text];
      }
      return;
    }

    if (type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      this.currentFunction = this.functions[nameNode.text];
      const body = node.childForFieldName('body');
      if (this.currentFunction && body) {
        this.currentFunction.hasExplicitBodyContent = body.namedChildren.length > 0;
      }
    }
  }

  private leaveDeclarationContext(type: string): void {
    if (type === 'instance_declaration') {
      this.currentInstance = null;
      return;
    }

    if (type === 'function_declaration') {
      this.currentFunction = null;
    }
  }

  private shouldSkipChildren(type: string, node: TreeSitterNode): boolean {
    const isConditionFunc = this.isCurrentConditionFunction();
    const currentFunctionName = this.currentFunction?.name;

    if (isConditionFunc && currentFunctionName) {
      if (this.conditionRawMode.has(currentFunctionName)) {
        if (this.isTopLevelStatement(node)) {
          this.preserveConditionStatement(node);
        }
        return true;
      }

      if (type === 'if_statement') {
        const alternative = node.childForFieldName('alternative');
        if (alternative) {
          this.triggerConditionRawMode(node);
          return true;
        }
      }

      if (type === 'return_statement' && this.isTopLevelStatement(node)) {
        this.triggerConditionRawMode(node);
        return true;
      }
    }

    if (this.currentFunction && !isConditionFunc && (type === 'if_statement' || type === 'return_statement')) {
      this.preserveUnsupportedStatement(node);
      return true;
    }

    return false;
  }

  private handleStatementNode(type: string, node: TreeSitterNode): void {
    if (type === 'assignment_statement') {
      if (this.currentInstance) {
        this.processAssignment(node);
      } else if (this.currentFunction) {
        this.processFunctionAssignment(node);
      }
      return;
    }

    if (type === 'call_expression' && this.currentFunction) {
      this.processFunctionCall(node);
    }
  }

  private handleConditionNode(type: string, node: TreeSitterNode): void {
    if (!this.isCurrentConditionFunction() || !this.currentFunction) {
      return;
    }

    if (type === 'binary_expression') {
      const operator = getBinaryOperator(node);
      if (isComparisonOperator(operator) && !this.hasComparisonBinaryAncestor(node)) {
        this.processCondition(node);
      }
      return;
    }

    if (type !== 'identifier' && type !== 'unary_expression') {
      return;
    }

    const parent = node.parent;
    if (!parent) return;

    if (type === 'identifier' && parent.type === 'unary_expression') return;
    if (this.hasNonLogicalBinaryAncestor(node)) return;

    const allowedParents = ['if_statement', 'parenthesized_expression'];
    let isAllowed = allowedParents.includes(parent.type);

    if (parent.type === 'binary_expression') {
      const operator = getBinaryOperator(parent);
      if (!isComparisonOperator(operator)) {
        isAllowed = true;
      }
    }

    if (isAllowed) {
      this.processCondition(node);
    }
  }

  /**
   * Process assignment statements in instance declarations
   */
  private processAssignment(node: TreeSitterNode): void {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');

    if (leftNode && rightNode && this.currentInstance) {
      const propertyName = leftNode.text;
      let value: string | number | boolean | DialogFunction;
      this.capturePropertyFormatting(node, propertyName);

      if (rightNode.type === 'identifier') {
        const originalName = this.functionNameMap.get(rightNode.text.toLowerCase());
        const functionName = originalName || rightNode.text;

        if (propertyName === 'condition') {
          this.conditionFunctions.add(functionName);
        }

        if (this.functions[functionName]) {
          value = this.functions[functionName];
          if (propertyName === 'information') {
            this.functionToDialog.set(functionName, this.currentInstance);
          }
        } else {
          value = rightNode.text;
        }
      } else {
        value = parseLiteralOrIdentifier(rightNode);
        if (!['number', 'boolean', 'string'].includes(rightNode.type)) {
          this.markPropertyExpression(propertyName);
        }
      }

      this.currentInstance.properties[propertyName] = value;
    }
  }

  private markPropertyExpression(propertyName: string): void {
    if (!this.currentInstance) return;
    if (!this.currentInstance.propertyExpressionKeys) {
      this.currentInstance.propertyExpressionKeys = [];
    }
    if (!this.currentInstance.propertyExpressionKeys.includes(propertyName)) {
      this.currentInstance.propertyExpressionKeys.push(propertyName);
    }
  }

  private capturePropertyFormatting(node: TreeSitterNode, propertyName: string): void {
    if (!this.currentInstance) return;
    const escapedProperty = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*${escapedProperty}(\\s*)=(\\s*)`);
    const match = node.text.match(re);
    if (!match) return;

    if (!this.currentInstance.propertyFormatting) {
      this.currentInstance.propertyFormatting = {};
    }

    this.currentInstance.propertyFormatting[propertyName] = {
      beforeEquals: match[1] || '\t',
      afterEquals: match[2] || ' '
    };
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
      const value = parseLiteralOrIdentifier(rightNode);

      const action = new SetVariableAction(variableName, operator, value);

      if (this.isCurrentConditionFunction()) {
        this.triggerConditionRawMode(node);
        return;
      }

      this.recordActionForCurrentFunction(action);
    }
  }

  /**
   * Process function calls in function bodies
   */
  private processFunctionCall(node: TreeSitterNode): void {
    const funcToCallNode = node.childForFieldName('function');
    if (!funcToCallNode || !this.currentFunction) {
      return;
    }

    const functionName = funcToCallNode.text;
    this.currentFunction.calls.push(functionName);

    if (this.isCurrentConditionFunction()) {
      if (this.conditionRawMode.has(this.currentFunction.name)) {
        return;
      }

      if (!this.isCallInsideIfCondition(node)) {
        this.triggerConditionRawMode(node);
        return;
      }

      if (this.isCallInsideComparisonBinary(node) || this.isNestedCallArgument(node)) {
        return;
      }

      this.processCondition(node, functionName);
      return;
    }

    if (!this.isTopLevelCallStatement(node)) {
      return;
    }

    const action = ActionParsers.parseSemanticAction(node, functionName);
    if (action) {
      this.recordActionForCurrentFunction(action);
    }
  }

  private recordActionForCurrentFunction(action: DialogAction): void {
    if (!this.currentFunction) return;
    this.currentFunction.actions.push(action);

    const dialog = this.findDialogForFunction(this.currentFunction.name);
    if (dialog) {
      dialog.actions.push(action);
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

  private isCurrentConditionFunction(): boolean {
    return !!this.currentFunction && this.conditionFunctions.has(this.currentFunction.name);
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

  private isCallInsideComparisonBinary(node: TreeSitterNode): boolean {
    let current: TreeSitterNode | null = node.parent;
    while (current) {
      if (current.type === 'binary_expression') {
        const operator = getBinaryOperator(current);
        if (isComparisonOperator(operator)) {
          return true;
        }
      }
      if (current.type === 'if_statement' || current.type === 'block' || current.type === 'function_declaration') {
        break;
      }
      current = current.parent;
    }
    return false;
  }

  private hasNonLogicalBinaryAncestor(node: TreeSitterNode): boolean {
    let current: TreeSitterNode | null = node.parent;
    while (current) {
      if (current.type === 'binary_expression') {
        const operator = getBinaryOperator(current);
        if (!isLogicalOperator(operator)) {
          return true;
        }
      }
      if (current.type === 'if_statement' || current.type === 'block' || current.type === 'function_declaration') {
        break;
      }
      current = current.parent;
    }
    return false;
  }

  private hasComparisonBinaryAncestor(node: TreeSitterNode): boolean {
    let current: TreeSitterNode | null = node.parent;
    while (current) {
      if (current.type === 'binary_expression') {
        const operator = getBinaryOperator(current);
        if (isComparisonOperator(operator)) {
          return true;
        }
      }
      if (current.type === 'if_statement' || current.type === 'block' || current.type === 'function_declaration') {
        break;
      }
      current = current.parent;
    }
    return false;
  }

  private isNestedCallArgument(node: TreeSitterNode): boolean {
    let current: TreeSitterNode | null = node.parent;
    while (current) {
      if (current.type === 'call_expression') {
        const args = current.childForFieldName('arguments');
        if (args && this.nodeIsWithin(node, args)) {
          return true;
        }
      }
      if (current.type === 'if_statement' || current.type === 'block' || current.type === 'function_declaration') {
        break;
      }
      current = current.parent;
    }
    return false;
  }

  private nodeIsWithin(node: TreeSitterNode, container: TreeSitterNode): boolean {
    return node.startIndex >= container.startIndex && node.endIndex <= container.endIndex;
  }

  private isTopLevelCallStatement(node: TreeSitterNode): boolean {
    const parent = node.parent;
    if (!parent || parent.type !== 'expression_statement') {
      return false;
    }
    const grandParent = parent.parent;
    return !!grandParent && grandParent.type === 'block';
  }

  /**
   * Preserve unsupported statements as raw actions (existing arbitrary text field)
   */
  private preserveUnsupportedStatement(node: TreeSitterNode): void {
    const action = new Action(node.text.trim());
    this.recordActionForCurrentFunction(action);
  }

  /**
   * Find which dialog uses a function as its information function
   * Optimized to O(1) lookup using functionToDialog map
   */
  private findDialogForFunction(functionName: string): Dialog | null {
    return this.functionToDialog.get(functionName) || null;
  }
}
