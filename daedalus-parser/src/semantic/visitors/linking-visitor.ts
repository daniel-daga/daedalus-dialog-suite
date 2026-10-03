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
  SourceLine,
  getDialogProperty,
  snapshotDialogProperties
} from '../semantic-model';
import { ActionParsers } from '../parsers/action-parsers';
import { ConditionParsers } from '../parsers/condition-parsers';
import { parseArgumentsDetailed } from '../parsers/argument-parsing';
import {
  getBinaryOperator,
  getAssignmentOperator,
  isLogicalOperator,
  isConditionModeBlockingStatement,
  hasComment
} from '../parsers/ast-constants';
import { parseLiteralOrIdentifier } from '../parsers/literal-parsing';
import { captureAssignmentSource } from '../action-source';
import { createNameRecord, namesEqual } from '../name-utils';

/**
 * Stamp a parsed action or condition with the 1-based line of the node it came
 * from, so a Problems finding can name one (#267). Every construction site in
 * this file already holds the node; nothing else in the pipeline does.
 */
const atLine = <T>(item: T, node: TreeSitterNode): T & SourceLine => {
  const located = item as T & SourceLine;
  located.line = node.startPosition.row + 1;
  return located;
};

export class LinkingVisitor {
  private dialogs: SemanticModel['dialogs'];
  private functions: SemanticModel['functions'];
  private functionNameMap: Map<string, string>;
  private currentInstance: Dialog | null;
  private currentFunction: DialogFunction | null;
  private conditionFunctions: Set<string>;
  // Keyed by lowercase function name. A function can be shared by multiple
  // dialogs, so cache all owners (including an empty array for a proven miss).
  private functionToDialogs: Map<string, Dialog[]>;
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
    this.functionToDialogs = new Map<string, Dialog[]>();
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
      if (!dialog) continue;
      for (const stmt of body.namedChildren) {
        if (!this.isDirectPropertyAssignment(stmt)) continue;
        const left = stmt.childForFieldName('left');
        const right = stmt.childForFieldName('right');
        if (!left || !right || right.type !== 'identifier') continue;
        const propertyKey = left.text.toLowerCase();
        const originalName = this.functionNameMap.get(right.text.toLowerCase());
        const functionName = originalName || right.text;
        if (propertyKey === 'condition') {
          this.conditionFunctions.add(functionName);
        } else if (propertyKey === 'information' && dialog) {
          // Pre-populate function→dialogs links so shared information
          // functions resolve regardless of declaration order.
          this.addDialogForFunction(functionName, dialog);
        }
      }
    }
  }

  private analyzeNodeRecursively(cursor: TreeCursor): void {
    const type = cursor.nodeType;
    const node = cursor.currentNode;

    this.enterDeclarationContext(type, node);

    const skipChildren = this.shouldSkipChildren(type, node);

    if (!skipChildren) {
      this.handleStatementNode(type, node);
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
      if (this.currentFunction && body) {
        this.currentFunction.hasExplicitBodyContent = body.namedChildren.length > 0;
        // Index calls independently of semantic extraction, which can skip
        // local declarations or preserve an entire condition body as raw text.
        this.recordCallSitesInSubtree(body);
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
          if (!dialog.propertyTrailingComments) dialog.propertyTrailingComments = createNameRecord();
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
          if (!dialog.propertyLeadingComments) dialog.propertyLeadingComments = createNameRecord();
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
    }
  }

  private shouldSkipChildren(type: string, node: TreeSitterNode): boolean {
    if (type === 'instance_declaration') {
      if (this.currentInstance) this.analyzeDialogBody(node, this.currentInstance);
      // Instance bodies have their own projection boundary. Never recursively
      // treat branch assignments or compound writes as unconditional properties.
      return true;
    }
    const isConditionFunc = this.isCurrentConditionFunction();
    // A condition function is analyzed as a complete body, once. Never walk
    // its expression descendants as statements or independent predicates.
    if (isConditionFunc && type === 'function_declaration') {
      const body = node.childForFieldName('body');
      if (body) this.analyzeConditionBody(body);
      return true;
    }

    if (type === 'variable_declaration' && this.currentFunction) {
      this.preserveUnsupportedStatement(node);
      return true;
    }

    if (type === 'expression_statement' && this.currentFunction) {
      const expressions = node.namedChildren.filter(child => child.type !== 'comment');
      if (expressions.length !== 1 || expressions[0].type !== 'call_expression') {
        this.preserveUnsupportedStatement(node);
        return true;
      }
    }

    if (this.currentFunction && !isConditionFunc && isConditionModeBlockingStatement(type)) {
      if (type === 'if_statement') {
        const conditionalAction = this.parseConditionalAction(node);
        if (conditionalAction) {
          this.recordActionForCurrentFunction(atLine(conditionalAction, node));
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

  private isDirectPropertyAssignment(node: TreeSitterNode): boolean {
    return node.type === 'assignment_statement' &&
      node.childForFieldName('left')?.type === 'identifier' &&
      getAssignmentOperator(node) === '=';
  }

  private analyzeDialogBody(node: TreeSitterNode, dialog: Dialog): void {
    const body = node.childForFieldName('body');
    if (!body) return;
    const seen = new Set<string>();
    let representable = true;
    for (const statement of body.namedChildren) {
      if (statement.type === 'comment') continue;
      if (!this.isDirectPropertyAssignment(statement)) {
        representable = false;
        continue;
      }
      const key = statement.childForFieldName('left')!.text.toLowerCase();
      if (seen.has(key) || hasComment(statement)) representable = false;
      seen.add(key);
    }
    // Metadata comes only from direct simple writes, even in raw mode. It is
    // not an evaluation of the constructor's final runtime state.
    for (const statement of body.namedChildren) {
      if (this.isDirectPropertyAssignment(statement)) this.processAssignment(statement);
    }
    if (!representable) {
      dialog.sourceBody = { text: body.text, propertyValues: snapshotDialogProperties(dialog.properties) };
    }
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
        this.recordActionForCurrentFunction(atLine(new CommentAction(node.text), node));
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

  /**
   * The flat editor model represents exactly one if/return-TRUE guard, or an
   * unconditional TRUE return. Prove that shape before projecting expressions;
   * everything else keeps the original statements in source order. In
   * particular, nested branches must not become eager logical expressions.
   */
  private analyzeConditionBody(body: TreeSitterNode): void {
    if (!this.currentFunction) return;
    const statements = body.namedChildren;
    if (statements.length === 0) return;
    const executable = statements.filter(statement => statement.type !== 'comment');
    if (executable.length === 1 && this.isCanonicalTrueReturn(executable[0])) {
      this.captureConditionBodyComments(statements, executable[0]);
      return;
    }

    if (executable.length === 1 && executable[0].type === 'if_statement') {
      const guard = executable[0];
      const condition = guard.childForFieldName('condition');
      const consequence = guard.childForFieldName('consequence');
      const alternative = guard.childForFieldName('alternative');
      const branch = consequence?.namedChildren ?? [];
      // Only comments outside the guard have unambiguous metadata slots.
      // Comments in its header or branch require the verbatim body instead.
      if (condition && !hasComment(guard) && !alternative &&
          branch.length === 1 && this.isCanonicalTrueReturn(branch[0])) {
        const operators = this.collectLogicalOperators(condition);
        if (operators.size <= 1) {
          this.captureConditionBodyComments(statements, guard);
          this.currentFunction.conditionOperator = operators.has('||') ? 'OR' : 'AND';
          for (const clause of this.collectConditionClauses(condition)) {
            const functionName = clause.type === 'call_expression'
              ? clause.childForFieldName('function')?.text : undefined;
            this.processCondition(clause, functionName);
          }
          return;
        }
      }
    }

    for (const statement of statements) {
      const action = statement.type === 'comment'
        ? new CommentAction(statement.text) : new Action(statement.text.trim());
      this.recordActionForCurrentFunction(atLine(action, statement));
    }
  }

  private captureConditionBodyComments(statements: TreeSitterNode[], statement: TreeSitterNode): void {
    if (!this.currentFunction) return;
    const index = statements.indexOf(statement);
    this.currentFunction.conditionBodyLeadingComments = statements.slice(0, index).map(node => node.text);
    this.currentFunction.conditionBodyTrailingComments = statements.slice(index + 1).map(node => node.text);
  }

  private isCanonicalTrueReturn(node: TreeSitterNode): boolean {
    if (node.type !== 'return_statement') return false;
    const text = node.text.trim().replace(/\s+/g, ' ').toUpperCase();
    return text === 'RETURN TRUE;' || text === 'RETURN 1;';
  }

  private unwrapParens(node: TreeSitterNode): TreeSitterNode {
    let current = node;
    while (current.type === 'parenthesized_expression' && current.namedChildren.length === 1) {
      current = current.namedChildren[0];
    }
    return current;
  }

  /** Only logical composition is recursive; every other expression is atomic. */
  private collectConditionClauses(node: TreeSitterNode): TreeSitterNode[] {
    const expression = this.unwrapParens(node);
    if (expression.type === 'binary_expression' && isLogicalOperator(getBinaryOperator(expression))) {
      return expression.namedChildren.flatMap(child => this.collectConditionClauses(child));
    }
    return [expression];
  }

  private collectLogicalOperators(node: TreeSitterNode): Set<string> {
    const expression = this.unwrapParens(node);
    const operators = new Set<string>();
    if (expression.type !== 'binary_expression') return operators;
    const operator = getBinaryOperator(expression);
    if (!operator || !isLogicalOperator(operator)) return operators;
    operators.add(operator);
    for (const child of expression.namedChildren.filter(child => child.type !== 'comment')) {
      for (const nested of this.collectLogicalOperators(child)) operators.add(nested);
    }
    return operators;
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
            this.addDialogForFunction(functionName, this.currentInstance);
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
      this.currentInstance.propertyFormatting = createNameRecord();
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
    const action = this.parseAssignmentAction(node);
    if (action) this.recordActionForCurrentFunction(atLine(action, node));
  }

  private parseAssignmentAction(node: TreeSitterNode): SetVariableAction | null {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');

    if (leftNode && rightNode) {
      const variableName = leftNode.text;
      const operator = getAssignmentOperator(node);
      const value = parseLiteralOrIdentifier(rightNode);

      const action = new SetVariableAction(variableName, operator, value);
      if (hasComment(node)) {
        action.sourceText = node.text;
        action.sourceAssignment = captureAssignmentSource(node, action);
      }
      return action;
    }
    return null;
  }

  /**
   * Process function calls in function bodies
   */
  private processFunctionCall(node: TreeSitterNode): void {
    const functionName = node.childForFieldName('function')?.text;
    if (!functionName || !this.currentFunction) {
      return;
    }

    if (!this.isTopLevelCallStatement(node)) {
      return;
    }

    const action = ActionParsers.parseSemanticAction(node, functionName);
    if (action) {
      this.recordActionForCurrentFunction(atLine(action, node));
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

  /**
   * Record a call in `calls` and `callSites`, and answer the name recorded
   * (null when there is no current function or no callee node). This is the
   * whole of what a skipped subtree contributes: no action, no condition.
   */
  private recordCallSite(node: TreeSitterNode): string | null {
    const funcToCallNode = node.childForFieldName('function');
    if (!funcToCallNode || !this.currentFunction) {
      return null;
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

    return functionName;
  }

  /**
   * Sweep the complete function body once for calls. `callSites` is the
   * project index's only view of a call, including calls in local initializers
   * and raw statements that semantic extraction does not descend into.
   */
  private recordCallSitesInSubtree(node: TreeSitterNode): void {
    for (const child of node.namedChildren) {
      if (child.type === 'call_expression') {
        this.recordCallSite(child);
      }
      this.recordCallSitesInSubtree(child);
    }
  }

  private recordActionForCurrentFunction(action: DialogAction): void {
    if (!this.currentFunction) return;
    this.currentFunction.actions.push(action);

    for (const dialog of this.findDialogsForFunction(this.currentFunction.name)) {
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
      this.currentFunction.conditions.push(atLine(condition, node));
    }
  }

  private isCurrentConditionFunction(): boolean {
    return !!this.currentFunction && this.conditionFunctions.has(this.currentFunction.name);
  }

  private isFunctionTopLevelComment(node: TreeSitterNode): boolean {
    const parent = node.parent;
    if (!parent || parent.type !== 'block') return false;
    const grandParent = parent.parent;
    return !!grandParent && grandParent.type === 'function_declaration';
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
    this.recordActionForCurrentFunction(atLine(action, node));
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

    // Parentheses are syntax nodes, not characters to count: strings and
    // comments may contain arbitrary parentheses. Preserve commented headers
    // raw so trimming cannot move a closing delimiter into a line comment.
    if (hasComment(conditionNode) || node.namedChildren.some(child => child.type === 'comment')) {
      return null;
    }
    const conditionText = conditionNode.type === 'parenthesized_expression'
      ? conditionNode.text.slice(1, -1).trim() : conditionNode.text.trim();
    return new ConditionalAction(conditionText, thenActions, elseActions || []);
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
        actions.push(atLine(new CommentAction(child.text), child));
        continue;
      }

      const action = this.parseActionStatementNode(child);
      if (!action) {
        return null;
      }
      actions.push(atLine(action, child));
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
      return this.parseAssignmentAction(node);
    }

    if (node.type === 'if_statement') {
      return this.parseConditionalAction(node);
    }

    if (node.type === 'variable_declaration') {
      return new Action(node.text.trim());
    }

    return null;
  }

  private addDialogForFunction(functionName: string, dialog: Dialog): void {
    const key = functionName.toLowerCase();
    const dialogs = this.functionToDialogs.get(key) ?? [];
    if (!dialogs.includes(dialog)) dialogs.push(dialog);
    this.functionToDialogs.set(key, dialogs);
  }

  /** Find every dialog using a function, caching even unowned-function misses. */
  private findDialogsForFunction(functionName: string): Dialog[] {
    const key = functionName.toLowerCase();
    const cached = this.functionToDialogs.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const matches: Dialog[] = [];
    for (const dialog of Object.values(this.dialogs)) {
      const information = getDialogProperty(dialog.properties, 'information');
      const informationName = typeof information === 'string'
        ? information
        : (information && typeof information === 'object' && 'name' in information
          ? information.name
          : null);

      if (namesEqual(informationName, functionName)) {
        matches.push(dialog);
      }
    }

    this.functionToDialogs.set(key, matches);
    return matches;
  }
}
