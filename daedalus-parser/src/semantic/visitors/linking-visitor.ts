import {
  TreeSitterNode,
  TreeCursor,
  Dialog,
  DialogFunction,
  SemanticModel,
  SetVariableAction,
  Action,
  CommentAction,
  DialogLine,
  DialogAction,
  ConditionalAction,
  getDialogProperty
} from '../semantic-model';
import { ActionParsers } from '../parsers/action-parsers';
import { ConditionParsers } from '../parsers/condition-parsers';
import { parseArgumentsDetailed } from '../parsers/argument-parsing';
import {
  getBinaryOperator,
  getAssignmentOperator,
  isComparisonOperator,
  isLogicalOperator,
  isConditionModeBlockingStatement,
  isConditionAllowedParentType,
  isAncestorTraversalBoundaryType
} from '../parsers/ast-constants';
import { parseLiteralOrIdentifier } from '../parsers/literal-parsing';
import { namesEqual } from '../name-utils';

export class LinkingVisitor {
  private dialogs: SemanticModel['dialogs'];
  private functions: SemanticModel['functions'];
  private functionNameMap: Map<string, string>;
  private currentInstance: Dialog | null;
  private currentFunction: DialogFunction | null;
  private conditionFunctions: Set<string>;
  // Keyed by lowercase function name; a cached `null` records a proven miss
  // (a function owned by no dialog) so the O(dialogs) scan runs at most once.
  private functionToDialog: Map<string, Dialog | null>;
  private conditionRawMode: Set<string>;
  private preservedStatementRanges: Map<string, Set<string>>;
  private currentFunctionBodyNode: TreeSitterNode | null;
  private rawModeActionWatermark: number;
  // Ranges (`startIndex:endIndex`) of comment nodes already consumed as an
  // AI_Output subtitle, so they are not also re-emitted as standalone comments.
  private consumedCommentRanges: Set<string>;

  constructor(semanticModel: SemanticModel, functionNameMap: Map<string, string>) {
    this.dialogs = semanticModel.dialogs;
    this.functions = semanticModel.functions;
    this.functionNameMap = functionNameMap;
    this.currentInstance = null;
    this.currentFunction = null;
    this.conditionFunctions = new Set<string>();
    this.functionToDialog = new Map<string, Dialog | null>();
    this.conditionRawMode = new Set<string>();
    this.preservedStatementRanges = new Map<string, Set<string>>;
    this.currentFunctionBodyNode = null;
    this.rawModeActionWatermark = 0;
    this.consumedCommentRanges = new Set<string>();
  }

  /**
   * Second pass: Link properties and analyze function bodies
   */
  visit(node: TreeSitterNode): void {
    const cursor = node.walk();
    const currentNode = cursor.currentNode;

    if (currentNode.type === 'program' || currentNode.type === 'source_file') {
      // Pre-scan instance bodies for condition-function assignments so condition
      // functions are recognized regardless of declaration order (a function
      // declared before its instance must still be analyzed in condition mode).
      this.collectConditionFunctionNames(currentNode);
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

  private collectConditionFunctionNames(root: TreeSitterNode): void {
    for (const child of root.namedChildren) {
      if (child.type !== 'instance_declaration') continue;
      const body = child.childForFieldName('body');
      if (!body) continue;
      const nameNode = child.childForFieldName('name');
      const dialog = nameNode ? this.dialogs[nameNode.text] : undefined;
      for (const stmt of body.namedChildren) {
        if (stmt.type !== 'assignment_statement') continue;
        const left = stmt.childForFieldName('left');
        const right = stmt.childForFieldName('right');
        if (!left || !right || right.type !== 'identifier') continue;
        const propertyKey = left.text.toLowerCase();
        const originalName = this.functionNameMap.get(right.text.toLowerCase());
        const functionName = originalName || right.text;
        if (propertyKey === 'condition') {
          this.conditionFunctions.add(functionName);
        } else if (propertyKey === 'information' && dialog) {
          // Pre-populate function→dialog links (PF4) so lookups resolve without
          // an O(dialogs) scan regardless of declaration order.
          this.functionToDialog.set(functionName.toLowerCase(), dialog);
        }
      }
    }
  }

  private analyzeNodeRecursively(cursor: TreeCursor): void {
    const type = cursor.nodeType;
    const node = cursor.currentNode;

    this.enterDeclarationContext(type, node);

    if (type === 'if_statement') {
      this.maybeSetConditionOperator(node);
    }

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
        if (this.currentInstance) {
          this.captureDialogBodyComments(node, this.currentInstance);
        }
      }
      return;
    }

    if (type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      this.currentFunction = this.functions[nameNode.text];
      const body = node.childForFieldName('body');
      this.currentFunctionBodyNode = body ?? null;
      // Watermark the actions already present so a later raw-mode trigger can
      // discard exactly the ones recorded during this function's traversal.
      this.rawModeActionWatermark = this.currentFunction ? this.currentFunction.actions.length : 0;
      if (this.currentFunction && body) {
        this.currentFunction.hasExplicitBodyContent = body.namedChildren.length > 0;
      }
    }
  }

