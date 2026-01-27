// Action parsing logic for Daedalus dialog semantic analysis

import {
  TreeSitterNode,
  DialogAction,
  DialogLine,
  CreateTopic,
  LogEntry,
  LogSetTopicStatus,
  Action,
  Choice,
  CreateInventoryItems,
  GiveInventoryItems,
  AttackAction,
  SetAttitudeAction,
  ExchangeRoutineAction,
  ChapterTransitionAction
} from '../semantic-model';

export class ActionParsers {

  /**
   * Parse a semantic action based on function name
   */
  static parseSemanticAction(node: TreeSitterNode, functionName: string): DialogAction | null {
    switch (functionName) {
      case 'AI_Output':
        return ActionParsers.parseAIOutputCall(node);
      case 'Info_AddChoice':
        return ActionParsers.parseInfoAddChoiceCall(node);
      case 'Log_CreateTopic':
        return ActionParsers.parseCreateTopicCall(node);
      case 'B_LogEntry':
        return ActionParsers.parseLogEntryCall(node);
      case 'Log_SetTopicStatus':
        return ActionParsers.parseLogSetTopicStatusCall(node);
      case 'CreateInvItems':
        return ActionParsers.parseCreateInventoryItemsCall(node);
      case 'B_GiveInvItems':
        return ActionParsers.parseGiveInventoryItemsCall(node);
      case 'B_Attack':
        return ActionParsers.parseAttackCall(node);
      case 'B_SetAttitude':
        return ActionParsers.parseSetAttitudeCall(node);
      case 'Npc_ExchangeRoutine':
        return ActionParsers.parseExchangeRoutineCall(node);
      case 'B_Kapitelwechsel':
        return ActionParsers.parseChapterTransitionCall(node);
      default:
        return ActionParsers.parseGenericAction(node);
    }
  }

  /**
   * Generic helper to parse function arguments and create action
   * Reduces duplication across simple action parsers
   */
  private static parseActionWithArgs<T>(
    node: TreeSitterNode,
    minArgs: number,
    factory: (args: string[]) => T | null
  ): T | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < minArgs) return null;

    return factory(args);
  }

  /**
   * Parse AI_Output function call
   * Special handling: looks for comment after call to use as dialog text
   */
  static parseAIOutputCall(node: TreeSitterNode): DialogLine | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 3) return null;

    const speaker = args[0];
    const dialogId = args[2]; // This is typically a dialog ID

    // Look for comment after this AI_Output call to use as readable text
    const comment = ActionParsers.findCommentAfterStatement(node);
    const text = comment || dialogId; // Use comment as text if available, fallback to dialogId

    return new DialogLine(speaker, text, dialogId);
  }

  /**
   * Parse Info_AddChoice function call
   */
  static parseInfoAddChoiceCall(node: TreeSitterNode): Choice | null {
    return ActionParsers.parseActionWithArgs(node, 3, (args) =>
      new Choice(args[0], args[1], args[2])
    );
  }

  /**
   * Parse Log_CreateTopic function call
   */
  static parseCreateTopicCall(node: TreeSitterNode): CreateTopic | null {
    return ActionParsers.parseActionWithArgs(node, 1, (args) =>
      new CreateTopic(args[0], args[1] || null)
    );
  }

  /**
   * Parse B_LogEntry function call
   */
  static parseLogEntryCall(node: TreeSitterNode): LogEntry | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new LogEntry(args[0], args[1])
    );
  }

  /**
   * Parse Log_SetTopicStatus function call
   */
  static parseLogSetTopicStatusCall(node: TreeSitterNode): LogSetTopicStatus | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new LogSetTopicStatus(args[0], args[1])
    );
  }

  /**
   * Parse CreateInvItems function call
   */
  static parseCreateInventoryItemsCall(node: TreeSitterNode): CreateInventoryItems | null {
    return ActionParsers.parseActionWithArgs(node, 3, (args) =>
      new CreateInventoryItems(args[0], args[1], parseInt(args[2]) || 1)
    );
  }

  /**
   * Parse B_GiveInvItems function call
   */
  static parseGiveInventoryItemsCall(node: TreeSitterNode): GiveInventoryItems | null {
    return ActionParsers.parseActionWithArgs(node, 4, (args) =>
      new GiveInventoryItems(args[0], args[1], args[2], parseInt(args[3]) || 1)
    );
  }

  /**
   * Parse B_Attack function call
   */
  static parseAttackCall(node: TreeSitterNode): AttackAction | null {
    return ActionParsers.parseActionWithArgs(node, 4, (args) =>
      new AttackAction(args[0], args[1], args[2], parseInt(args[3]) || 1)
    );
  }

  /**
   * Parse B_SetAttitude function call
   */
  static parseSetAttitudeCall(node: TreeSitterNode): SetAttitudeAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new SetAttitudeAction(args[0], args[1])
    );
  }

  /**
   * Parse Npc_ExchangeRoutine function call
   */
  static parseExchangeRoutineCall(node: TreeSitterNode): ExchangeRoutineAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new ExchangeRoutineAction(args[0], args[1])
    );
  }

  /**
   * Parse B_Kapitelwechsel function call
   */
  static parseChapterTransitionCall(node: TreeSitterNode): ChapterTransitionAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new ChapterTransitionAction(parseInt(args[0]) || 1, args[1])
    );
  }

  /**
   * Parse generic function call as Action
   */
  static parseGenericAction(node: TreeSitterNode): Action {
    const actionText = node.text.trim();
    return new Action(actionText);
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

  /**
   * Find comment that appears after a statement in the AST
   */
  static findCommentAfterStatement(callNode: TreeSitterNode): string | null {
    // Get the parent statement node (expression_statement)
    const parent = callNode.parent;
    if (!parent) {
      return null;
    }

    let nextSibling = parent.nextSibling;
    let distance = 0;
    const MAX_SEARCH_DISTANCE = 5;

    while (nextSibling && distance < MAX_SEARCH_DISTANCE) {
      if (nextSibling.type === 'comment') {
        return nextSibling.text.replace(/^\/\/\s*/, '').trim();
      }

      // Stop if we hit another statement, declaration, or block end
      // This prevents finding comments that belong to subsequent code
      if (
        nextSibling.type.endsWith('_statement') ||
        nextSibling.type.endsWith('_declaration') ||
        nextSibling.type === 'block' ||
        nextSibling.type === '}'
      ) {
        return null;
      }

      nextSibling = nextSibling.nextSibling;
      distance++;
    }

    return null;
  }
}