// Condition parsing logic for Daedalus dialog semantic analysis

import {
  TreeSitterNode,
  DialogCondition,
  NpcKnowsInfoCondition,
  NpcHasItemsCondition,
  NpcIsInStateCondition,
  NpcIsDeadCondition,
  NpcGetDistToWpCondition,
  NpcGetTalentSkillCondition,
  Condition,
  VariableCondition
} from '../semantic-model';
import { isArgumentNode } from './argument-parsing';
import { parseLiteralOrIdentifier } from './literal-parsing';
import { getBinaryOperator, isComparisonOperator, hasComment } from './ast-constants';

import { captureCallIdentity } from './call-identity';

export class ConditionParsers {

  /**
   * Parse a semantic condition based on node type
   */
  static parseSemanticCondition(node: TreeSitterNode, functionName?: string): DialogCondition | null {
    const condition = ConditionParsers.parseSpecificCondition(node, functionName);
    if (condition && condition.type !== 'Condition' && condition.type !== 'VariableCondition') {
      captureCallIdentity(condition, node);
    }
    return condition;
  }

  private static parseSpecificCondition(node: TreeSitterNode, functionName?: string): DialogCondition | null {
    // Structured fields cannot represent comments between operands/arguments.
    if (hasComment(node)) return ConditionParsers.parseGenericCondition(node);
    // For call expressions, check function name. Daedalus identifiers are
    // case-insensitive, so dispatch on a normalized key.
    if (functionName) {
      switch (functionName.toLowerCase()) {
        case 'npc_knowsinfo':
          return ConditionParsers.parseNpcKnowsInfoCall(node) ?? ConditionParsers.parseGenericCondition(node);
        case 'npc_hasitems':
          return ConditionParsers.parseNpcHasItemsCall(node) ?? ConditionParsers.parseGenericCondition(node);
        case 'npc_isinstate':
          return ConditionParsers.parseNpcIsInStateCall(node) ?? ConditionParsers.parseGenericCondition(node);
        case 'npc_isdead':
          return ConditionParsers.parseNpcIsDeadCall(node) ?? ConditionParsers.parseGenericCondition(node);
        case 'npc_getdisttowp':
          return ConditionParsers.parseNpcGetDistToWpCall(node) ?? ConditionParsers.parseGenericCondition(node);
        case 'npc_gettalentskill':
          return ConditionParsers.parseNpcGetTalentSkillCall(node) ?? ConditionParsers.parseGenericCondition(node);
        default:
          return ConditionParsers.parseGenericCondition(node);
      }
    }

    // For other node types, handle based on node type
    switch (node.type) {
      case 'identifier':
        return ConditionParsers.parseVariableCondition(node);
      case 'unary_expression':
        return ConditionParsers.parseUnaryExpression(node) ?? ConditionParsers.parseGenericCondition(node);
      case 'binary_expression':
        return ConditionParsers.parseBinaryExpression(node) || ConditionParsers.parseGenericCondition(node);
      default:
        return ConditionParsers.parseGenericCondition(node);
    }
  }

  /**
   * Parse binary expression (e.g. MIS_Test == LOG_RUNNING)
   */
  static parseBinaryExpression(node: TreeSitterNode): DialogCondition | null {
    // Operators are anonymous children; comments are named extras. Neither
    // may be mistaken for an operand when comments appear around the operator.
    const operands = node.namedChildren.filter(child => child.type !== 'comment');
    if (operands.length !== 2) return null;

    const [left, right] = operands;

    if (!left || !right) return null;

    const op = getBinaryOperator(node);
    if (!isComparisonOperator(op)) {
      return null;
    }

    const callComparison = ConditionParsers.parseSupportedCallComparison(left, right, op);
    if (callComparison) {
      return callComparison;
    }

    // A declined call comparison must stay verbatim, including its argument
    // list and operand order; it is not an editable variable comparison.
    if (left.type === 'call_expression' || right.type === 'call_expression') {
      return null;
    }

    // Normalize comparisons so VariableCondition always stores an identifier as variableName.
    if (left.type === 'identifier') {
      const parsedValue = ConditionParsers.parseBinaryValue(right);
      return new VariableCondition(left.text, false, op, parsedValue, right.type === 'string');
    }

    if (right.type === 'identifier' && ConditionParsers.isReorderableLiteral(left)) {
      const parsedValue = ConditionParsers.parseBinaryValue(left);
      const normalizedOperator = ConditionParsers.invertComparisonOperator(op);
      return new VariableCondition(right.text, false, normalizedOperator, parsedValue, left.type === 'string');
    }

    return null;
  }