  /**
   * Capture standalone / trailing comments inside a C_INFO instance body (P6),
   * attaching them to the following property (leading), the same property line
   * (trailing), or the end of the body (trailingBody), in source order.
   */
  private captureDialogBodyComments(node: TreeSitterNode, dialog: Dialog): void {
    const body = node.childForFieldName('body');
    if (!body) return;
    let pending: string[] = [];
    let prevKey: string | null = null;
    let prevEndRow = -1;
    for (const child of body.namedChildren) {
      if (child.type === 'comment') {
        if (prevKey !== null && child.startPosition.row === prevEndRow) {
          if (!dialog.propertyTrailingComments) dialog.propertyTrailingComments = {};
          dialog.propertyTrailingComments[prevKey] = child.text;
        } else {
          pending.push(child.text);
        }
        continue;
      }
      if (child.type === 'assignment_statement') {
        const left = child.childForFieldName('left');
        const key = left ? left.text : null;
        if (key !== null && pending.length > 0) {
          if (!dialog.propertyLeadingComments) dialog.propertyLeadingComments = {};
          dialog.propertyLeadingComments[key] = pending;
        }
        pending = [];
        prevKey = key;
        prevEndRow = child.endPosition.row;
      }
    }
    if (pending.length > 0) {
      dialog.trailingBodyComments = pending;
    }
  }

  private leaveDeclarationContext(type: string): void {
    if (type === 'instance_declaration') {
      this.currentInstance = null;
      return;
    }

    if (type === 'function_declaration') {
      this.currentFunction = null;
      this.currentFunctionBodyNode = null;
      this.rawModeActionWatermark = 0;
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
        if (this.isTrivialTopLevelTrueReturn(node)) {
          return true;
        }
        this.triggerConditionRawMode(node);
        return true;
      }
    }

    if (type === 'variable_declaration' && this.currentFunction) {
      // Local declarations are preserved textually; skipping children keeps
      // initializer expressions from being misread as standalone actions.
      if (isConditionFunc) {
        this.triggerConditionRawMode(node);
      } else {
        this.preserveUnsupportedStatement(node);
      }
      return true;
    }

    if (this.currentFunction && !isConditionFunc && isConditionModeBlockingStatement(type)) {
      if (type === 'if_statement') {
        const conditionalAction = this.parseConditionalAction(node);
        if (conditionalAction) {
          this.recordActionForCurrentFunction(conditionalAction);
        } else {
          this.preserveUnsupportedStatement(node);
        }
        return true;
      }

      this.preserveUnsupportedStatement(node);
      return true;
    }

