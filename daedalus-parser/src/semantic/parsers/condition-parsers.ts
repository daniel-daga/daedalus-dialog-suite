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
import { parseArguments, normalizeArgumentText } from './argument-parsing';
import { getBinaryOperator, isComparisonOperator } from './ast-constants';

export class ConditionParsers {

  /**
   * Parse a semantic condition based on node type
   */
  static parseSemanticCondition(node: TreeSitterNode, functionName?: string): DialogCondition | null {
    // For call expressions, check function name
    if (functionName) {
      switch (functionName) {
        case 'Npc_KnowsInfo':
          return ConditionParsers.parseNpcKnowsInfoCall(node);
        case 'Npc_HasItems':
          return ConditionParsers.parseNpcHasItemsCall(node);
        case 'Npc_IsInState':
          return ConditionParsers.parseNpcIsInStateCall(node);
        case 'Npc_IsDead':
          return ConditionParsers.parseNpcIsDeadCall(node);
        case 'Npc_GetDistToWP':
          return ConditionParsers.parseNpcGetDistToWpCall(node);
        case 'Npc_GetTalentSkill':
          return ConditionParsers.parseNpcGetTalentSkillCall(node);
        default:
          return ConditionParsers.parseGenericCondition(node);
      }
    }

    // For other node types, handle based on node type
    switch (node.type) {
      case 'identifier':
        return ConditionParsers.parseVariableCondition(node);
      case 'unary_expression':
        return ConditionParsers.parseUnaryExpression(node);
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
    // binary_expression structure: [left, operator, right]
    // The grammar does not assign field names to binary_expression parts
    if (node.childCount < 3) return null;

    const left = node.child(0);
    const right = node.child(2);

    if (!left || !right) return null;

    const op = getBinaryOperator(node);
    if (!isComparisonOperator(op)) {
      return null;
    }

    const callComparison = ConditionParsers.parseSupportedCallComparison(left, right, op);
    if (callComparison) {
      return callComparison;
    }

    // Normalize comparisons so VariableCondition always stores an identifier as variableName.
    if (left.type === 'identifier') {
      const parsedValue = ConditionParsers.parseBinaryValue(right);
      return new VariableCondition(left.text, false, op, parsedValue);
    }

    if (right.type === 'identifier') {
      const parsedValue = ConditionParsers.parseBinaryValue(left);
      const normalizedOperator = ConditionParsers.invertComparisonOperator(op);
      return new VariableCondition(right.text, false, normalizedOperator, parsedValue);
    }

    return null;
  }

  /**
   * Parse Npc_KnowsInfo function call
   */
  static parseNpcKnowsInfoCall(node: TreeSitterNode): NpcKnowsInfoCondition | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = parseArguments(argsNode);
    if (args.length < 2) return null;

    return new NpcKnowsInfoCondition(args[0], args[1]);
  }

  static parseNpcHasItemsCall(node: TreeSitterNode): NpcHasItemsCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length < 2) return null;
    return new NpcHasItemsCondition(args[0], args[1]);
  }

  static parseNpcIsInStateCall(node: TreeSitterNode): NpcIsInStateCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length < 2) return null;
    return new NpcIsInStateCondition(args[0], args[1], false);
  }

  static parseNpcIsDeadCall(node: TreeSitterNode): NpcIsDeadCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length < 1) return null;
    return new NpcIsDeadCondition(args[0], false);
  }

  static parseNpcGetDistToWpCall(node: TreeSitterNode): NpcGetDistToWpCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length < 2) return null;
    return new NpcGetDistToWpCondition(args[0], args[1]);
  }

  static parseNpcGetTalentSkillCall(node: TreeSitterNode): NpcGetTalentSkillCondition | null {
    const args = ConditionParsers.parseRawCallArguments(node);
    if (args.length < 2) return null;
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

      if (fnName === 'Npc_IsDead') {
        const parsed = ConditionParsers.parseNpcIsDeadCall(operand);
        if (!parsed) return null;
        parsed.negated = true;
        return parsed;
      }

      if (fnName === 'Npc_IsInState') {
        const parsed = ConditionParsers.parseNpcIsInStateCall(operand);
        if (!parsed) return null;
        parsed.negated = true;
        return parsed;
      }
    }

    return null;
  }

  private static parseSupportedCallComparison(
    left: TreeSitterNode,
    right: TreeSitterNode,
    operator: string
  ): DialogCondition | null {
    if (left.type === 'call_expression') {
      return ConditionParsers.parseSupportedCallComparisonWithCall(left, right, operator);
    }
    if (right.type === 'call_expression') {
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

    switch (fnName) {
      case 'Npc_HasItems':
        if (args.length < 2) return null;
        return new NpcHasItemsCondition(args[0], args[1], operator, value);
      case 'Npc_GetDistToWP':
        if (args.length < 2) return null;
        return new NpcGetDistToWpCondition(args[0], args[1], operator, value);
      case 'Npc_GetTalentSkill':
        if (args.length < 2) return null;
        return new NpcGetTalentSkillCondition(args[0], args[1], operator, value);
      case 'Npc_IsDead':
        if (args.length < 1) return null;
        return ConditionParsers.parseBoolLikeComparisonAsNegation(
          new NpcIsDeadCondition(args[0], false),
          operator,
          value
        );
      case 'Npc_IsInState':
        if (args.length < 2) return null;
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
      if (child.type !== ',' && child.type !== '(' && child.type !== ')') {
        args.push(child.text.trim());
      }
    }
    return args;
  }

  private static parseBinaryValue(node: TreeSitterNode): string | number | boolean {
    if (node.type === 'number') {
      return Number(node.text);
    }
    if (node.type === 'string') {
      return normalizeArgumentText(node);
    }
    return node.text.trim();
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
