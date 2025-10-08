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
} from './semantic-model';

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
   * Parse AI_Output function call
   */
  static parseAIOutputCall(node: TreeSitterNode): DialogLine | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args: string[] = [];
    for (let i = 0; i < argsNode.childCount; i++) {
      const child = argsNode.child(i);
      if (child.type !== ',' && child.type !== '(' && child.type !== ')') {
        args.push(child.text.replace(/"/g, '')); // Remove quotes from string literals
      }
    }

    if (args.length >= 3) {
      const speaker = args[0];
      const listener = args[1];
      const dialogId = args[2]; // This is typically a dialog ID

      // Look for comment after this AI_Output call
      const comment = ActionParsers.findCommentAfterStatement(node);
      const text = comment || dialogId; // Use comment as text if available, fallback to dialogId


      return new DialogLine(speaker, text, dialogId);
    }

    return null;
  }

  /**
   * Parse Info_AddChoice function call
   */
  static parseInfoAddChoiceCall(node: TreeSitterNode): Choice | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 3) return null;

    return new Choice(args[0], args[1], args[2]);
  }

  /**
   * Parse Log_CreateTopic function call
   */
  static parseCreateTopicCall(node: TreeSitterNode): CreateTopic | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 1) return null;

    return new CreateTopic(args[0], args[1] || null);
  }

  /**
   * Parse B_LogEntry function call
   */
  static parseLogEntryCall(node: TreeSitterNode): LogEntry | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 2) return null;

    return new LogEntry(args[0], args[1]);
  }

  /**
   * Parse Log_SetTopicStatus function call
   */
  static parseLogSetTopicStatusCall(node: TreeSitterNode): LogSetTopicStatus | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 2) return null;

    return new LogSetTopicStatus(args[0], args[1]);
  }

  /**
   * Parse CreateInvItems function call
   */
  static parseCreateInventoryItemsCall(node: TreeSitterNode): CreateInventoryItems | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 3) return null;

    const target = args[0];
    const item = args[1];
    const quantity = parseInt(args[2]) || 1;

    return new CreateInventoryItems(target, item, quantity);
  }

  /**
   * Parse B_GiveInvItems function call
   */
  static parseGiveInventoryItemsCall(node: TreeSitterNode): GiveInventoryItems | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 4) return null;

    const giver = args[0];
    const receiver = args[1];
    const item = args[2];
    const quantity = parseInt(args[3]) || 1;

    return new GiveInventoryItems(giver, receiver, item, quantity);
  }

  /**
   * Parse B_Attack function call
   */
  static parseAttackCall(node: TreeSitterNode): AttackAction | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 4) return null;

    const attacker = args[0];
    const target = args[1];
    const attackReason = args[2];
    const damage = parseInt(args[3]) || 1;

    return new AttackAction(attacker, target, attackReason, damage);
  }

  /**
   * Parse B_SetAttitude function call
   */
  static parseSetAttitudeCall(node: TreeSitterNode): SetAttitudeAction | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 2) return null;

    return new SetAttitudeAction(args[0], args[1]);
  }

  /**
   * Parse Npc_ExchangeRoutine function call
   */
  static parseExchangeRoutineCall(node: TreeSitterNode): ExchangeRoutineAction | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 2) return null;

    return new ExchangeRoutineAction(args[0], args[1]);
  }

  /**
   * Parse B_Kapitelwechsel function call
   */
  static parseChapterTransitionCall(node: TreeSitterNode): ChapterTransitionAction | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = ActionParsers.parseArguments(argsNode);
    if (args.length < 2) return null;

    const chapter = parseInt(args[0]) || 1;
    const world = args[1];

    return new ChapterTransitionAction(chapter, world);
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
    if ( !parent )
      return null;

    var nextSibling = parent.nextSibling;

    while ( nextSibling && nextSibling.type !== 'comment') {
      nextSibling = nextSibling.nextSibling;
    }
  

    if (!nextSibling)
      return null;

    return nextSibling.text.replace(/^\/\/\s*/, '').trim();
  }
}