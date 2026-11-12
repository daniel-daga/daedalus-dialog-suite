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
  snapshotDialogProperties,
  snapshotCondition,
  ConditionSpelling
} from '../semantic-model';
import { ActionParsers } from '../parsers/action-parsers';
import { ConditionParsers } from '../parsers/condition-parsers';
import { parseArgumentsDetailed, ParsedArg } from '../parsers/argument-parsing';
import {
  getBinaryOperator,
  getAssignmentOperator,
  isLogicalOperator,
  isConditionModeBlockingStatement,
  hasComment
} from '../parsers/ast-constants';
import { parseLiteralOrIdentifier } from '../parsers/literal-parsing';
import { captureAssignmentSource } from '../action-source';
import { createNameRecord } from '../name-utils';
import { referenceIdentifier } from '../reference-expression';

/**
 * Stamp a parsed action or condition with the 1-based line of the node it came
 * from, so a Problems finding can name one (#267). Every construction site in
 * this file already holds the node; nothing else in the pipeline does.
 */
const atLine = <T>(item: T, node: TreeSitterNode): T & SourceLine => {
  const located = item as T & SourceLine;
  located.line = node.startPosition.row + 1;
  const sourceIndent = multiLineIndent(node);
  if (sourceIndent) located.sourceIndent = sourceIndent;
  return located;
};

/** The whitespace a multi-line statement's first line starts with (#384); see SourceLine. */
function multiLineIndent(node: TreeSitterNode): string | undefined {
  if (!node.text.includes('\n')) return undefined;
  let container = node.parent;
  while (container && container.startIndex === node.startIndex) container = container.parent;
  if (!container) return undefined;
  const before = container.text.slice(0, node.startIndex - container.startIndex);
  const lineStart = before.lastIndexOf('\n');
  if (lineStart < 0) return undefined;
  const indent = before.slice(lineStart + 1);
  return indent && /^[ \t]+$/.test(indent) ? indent : undefined;
}

/**
 * The deepest nesting of `if`/`else if`, and of calls inside calls, the model
 * holds (#538). Hydrating and generating recurse once per conditional and
 * overflowed the stack from ~900 levels; every call site keeps its arguments'
 * text, so nested calls grow the model quadratically (10,000 levels: 287 MB).
 * The build refuses past this bound, so every model it returns can be saved.
 * Retail scripts nest a handful of levels.
 */
export const MAX_NESTING_DEPTH = 256;

/** Thrown by the linking pass at the node that crosses the bound. */
export class NestingTooDeepError extends Error {
  constructor(public readonly node: TreeSitterNode, public readonly what: 'if/else' | 'nested call') {
    super(`${what} nesting deeper than ${MAX_NESTING_DEPTH} levels`);
  }
}

export class LinkingVisitor {
  private dialogs: SemanticModel['dialogs'];
  private functions: SemanticModel['functions'];
  private functionNameMap: Map<string, string>;
  private currentInstance: Dialog | null;
  private currentFunction: DialogFunction | null;
  private conditionFunctions: Set<string>;
  // Ranges (`startIndex:endIndex`) of comment nodes already consumed as an
  // AI_Output subtitle, so they are not also re-emitted as standalone comments.
  private consumedCommentRanges: Set<string>;
  /** Arguments already parsed for a call site, by call start, so the action
   *  parser does not parse the same argument list twice (#541). */
  private callArgs: Map<number, ParsedArg[]>;
  private conditionalDepth = 0;

