// Condition parsing logic for Daedalus dialog semantic analysis

import {
  TreeSitterNode,
  DialogCondition,
  NpcKnowsInfoCondition,
  Condition
} from './semantic-model';

export class ConditionParsers {

  /**
   * Parse a semantic condition based on function name
   */
  static parseSemanticCondition(node: TreeSitterNode, functionName: string): DialogCondition | null {
    switch (functionName) {
      case 'Npc_KnowsInfo':
        return ConditionParsers.parseNpcKnowsInfoCall(node);
      default:
        return ConditionParsers.parseGenericCondition(node);
    }
  }

  /**
   * Parse Npc_KnowsInfo function call
   */
  static parseNpcKnowsInfoCall(node: TreeSitterNode): NpcKnowsInfoCondition | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ConditionParsers.parseArguments(argsNode);
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
   * Parse arguments from argument list node
   */
  static parseArguments(argsNode: TreeSitterNode): string[] {
    const args: string[] = [];
    for (let i = 0; i < argsNode.childCount; i++) {
      const child = argsNode.child(i);
      if (child.type !== ',' && child.type !== '(' && child.type !== ')') {
        args.push(child.text.replace(/"/g, '')); // Remove quotes from string literals
      }
    }
    return args;
  }
}