    return false;
  }

  private handleStatementNode(type: string, node: TreeSitterNode): void {
    if (type === 'comment') {
      // A standalone comment at the top level of a (non-condition) function
      // body is preserved in position as a CommentAction. Condition-function
      // comments are handled by the raw-mode body sweep. Comments already
      // consumed as an AI_Output subtitle are skipped.
      if (
        this.currentFunction &&
        !this.isCurrentConditionFunction() &&
        this.isFunctionTopLevelComment(node) &&
        !this.consumedCommentRanges.has(`${node.startIndex}:${node.endIndex}`)
      ) {
        this.recordActionForCurrentFunction(new CommentAction(node.text));
      }
      return;
    }

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

    let isAllowed = isConditionAllowedParentType(parent.type);

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

  private maybeSetConditionOperator(ifNode: TreeSitterNode): void {
    if (!this.isCurrentConditionFunction() || !this.currentFunction) return;
    const condNode = ifNode.childForFieldName('condition');
    if (!condNode) return;
    const detectedOp = this.detectTopLevelConditionOperator(condNode);
    if (detectedOp === 'OR') {
      this.currentFunction.conditionOperator = 'OR';
    } else if (detectedOp === null) {
      // Mixed operators — fall back to raw mode immediately
      this.triggerConditionRawMode(ifNode);
    }
  }

  /**
   * Unwrap parenthesized_expression nodes to get the inner node.
   */
  private unwrapParens(node: TreeSitterNode): TreeSitterNode {
    let current = node;
    while (current.type === 'parenthesized_expression' && current.namedChildren.length === 1) {
      const inner = current.namedChildren[0];
      if (!inner) break;
      current = inner;
    }
    return current;
  }

  /**
   * Detect the top-level logical operator used in the if statement condition.
   * Returns 'OR' if pure-OR, 'AND' if pure-AND or single condition, null if mixed.
   */
  private detectTopLevelConditionOperator(ifConditionNode: TreeSitterNode): 'AND' | 'OR' | null {
    const node = this.unwrapParens(ifConditionNode);
    if (node.type !== 'binary_expression') {
      return 'AND'; // single condition, default to AND
    }
    const operator = getBinaryOperator(node);
    if (!isLogicalOperator(operator)) {
      return 'AND'; // comparison, default to AND
    }

    // binary_expression children: child(0)=left, child(1)=operator, child(2)=right
    const leftNode = node.childCount >= 1 ? node.child(0) : null;
    const rightNode = node.childCount >= 3 ? node.child(2) : null;

    const leftOp = this.getTopLevelLogicalOperator(leftNode);
    const rightOp = this.getTopLevelLogicalOperator(rightNode);

    if (operator === '||') {
      // All parts must be non-&& (i.e., no && in same level)
      if ((leftOp === null || leftOp === '||') && (rightOp === null || rightOp === '||')) {
        return 'OR';
      }
      return null; // mixed
    }

    if (operator === '&&') {
      if ((leftOp === null || leftOp === '&&') && (rightOp === null || rightOp === '&&')) {
        return 'AND';
      }
      return null; // mixed
    }

    return null;
  }

  private getTopLevelLogicalOperator(node: TreeSitterNode | null): '&&' | '||' | null {
    if (!node || node.type !== 'binary_expression') return null;
    const op = getBinaryOperator(node);
    if (op === '&&' || op === '||') return op;
    return null;
  }

  /**
   * Process assignment statements in instance declarations
   */
  private processAssignment(node: TreeSitterNode): void {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');

    if (leftNode && rightNode && this.currentInstance) {
      const propertyName = leftNode.text;
      // Daedalus identifiers (including property names) are case-insensitive.
      const propertyKey = propertyName.toLowerCase();
      let value: string | number | boolean | DialogFunction;
      this.capturePropertyFormatting(node, propertyName);

      if (rightNode.type === 'identifier') {
        const originalName = this.functionNameMap.get(rightNode.text.toLowerCase());
        const functionName = originalName || rightNode.text;

        if (propertyKey === 'condition') {
          this.conditionFunctions.add(functionName);
        }

        if (this.functions[functionName]) {
          value = this.functions[functionName];
          if (propertyKey === 'information') {
            this.functionToDialog.set(functionName.toLowerCase(), this.currentInstance);
            this.syncDialogActionsForFunction(functionName, this.currentInstance);
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


  private syncDialogActionsForFunction(functionName: string, dialog: Dialog): void {
    const infoFunction = this.functions[functionName];
    if (!infoFunction?.actions?.length) {
      return;
    }

    for (const action of infoFunction.actions) {
      if (!dialog.actions.includes(action)) {
        dialog.actions.push(action);
      }
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

    if (leftNode && rightNode) {
      const variableName = leftNode.text;
      const operator = getAssignmentOperator(node);
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

    const argsNode = node.childForFieldName('arguments');
    this.currentFunction.callSites.push({
      functionName,
      args: argsNode ? parseArgumentsDetailed(argsNode) : [],
      position: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1
      }
    });

    if (this.isCurrentConditionFunction()) {
      if (this.conditionRawMode.has(this.currentFunction.name)) {
        return;
      }

      if (this.isNegatedCallHandledByUnaryCondition(node, functionName)) {
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
      // Track the same-line comment absorbed as this AI_Output's subtitle so it
      // is not also emitted as a standalone CommentAction.
      if (action instanceof DialogLine && action.inlineComment) {
        const commentNode = ActionParsers.findCommentAfterStatement(node);
        if (commentNode) {
          this.consumedCommentRanges.add(`${commentNode.startIndex}:${commentNode.endIndex}`);
        }
      }
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
    if (!node.type.endsWith('_statement') && node.type !== 'variable_declaration') {
      return false;
    }
    const parent = node.parent;
    if (!parent || parent.type !== 'block') return false;
    const grandParent = parent.parent;
    return !!grandParent && grandParent.type === 'function_declaration';
  }

  private isFunctionTopLevelComment(node: TreeSitterNode): boolean {
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
    this.recordActionForCurrentFunction(action);
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
      // Statements consumed into conditions (or recorded as actions) before this
      // trigger must not be dropped: clear the structured conditions, discard any
      // actions recorded during this function's traversal, and re-seed the whole
      // body top-to-bottom in source order so the continuing traversal dedupes.
      this.currentFunction.conditions = [];
      this.discardRecordedActions(funcName);
      const body = this.currentFunctionBodyNode;
      if (body) {
        for (const child of body.namedChildren) {
          if (child.type === 'comment') {
            // Standalone comments between top-level statements in a raw-mode
            // condition body are preserved in position (P6/N5).
            if (!this.consumedCommentRanges.has(`${child.startIndex}:${child.endIndex}`)) {
              this.recordActionForCurrentFunction(new CommentAction(child.text));
            }
          } else if (this.isTopLevelStatement(child)) {
            this.preserveConditionStatement(child);
          }
        }
        return;
      }
    }
    this.preserveConditionStatement(node);
  }

  /**
   * Remove the actions recorded for the current function during this traversal
   * (from the watermark captured on function entry) from both the function and
   * its owning dialog, so the raw-mode whole-body sweep is the single source of
   * truth and no statement is duplicated.
   */
  private discardRecordedActions(funcName: string): void {
    if (!this.currentFunction) return;
    const removed = this.currentFunction.actions.splice(this.rawModeActionWatermark);
    if (removed.length === 0) return;
    const dialog = this.findDialogForFunction(funcName);
    if (dialog) {
      dialog.actions = dialog.actions.filter((action) => !removed.includes(action));
    }
  }

  private isTrivialTopLevelTrueReturn(node: TreeSitterNode): boolean {
    if (!this.currentFunction) {
      return false;
    }

    // Only skip raw mode if this function is literally just a top-level truthy return.
    if (this.currentFunction.conditions.length > 0 || this.currentFunction.actions.length > 0) {
      return false;
    }

    const text = node.text.trim().replace(/\s+/g, ' ').toUpperCase();
    return text === 'RETURN TRUE;' || text === 'RETURN 1;';
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
    return this.hasAncestor(node, (ancestor) => {
      if (ancestor.type !== 'binary_expression') {
        return false;
      }
      const operator = getBinaryOperator(ancestor);
      return isComparisonOperator(operator);
    });
  }

  private hasNonLogicalBinaryAncestor(node: TreeSitterNode): boolean {
    return this.hasAncestor(node, (ancestor) => {
      if (ancestor.type !== 'binary_expression') {
        return false;
      }
      const operator = getBinaryOperator(ancestor);
      return !isLogicalOperator(operator);
    });
  }

  private hasComparisonBinaryAncestor(node: TreeSitterNode): boolean {
    return this.hasAncestor(node, (ancestor) => {
      if (ancestor.type !== 'binary_expression') {
        return false;
      }
      const operator = getBinaryOperator(ancestor);
      return isComparisonOperator(operator);
    });
  }

  private isNestedCallArgument(node: TreeSitterNode): boolean {
    return this.hasAncestor(node, (ancestor) => {
      if (ancestor.type !== 'call_expression') {
        return false;
      }
      const args = ancestor.childForFieldName('arguments');
      return !!args && this.nodeIsWithin(node, args);
    });
  }

  private hasAncestor(node: TreeSitterNode, predicate: (ancestor: TreeSitterNode) => boolean): boolean {
    let current: TreeSitterNode | null = node.parent;
    while (current) {
      if (predicate(current)) {
        return true;
      }

      if (this.isAncestorTraversalBoundary(current)) {
        break;
      }

      current = current.parent;
    }

    return false;
  }

  private isAncestorTraversalBoundary(node: TreeSitterNode): boolean {
    return isAncestorTraversalBoundaryType(node.type);
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

  private isNegatedCallHandledByUnaryCondition(node: TreeSitterNode, functionName: string): boolean {
    const dispatchKey = functionName.toLowerCase();
    if (
      dispatchKey !== 'npc_isdead' &&
      dispatchKey !== 'npc_isinstate' &&
      dispatchKey !== 'npc_knowsinfo'
    ) {
      return false;
    }

    const parent = node.parent;
    if (!parent || parent.type !== 'unary_expression') {
      return false;
    }

    const operator = parent.child(0);
    return !!operator && operator.text === '!';
  }

  /**
   * Preserve unsupported statements as raw actions (existing arbitrary text field)
   */
  private preserveUnsupportedStatement(node: TreeSitterNode): void {
    const action = new Action(node.text.trim());
    this.recordActionForCurrentFunction(action);
  }

  private parseConditionalAction(node: TreeSitterNode): ConditionalAction | null {
    const conditionNode = node.childForFieldName('condition');
    const consequenceNode = node.childForFieldName('consequence');
    const alternativeNode = node.childForFieldName('alternative');

    if (!conditionNode || !consequenceNode) {
      return null;
    }

    if (alternativeNode && alternativeNode.type !== 'block') {
      return null;
    }

    const thenActions = this.parseActionsFromBlock(consequenceNode);
    if (!thenActions) {
      return null;
    }

    const elseActions = alternativeNode ? this.parseActionsFromBlock(alternativeNode) : [];
    if (alternativeNode && !elseActions) {
      return null;
    }

    return new ConditionalAction(this.normalizeIfCondition(conditionNode.text), thenActions, elseActions || []);
  }

  private parseActionsFromBlock(blockNode: TreeSitterNode): DialogAction[] | null {
    if (blockNode.type !== 'block') {
      return null;
    }

    const actions: DialogAction[] = [];
    // Row of an AI_Output statement whose same-line comment was absorbed as its
    // subtitle — that comment must not also become a standalone CommentAction.
    let subtitleRow = -1;
    for (const child of blockNode.namedChildren || []) {
      if (child.type === 'comment') {
        if (child.startPosition.row === subtitleRow) {
          continue;
        }
        // Preserve standalone comments in conditional branch bodies in position.
        actions.push(new CommentAction(child.text));
        continue;
      }

      const action = this.parseActionStatementNode(child);
      if (!action) {
        return null;
      }
      actions.push(action);
      subtitleRow = action instanceof DialogLine && action.inlineComment ? child.endPosition.row : -1;
    }

    return actions;
  }

  private parseActionStatementNode(node: TreeSitterNode): DialogAction | null {
    if (node.type === 'expression_statement') {
      const callNode = (node.namedChildren || []).find((child) => child.type === 'call_expression');
      if (!callNode) {
        return null;
      }

      const functionNode = callNode.childForFieldName('function');
      if (!functionNode) {
        return null;
      }

      return ActionParsers.parseSemanticAction(callNode, functionNode.text);
    }

    if (node.type === 'assignment_statement') {
      const leftNode = node.childForFieldName('left');
      const rightNode = node.childForFieldName('right');

      if (!leftNode || !rightNode) {
        return null;
      }

      return new SetVariableAction(
        leftNode.text,
        getAssignmentOperator(node),
        parseLiteralOrIdentifier(rightNode)
      );
    }

    if (node.type === 'if_statement') {
      return this.parseConditionalAction(node);
    }

    if (node.type === 'variable_declaration') {
      return new Action(node.text.trim());
    }

    return null;
  }

  private normalizeIfCondition(conditionText: string): string {
    const trimmed = conditionText.trim();
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
      return trimmed;
    }

    let depth = 0;
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0 && index < trimmed.length - 1) {
          return trimmed;
        }
      }
    }

    return trimmed.slice(1, -1).trim();
  }

  /**
   * Find which dialog uses a function as its information function
   * Optimized to O(1) lookup using functionToDialog map
   */
  private findDialogForFunction(functionName: string): Dialog | null {
    const key = functionName.toLowerCase();
    const cached = this.functionToDialog.get(key);
    if (cached !== undefined) {
      // Includes cached misses (null) so the scan below runs at most once.
      return cached;
    }

    for (const dialog of Object.values(this.dialogs)) {
      const information = getDialogProperty(dialog.properties, 'information');
      const informationName = typeof information === 'string'
        ? information
        : (information && typeof information === 'object' && 'name' in information
          ? information.name
          : null);

      if (namesEqual(informationName, functionName)) {
        this.functionToDialog.set(key, dialog);
        return dialog;
      }
    }

    this.functionToDialog.set(key, null);
    return null;
  }
}
