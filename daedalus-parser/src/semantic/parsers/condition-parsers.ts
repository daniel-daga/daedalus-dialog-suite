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

/** A structured condition call: the ones the table below owns. */
type ConditionCall = (
  | NpcKnowsInfoCondition
  | NpcHasItemsCondition
  | NpcIsInStateCondition
  | NpcIsDeadCondition
  | NpcGetDistToWpCondition
  | NpcGetTalentSkillCondition
) & { negated: boolean };

/** The `call == value` form a comparison passes to the constructor. */
interface ConditionComparison {
  operator: string;
  value: string | number | boolean;
  valueIsStringLiteral: boolean;
}

/**
 * Every condition call the parser structures. The call switch, the `!` form and
 * the comparison form all read this table, so a new condition cannot land in one
 * of them only (#439). `construct` returns null for a form it cannot represent,
 * which keeps the source verbatim.
 */
const CONDITION_CALLS: Record<string, {
  arity: number;
  construct: (args: string[], comparison?: ConditionComparison) => ConditionCall | null;
}> = {
  npc_knowsinfo: {
    arity: 2,
    // A compared Npc_KnowsInfo has no comparison slot; keep that form verbatim.
    construct: (args, comparison) =>
      comparison ? null : new NpcKnowsInfoCondition(args[0], args[1])
  },
  npc_hasitems: {
    arity: 2,
    construct: (args, comparison) =>
      new NpcHasItemsCondition(
        args[0],
        args[1],
        comparison?.operator,
        comparison?.value,
        comparison?.valueIsStringLiteral
      )
  },
  npc_isinstate: {
    arity: 2,
    construct: (args, comparison) =>
      withBoolComparison(new NpcIsInStateCondition(args[0], args[1]), comparison)
  },
  npc_isdead: {
    arity: 1,
    construct: (args, comparison) =>
      withBoolComparison(new NpcIsDeadCondition(args[0]), comparison)
  },
  npc_getdisttowp: {
    arity: 2,
    construct: (args, comparison) =>
      new NpcGetDistToWpCondition(
        args[0],
        args[1],
        comparison?.operator,
        comparison?.value,
        comparison?.valueIsStringLiteral
      )
  },
  npc_gettalentskill: {
    arity: 2,
    construct: (args, comparison) =>
      new NpcGetTalentSkillCondition(
        args[0],
        args[1],
        comparison?.operator,
        comparison?.value,
        comparison?.valueIsStringLiteral
      )
  }
};

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
      return ConditionParsers.constructCondition(functionName, node)
        ?? ConditionParsers.parseGenericCondition(node);
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
      const fnName = operand.childForFieldName('function')?.text?.trim();
      const parsed = fnName && ConditionParsers.constructCondition(fnName, operand);
      if (parsed) {
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
    const fnName = callNode.childForFieldName('function')?.text?.trim();
    if (!fnName) return null;
    return ConditionParsers.constructCondition(fnName, callNode, {
      operator,
      value: ConditionParsers.parseBinaryValue(otherNode),
      valueIsStringLiteral: otherNode.type === 'string'
    });
  }

  /** Build a structured call from the table, or null for an unowned or mismatched form. */
  private static constructCondition(
    functionName: string,
    node: TreeSitterNode,
    comparison?: ConditionComparison
  ): ConditionCall | null {
    // Daedalus identifiers are case-insensitive, so dispatch on a normalized key.
    const call = CONDITION_CALLS[functionName.toLowerCase()];
    if (!call) return null;
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length !== call.arity) return null;
    return call.construct(args, comparison);
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

/** `call == FALSE` / `call != TRUE` normalize to a negated call; anything else keeps the source. */
function withBoolComparison(
  condition: ConditionCall,
  comparison?: ConditionComparison
): ConditionCall | null {
  if (!comparison) return condition;
  if (comparison.valueIsStringLiteral) return null;

  const normalized = String(comparison.value).trim().toUpperCase();
  const isTrueLike = normalized === 'TRUE' || normalized === '1';
  const isFalseLike = normalized === 'FALSE' || normalized === '0';
  if (!isTrueLike && !isFalseLike) {
    return null;
  }

  if (comparison.operator === '==') {
    condition.negated = isFalseLike;
  } else if (comparison.operator === '!=') {
    condition.negated = isTrueLike;
  } else {
    return null;
  }
  return condition;
}