  constructor(semanticModel: SemanticModel, functionNameMap: Map<string, string>) {
    this.dialogs = semanticModel.dialogs;
    this.functions = semanticModel.functions;
    this.functionNameMap = functionNameMap;
    this.currentInstance = null;
    this.currentFunction = null;
    this.conditionFunctions = new Set<string>();
    this.consumedCommentRanges = new Set<string>();
    this.callArgs = new Map<number, ParsedArg[]>();
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
        if (!left || !right) continue;
        const reference = referenceIdentifier(right);
        if (reference === undefined) continue;
        const propertyKey = left.text.toLowerCase();
        const originalName = this.functionNameMap.get(reference.toLowerCase());
        const functionName = originalName || reference;
        if (propertyKey === 'condition') {
          this.conditionFunctions.add(functionName);
        }
      }
    }
  }

  private analyzeNodeRecursively(cursor: TreeCursor): void {
    const type = cursor.nodeType;
    const node = cursor.currentNode;

    this.enterDeclarationContext(type, node);

    const skipChildren = this.shouldSkipChildren(type, node);

    // A skipped subtree is never projected, so one walk over it is all the
    // project index needs — and the only walk. Indexing runs before the
    // statement is handled, so nothing below materialises a node twice (#541).
    if (skipChildren && this.currentFunction) {
      this.recordCallSitesInSubtree(node);
    }
    this.handleStatementNode(type, node);

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
        const dialog = this.dialogs[nameNode.text];
        // Pass 1 keeps the first declaration of a repeated name and flags the
        // rest (#447); the rejected body must not be projected into it.
        this.currentInstance = dialog?.range?.startIndex === node.startIndex ? dialog : null;
        if (this.currentInstance) {
          this.captureDialogBodyComments(node, this.currentInstance);
        }
      }
      return;
    }

    if (type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      const stored = this.functions[nameNode.text];
      // Same rule for functions: only the declaration pass 1 stored is analysed.
      this.currentFunction = stored?.range?.startIndex === node.startIndex ? stored : null;
      const body = node.childForFieldName('body');
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
    let trailingCommentStart = -1;
    for (const child of body.namedChildren) {
      if (child.type === 'comment') {
        if (prevKey !== null && child.startPosition.row === prevEndRow) {
          if (!dialog.propertyTrailingComments) dialog.propertyTrailingComments = createNameRecord();
          if (trailingCommentStart < 0) trailingCommentStart = child.startIndex;
          // One string can hold the entire trailing comment run, including
          // its original gaps. Keep the existing JSON shape, never overwrite
          // an earlier token with a later one on the same property line.
          dialog.propertyTrailingComments[prevKey] = body.text.slice(
            trailingCommentStart - body.startIndex, child.endIndex - body.startIndex
          );
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
        trailingCommentStart = -1;
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
      this.callArgs.clear();
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

    // Below a call or an assignment there is nothing left to project: a
    // nested call is no action, a comment there is no top-level comment, and
    // an assignment never nests in an expression. Handle the node itself and
    // stop, instead of materialising every argument and operand (#541).
    if (this.currentFunction && (type === 'call_expression' || type === 'assignment_statement')) {
      return true;
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
    // #440: the blank lines before a property are recorded the way #286 does
    // for declarations, measured from the previous statement or comment.
    let previousEndRow = body.startPosition.row;
    for (const statement of body.namedChildren) {
      if (this.isDirectPropertyAssignment(statement)) {
        const blankLines = statement.startPosition.row - previousEndRow - 1;
        if (blankLines > 0) {
          (dialog.propertyBlankLinesBefore ??= {})[statement.childForFieldName('left')!.text] = blankLines;
        }
        this.processAssignment(statement);
      }
      previousEndRow = statement.endPosition.row;
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
      // Preserve this intentional condition state explicitly; an empty projected
      // body alone is not enough to infer a success return during generation.
      this.currentFunction.hasExplicitTrueReturn = true;
      this.currentFunction.conditionSource = { text: executable[0].text, operator: 'AND', clauses: [] };
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
          const operator = operators.has('||') ? 'OR' : 'AND';
          this.currentFunction.conditionOperator = operator;
          const clauses = this.collectConditionClauses(condition);
          let projected = 0;
          for (const clause of clauses) {
            const functionName = clause.type === 'call_expression'
              ? clause.childForFieldName('function')?.text : undefined;
            if (this.processCondition(clause, functionName)) projected++;
          }
          // Spans align with conditions only if every clause became one.
          if (projected === clauses.length) {
            this.currentFunction.conditionSource = {
              text: guard.text,
              operator,
              clauses: clauses.map(clause => ({ start: clause.startIndex - guard.startIndex, end: clause.endIndex - guard.startIndex }))
            };
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
          if (rightNode.text !== functionName) {
            (this.currentInstance.propertyReferenceSpelling ??= {})[propertyName] = rightNode.text;
          }
        } else {
          value = rightNode.text;
        }
      } else if (rightNode.type === 'string') {
        // The contents; the quotes are syntax, and `propertyLiteralKeys` keeps the kind.
        value = rightNode.text.slice(1, -1);
      } else {
        value = parseLiteralOrIdentifier(rightNode);
      }

      // Preserve AST identity for bare identifiers and verbatim numeric tokens
      // as well as compound expressions. Only string literals may be quoted.
      if (typeof value === 'string' && rightNode.type !== 'string') {
        this.markPropertyExpression(propertyName);
      }
      if (rightNode.type === 'string') {
        this.currentInstance.propertyLiteralKeys ??= [];
        if (!this.currentInstance.propertyLiteralKeys.includes(propertyName)) {
          this.currentInstance.propertyLiteralKeys.push(propertyName);
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

    const action = ActionParsers.parseSemanticAction(node, functionName, this.callArgs.get(node.startIndex));
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
    const args = argsNode ? parseArgumentsDetailed(argsNode) : [];
    this.currentFunction.callSites.push({
      functionName,
      args,
      position: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1
      }
    });
    // Hand the parsed list to the action parser for this same call (#541).
    this.callArgs.set(node.startIndex, args);

    return functionName;
  }

  /**
   * Sweep the complete function body once for calls. `callSites` is the
   * project index's only view of a call, including calls in local initializers
   * and raw statements that semantic extraction does not descend into.
   */
  private recordCallSitesInSubtree(root: TreeSitterNode): void {
    // Pre-order, as the calls appear in the source. Only a call is
    // materialised as a node; every other step reads the cursor (#541).
    // `openCalls` holds the tree depth of each enclosing call, popped as the
    // walk leaves it, so call-in-call nesting is bounded (#538).
    const cursor = root.walk();
    const openCalls: number[] = [];
    let depth = 0;
    for (;;) {
      if (cursor.nodeType === 'call_expression') {
        if (openCalls.length >= MAX_NESTING_DEPTH) throw new NestingTooDeepError(cursor.currentNode, 'nested call');
        openCalls.push(depth);
        this.recordCallSite(cursor.currentNode);
      }
      if (cursor.gotoFirstChild()) {
        depth++;
        continue;
      }
      for (;;) {
        if (openCalls[openCalls.length - 1] === depth) openCalls.pop();
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return;
        depth--;
      }
    }
  }

  private recordActionForCurrentFunction(action: DialogAction): void {
    if (!this.currentFunction) return;
    this.currentFunction.actions.push(action);
  }

  /**
   * Process condition expressions (call expressions, identifiers, unary expressions)
   */
  private processCondition(node: TreeSitterNode, functionName?: string): boolean {
    if (!this.currentFunction) return false;

    const condition = ConditionParsers.parseSemanticCondition(node, functionName);
    if (!condition) return false;
    const located: typeof condition & ConditionSpelling = atLine(condition, node);
    located.sourceText = node.text;
    located.sourceBaseline = snapshotCondition(located);
    this.currentFunction.conditions.push(located);
    return true;
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
    if (this.conditionalDepth >= MAX_NESTING_DEPTH) throw new NestingTooDeepError(node, 'if/else');
    this.conditionalDepth++;
    try {
      return this.parseConditionalActionAt(node);
    } finally {
      this.conditionalDepth--;
    }
  }

  private parseConditionalActionAt(node: TreeSitterNode): ConditionalAction | null {
    const conditionNode = node.childForFieldName('condition');
    const consequenceNode = node.childForFieldName('consequence');
    const alternativeNode = node.childForFieldName('alternative');

    if (!conditionNode || !consequenceNode) {
      return null;
    }

    if (alternativeNode && alternativeNode.type !== 'block' && alternativeNode.type !== 'if_statement') {
      return null;
    }

    const thenActions = this.parseActionsFromBlock(consequenceNode);
    if (!thenActions) {
      return null;
    }

    let elseActions: DialogAction[];
    if (!alternativeNode) {
      elseActions = [];
    } else if (alternativeNode.type === 'if_statement') {
      // `else if` (#432): the chained conditional is the else branch's only action.
      const chained = this.parseConditionalAction(alternativeNode);
      if (!chained) {
        return null;
      }
      chained.elseIf = true;
      elseActions = [atLine(chained, alternativeNode)];
    } else {
      const parsed = this.parseActionsFromBlock(alternativeNode);
      if (!parsed) {
        return null;
      }
      elseActions = parsed;
    }

    // Parentheses are syntax nodes, not characters to count: strings and
    // comments may contain arbitrary parentheses. Preserve commented headers
    // raw so trimming cannot move a closing delimiter into a line comment.
    if (hasComment(conditionNode) || node.namedChildren.some(child => child.type === 'comment')) {
      return null;
    }
    const parenthesized = conditionNode.type === 'parenthesized_expression';
    const conditionText = parenthesized ? conditionNode.text.slice(1, -1).trim() : conditionNode.text.trim();
    const action = new ConditionalAction(conditionText, thenActions, elseActions || []);
    if (!parenthesized) action.bareCondition = true;
    const keyword = node.child(0)?.text;
    if (keyword && keyword !== 'if') action.keyword = keyword;
    if (alternativeNode && elseActions?.length === 0) action.emptyElse = true;
    // #522: the `;` written between the consequence block and `else` is the
    // if's branch separator, not its terminator; keep it.
    const elseIndex = node.children.findIndex(child => child.type === 'else');
    if (elseIndex > 0 && node.children[elseIndex - 1].type === ';') action.thenTerminated = true;
    if (node.child(node.childCount - 1)?.type !== ';') action.unterminated = true;
    return action;
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

      return ActionParsers.parseSemanticAction(callNode, functionNode.text, this.callArgs.get(callNode.startIndex));
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

}
