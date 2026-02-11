// Condition parsing logic for Daedalus dialog semantic analysis

import {
  TreeSitterNode,
  DialogCondition,
  NpcKnowsInfoCondition,
  Condition,
  VariableCondition
} from '../semantic-model';
import { parseArguments, normalizeArgumentText } from './argument-parsing';

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
  static parseBinaryExpression(node: TreeSitterNode): VariableCondition | null {
    // binary_expression structure: [left, operator, right]
    // The grammar does not assign field names to binary_expression parts
    if (node.childCount < 3) return null;

    const left = node.child(0);
    const operator = node.child(1);
    const right = node.child(2);

    if (!left || !operator || !right) return null;

    const op = operator.text;
    if (!ConditionParsers.isComparisonOperator(op)) {
      return null;
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
  static parseUnaryExpression(node: TreeSitterNode): VariableCondition | null {
    // Check if it's a negation operator
    const operator = node.child(0);
    if (!operator || operator.text !== '!') {
      return null;
    }

    // Get the operand (the variable being negated)
    const operand = node.childForFieldName('operand');
    if (!operand || operand.type !== 'identifier') {
      return null;
    }

    return new VariableCondition(operand.text.trim(), true);
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

  private static isComparisonOperator(operator: string): boolean {
    return ['==', '!=', '<', '>', '<=', '>='].includes(operator);
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