  /**
   * Parse Npc_KnowsInfo function call
   */
  static parseNpcKnowsInfoCall(node: TreeSitterNode): NpcKnowsInfoCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length !== 2) return null;

    return new NpcKnowsInfoCondition(args[0], args[1]);
  }

  static parseNpcHasItemsCall(node: TreeSitterNode): NpcHasItemsCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length !== 2) return null;
    return new NpcHasItemsCondition(args[0], args[1]);
  }

  static parseNpcIsInStateCall(node: TreeSitterNode): NpcIsInStateCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length !== 2) return null;
    return new NpcIsInStateCondition(args[0], args[1], false);
  }

  static parseNpcIsDeadCall(node: TreeSitterNode): NpcIsDeadCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length !== 1) return null;
    return new NpcIsDeadCondition(args[0], false);
  }

  static parseNpcGetDistToWpCall(node: TreeSitterNode): NpcGetDistToWpCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length !== 2) return null;
    return new NpcGetDistToWpCondition(args[0], args[1]);
  }

  static parseNpcGetTalentSkillCall(node: TreeSitterNode): NpcGetTalentSkillCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length !== 2) return null;
    return new NpcGetTalentSkillCondition(args[0], args[1]);
  }

  /**
   * Parse generic condition expression as Condition
   */
  static parseGenericCondition(node: TreeSitterNode): Condition {
    const conditionText = node.text.trim();
    return new Condition(conditionText);
  }

  /**
   * Parse variable reference (identifier) as VariableCondition
   */
  static parseVariableCondition(node: TreeSitterNode): VariableCondition {
    return new VariableCondition(node.text.trim(), false);
  }

  /**
   * Parse unary expression (e.g., !variable) as VariableCondition with negation
   */
  static parseUnaryExpression(node: TreeSitterNode): DialogCondition | null {
    // Check if it's a negation operator
    const operator = node.child(0);
    if (!operator || operator.text !== '!') {
      return null;
    }

    // Get the operand (the variable being negated)
    const operand = node.childForFieldName('operand');
    if (!operand) {
      return null;
    }

    if (operand.type === 'identifier') {
      return new VariableCondition(operand.text.trim(), true);
    }

    if (operand.type === 'call_expression') {
      const fnNode = operand.childForFieldName('function');
      const fnName = fnNode?.text?.trim();
      if (!fnName) {
        return null;
      }

      // Daedalus identifiers are case-insensitive.
      const dispatchKey = fnName.toLowerCase();
      if (dispatchKey === 'npc_isdead') {
        const parsed = ConditionParsers.parseNpcIsDeadCall(operand);
        if (!parsed) return ConditionParsers.parseGenericCondition(node);
        parsed.negated = true;
        return parsed;
      }

      if (dispatchKey === 'npc_isinstate') {
        const parsed = ConditionParsers.parseNpcIsInStateCall(operand);
        if (!parsed) return ConditionParsers.parseGenericCondition(node);
        parsed.negated = true;
        return parsed;
      }

      if (dispatchKey === 'npc_knowsinfo') {
        const parsed = ConditionParsers.parseNpcKnowsInfoCall(operand);
        if (!parsed) return ConditionParsers.parseGenericCondition(node);
        parsed.negated = true;
        return parsed;
      }
    }

    // Preserve unsupported negated calls and other unary expressions verbatim.
    return new Condition(node.text.trim());
  }

  private static parseSupportedCallComparison(
    left: TreeSitterNode,
    right: TreeSitterNode,
    operator: string
  ): DialogCondition | null {
    if (left.type === 'call_expression') {
      return ConditionParsers.parseSupportedCallComparisonWithCall(left, right, operator);
    }
    if (right.type === 'call_expression' && ConditionParsers.isReorderableLiteral(left)) {
      const inverted = ConditionParsers.invertComparisonOperator(operator);
      return ConditionParsers.parseSupportedCallComparisonWithCall(right, left, inverted);
    }
    return null;
  }

  private static parseSupportedCallComparisonWithCall(
    callNode: TreeSitterNode,
    otherNode: TreeSitterNode,
    operator: string
  ): DialogCondition | null {
    const fnNode = callNode.childForFieldName('function');
    const fnName = fnNode?.text?.trim();
    if (!fnName) return null;

    const args = ConditionParsers.parseRawCallArguments(callNode);
    const value = ConditionParsers.parseBinaryValue(otherNode);
    const valueIsStringLiteral = otherNode.type === 'string';

    // Daedalus identifiers are case-insensitive, so dispatch on a normalized key.
    switch (fnName.toLowerCase()) {
      case 'npc_hasitems':
        if (args.length !== 2) return null;
        return new NpcHasItemsCondition(args[0], args[1], operator, value, valueIsStringLiteral);
      case 'npc_getdisttowp':
        if (args.length !== 2) return null;
        return new NpcGetDistToWpCondition(args[0], args[1], operator, value, valueIsStringLiteral);
      case 'npc_gettalentskill':
        if (args.length !== 2) return null;
        return new NpcGetTalentSkillCondition(args[0], args[1], operator, value, valueIsStringLiteral);
      case 'npc_isdead':
        if (args.length !== 1 || valueIsStringLiteral) return null;
        return ConditionParsers.parseBoolLikeComparisonAsNegation(
          new NpcIsDeadCondition(args[0], false),
          operator,
          value
        );
      case 'npc_isinstate':
        if (args.length !== 2 || valueIsStringLiteral) return null;
        return ConditionParsers.parseBoolLikeComparisonAsNegation(
          new NpcIsInStateCondition(args[0], args[1], false),
          operator,
          value
        );
      default:
        return null;
    }
  }

  private static parseBoolLikeComparisonAsNegation<T extends { negated: boolean }>(
    condition: T,
    operator: string,
    value: string | number | boolean
  ): T | null {
    const normalized = String(value).trim().toUpperCase();
    const isTrueLike = normalized === 'TRUE' || normalized === '1';
    const isFalseLike = normalized === 'FALSE' || normalized === '0';
    if (!isTrueLike && !isFalseLike) {
      return null;
    }

    let negated = false;
    if (operator === '==') {
      negated = isFalseLike;
    } else if (operator === '!=') {
      negated = isTrueLike;
    } else {
      return null;
    }

    condition.negated = negated;
    return condition;
  }

  private static parseRawCallArguments(callNode: TreeSitterNode): string[] {
    const argsNode = callNode.childForFieldName('arguments');
    if (!argsNode) return [];

    const args: string[] = [];
    for (let i = 0; i < argsNode.childCount; i++) {
      const child = argsNode.child(i);
      if (isArgumentNode(child)) {
        args.push(child.text.trim());
      }
    }
    return args;
  }

  // Reversing a compound operand can change associativity and evaluation order.
  // Even an identifier read can observe a value changed by the other operand.
  private static isReorderableLiteral(node: TreeSitterNode): boolean {
    return ['number', 'boolean', 'string'].includes(node.type);
  }

  private static parseBinaryValue(node: TreeSitterNode): string | number | boolean {
    return parseLiteralOrIdentifier(node, {
      normalizeStringLiterals: true,
      trimNonLiterals: true
    });
  }

  private static invertComparisonOperator(operator: string): string {
    switch (operator) {
      case '<':
        return '>';
      case '>':
        return '<';
      case '<=':
        return '>=';
      case '>=':
        return '<=';
      default:
        return operator;
    }
  }
}
