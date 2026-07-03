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
  ClearChoicesAction,
  CreateInventoryItems,
  GiveInventoryItems,
  AttackAction,
  SetAttitudeAction,
  ExchangeRoutineAction,
  ChapterTransitionAction,
  StopProcessInfosAction,
  SetRefuseTalkAction,
  PlayAniAction,
  GivePlayerXPAction,
  PickpocketAction,
  StartOtherRoutineAction,
  TeachAction,
  GiveTradeInventoryAction,
  RemoveInventoryItemsAction,
  InsertNpcAction
} from '../semantic-model';
import { parseArgumentsDetailed, parseNumericArg, ParsedArg } from './argument-parsing';

export class ActionParsers {

  /**
   * Parse a semantic action based on function name.
   *
   * A recognized call whose argument count does not match the expected arity
   * (or that a specific parser otherwise declines) never gets dropped: it falls
   * back to a verbatim generic `Action`, preserving the source text.
   */
  static parseSemanticAction(node: TreeSitterNode, functionName: string): DialogAction {
    const specific = ActionParsers.parseSpecificAction(node, functionName);
    return specific ?? ActionParsers.parseGenericAction(node);
  }

  /**
   * Dispatch to a specific action parser by (case-insensitive) function name.
   * Returns null when the name is unrecognized or the specific parser declines
   * (e.g. arity mismatch); callers fall back to a generic verbatim action.
   */
  private static parseSpecificAction(node: TreeSitterNode, functionName: string): DialogAction | null {
    // Daedalus identifiers are case-insensitive, so dispatch on a normalized
    // key while passing the original `functionName` to sub-parsers that need to
    // preserve the source casing in the model.
    const dispatchKey = functionName.toLowerCase();

    if (dispatchKey.startsWith('b_teach')) {
      return ActionParsers.parseTeachCall(node, functionName);
    }

    switch (dispatchKey) {
      case 'ai_output':
        return ActionParsers.parseAIOutputCall(node);
      case 'info_addchoice':
        return ActionParsers.parseInfoAddChoiceCall(node);
      case 'info_clearchoices':
        return ActionParsers.parseClearChoicesCall(node);
      case 'log_createtopic':
        return ActionParsers.parseCreateTopicCall(node);
      case 'b_logentry':
      case 'log_addentry':
        return ActionParsers.parseLogEntryCall(node);
      case 'log_settopicstatus':
        return ActionParsers.parseLogSetTopicStatusCall(node);
      case 'createinvitems':
        return ActionParsers.parseCreateInventoryItemsCall(node);
      case 'b_giveinvitems':
        return ActionParsers.parseGiveInventoryItemsCall(node);
      case 'b_attack':
        return ActionParsers.parseAttackCall(node);
      case 'b_setattitude':
        return ActionParsers.parseSetAttitudeCall(node);
      case 'npc_exchangeroutine':
        return ActionParsers.parseExchangeRoutineCall(node);
      case 'b_kapitelwechsel':
        return ActionParsers.parseChapterTransitionCall(node);
      case 'ai_stopprocessinfos':
        return ActionParsers.parseStopProcessInfosCall(node);
      case 'npc_setrefusetalk':
        return ActionParsers.parseSetRefuseTalkCall(node);
      case 'ai_playani':
        return ActionParsers.parsePlayAniCall(node);
      case 'b_giveplayerxp':
        return ActionParsers.parseGivePlayerXPCall(node);
      case 'c_beklauen':
      case 'b_beklauen':
        return ActionParsers.parsePickpocketCall(node, functionName);
      case 'b_startotherroutine':
        return ActionParsers.parseStartOtherRoutineCall(node, functionName);
      case 'b_givetradeinv':
        return ActionParsers.parseGiveTradeInventoryCall(node);
      case 'npc_removeinvitems':
        return ActionParsers.parseRemoveInventoryItemsCall(node, functionName, 3);
      case 'npc_removeinvitem':
        return ActionParsers.parseRemoveInventoryItemsCall(node, functionName, 2);
      case 'wld_insertnpc':
        return ActionParsers.parseInsertNpcCall(node);
      default:
        return null;
    }
  }

  /**
   * Generic helper to parse function arguments and create action
   * Reduces duplication across simple action parsers
   */
  private static parseActionWithArgs<T>(
    node: TreeSitterNode,
    arity: number | { min: number; max: number },
    factory: (args: ParsedArg[]) => T | null
  ): T | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = parseArgumentsDetailed(argsNode);
    const min = typeof arity === 'number' ? arity : arity.min;
    const max = typeof arity === 'number' ? arity : arity.max;
    // Fall back (return null) on an argument count that does not match the
    // expected arity in either direction, so the call is preserved verbatim by
    // the generic fallback rather than being coerced or truncated.
    if (args.length < min || args.length > max) return null;

    return factory(args);
  }

  /**
   * Parse AI_Output function call
   * Special handling: looks for comment after call to use as dialog text
   */
  static parseAIOutputCall(node: TreeSitterNode): DialogLine | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = parseArgumentsDetailed(argsNode);
    if (args.length < 3) return null;

    const speaker = args[0].value;
    const listener = args[1].value;
    const dialogId = args[2].value; // This is typically a dialog ID

    // Look for a same-line comment after this AI_Output call to use as readable
    // text (a next-line comment is a standalone comment, not a subtitle).
    const commentNode = ActionParsers.findCommentAfterStatement(node);
    const hasInlineComment = commentNode !== null;
    const rawComment = commentNode ? commentNode.text : '';
    const comment = rawComment.startsWith('//') ? rawComment.slice(2) : rawComment;
    const text = hasInlineComment ? comment : dialogId;

    const line = new DialogLine(speaker, text, dialogId, listener);
    line.inlineComment = hasInlineComment;
    // Preserve whether the id was an identifier/expression rather than a string
    // literal (N7), so it regenerates without invented quotes.
    line.idIsExpression = !args[2].isString;
    return line;
  }

  /**
   * Parse Info_AddChoice function call
   */
  static parseInfoAddChoiceCall(node: TreeSitterNode): Choice | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = parseArgumentsDetailed(argsNode);
    if (args.length < 3) return null;

    const choice = new Choice(args[0].value, args[1].value, args[2].value);
    choice.textIsExpression = !args[1].isString;
    return choice;
  }

  /**
   * Parse Info_ClearChoices function call
   */
  static parseClearChoicesCall(node: TreeSitterNode): ClearChoicesAction | null {
    return ActionParsers.parseActionWithArgs(node, 1, (args) =>
      new ClearChoicesAction(args[0].raw)
    );
  }

  /**
   * Parse Log_CreateTopic function call
   */
  static parseCreateTopicCall(node: TreeSitterNode): CreateTopic | null {
    return ActionParsers.parseActionWithArgs(node, { min: 1, max: 2 }, (args) =>
      new CreateTopic(args[0].raw, args[1] ? args[1].raw : null)
    );
  }

  /**
   * Parse B_LogEntry function call
   */
  static parseLogEntryCall(node: TreeSitterNode): LogEntry | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new LogEntry(args[0].raw, args[1].value, !args[1].isString)
    );
  }

  /**
   * Parse Log_SetTopicStatus function call
   */
  static parseLogSetTopicStatusCall(node: TreeSitterNode): LogSetTopicStatus | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new LogSetTopicStatus(args[0].raw, args[1].raw)
    );
  }

  /**
   * Parse CreateInvItems function call
   */
  static parseCreateInventoryItemsCall(node: TreeSitterNode): CreateInventoryItems | null {
    return ActionParsers.parseActionWithArgs(node, 3, (args) =>
      new CreateInventoryItems(args[0].raw, args[1].raw, parseNumericArg(args[2].raw, 1))
    );
  }

  /**
   * Parse B_GiveInvItems function call
   */
  static parseGiveInventoryItemsCall(node: TreeSitterNode): GiveInventoryItems | null {
    return ActionParsers.parseActionWithArgs(node, 4, (args) =>
      new GiveInventoryItems(args[0].raw, args[1].raw, args[2].raw, parseNumericArg(args[3].raw, 1))
    );
  }

  /**
   * Parse B_Attack function call
   */
  static parseAttackCall(node: TreeSitterNode): AttackAction | null {
    return ActionParsers.parseActionWithArgs(node, 4, (args) =>
      new AttackAction(args[0].raw, args[1].raw, args[2].raw, parseNumericArg(args[3].raw, 1))
    );
  }

  /**
   * Parse B_SetAttitude function call
   */
  static parseSetAttitudeCall(node: TreeSitterNode): SetAttitudeAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new SetAttitudeAction(args[0].raw, args[1].raw)
    );
  }

  /**
   * Parse Npc_ExchangeRoutine function call
   */
  static parseExchangeRoutineCall(node: TreeSitterNode): ExchangeRoutineAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new ExchangeRoutineAction(args[0].raw, args[1].value, !args[1].isString)
    );
  }

  /**
   * Parse B_Kapitelwechsel function call
   */
  static parseChapterTransitionCall(node: TreeSitterNode): ChapterTransitionAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new ChapterTransitionAction(parseNumericArg(args[0].raw, 1), args[1].raw)
    );
  }

  /**
   * Parse AI_StopProcessInfos function call
   */
  static parseStopProcessInfosCall(node: TreeSitterNode): StopProcessInfosAction | null {
    return ActionParsers.parseActionWithArgs(node, 1, (args) =>
      new StopProcessInfosAction(args[0].raw)
    );
  }

  /**
   * Parse Npc_SetRefuseTalk function call
   */
  static parseSetRefuseTalkCall(node: TreeSitterNode): SetRefuseTalkAction | null {
    return ActionParsers.parseActionWithArgs(node, { min: 1, max: 2 }, (args) =>
      new SetRefuseTalkAction(args[0].raw, parseNumericArg(args[1] ? args[1].raw : undefined, 300))
    );
  }

  /**
   * Parse AI_PlayAni function call
   */
  static parsePlayAniCall(node: TreeSitterNode): PlayAniAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new PlayAniAction(args[0].value, args[1].value, !args[1].isString)
    );
  }

  /**
   * Parse B_GivePlayerXP function call
   */
  static parseGivePlayerXPCall(node: TreeSitterNode): GivePlayerXPAction | null {
    return ActionParsers.parseActionWithArgs(node, 1, (args) =>
      new GivePlayerXPAction(args[0].raw)
    );
  }

  /**
   * Parse B_Beklauen / C_Beklauen function calls
   */
  static parsePickpocketCall(node: TreeSitterNode, functionName: string): PickpocketAction | null {
    const argsNode = node.childForFieldName('arguments');
    const args = argsNode ? parseArgumentsDetailed(argsNode).map((a) => a.raw) : [];
    // Decide the mode by the (case-insensitive) dispatch key, not the source
    // casing, so `b_beklauen` maps to the B_Beklauen behavior (M5).
    const mode: 'B_Beklauen' | 'C_Beklauen' =
      functionName.toLowerCase() === 'b_beklauen' ? 'B_Beklauen' : 'C_Beklauen';
    return new PickpocketAction(mode, args[0], args[1], functionName, args);
  }

  /**
   * Parse B_StartOtherRoutine / B_StartotherRoutine function call
   */
  static parseStartOtherRoutineCall(node: TreeSitterNode, functionName: string): StartOtherRoutineAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new StartOtherRoutineAction(
        functionName as 'B_StartOtherRoutine' | 'B_StartotherRoutine',
        args[0].value,
        args[1].value,
        !args[1].isString
      )
    );
  }

  /**
   * Parse B_Teach* function calls
   */
  static parseTeachCall(node: TreeSitterNode, functionName: string): TeachAction | null {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return null;

    const args = parseArgumentsDetailed(argsNode).map((a) => a.raw);
    return new TeachAction(functionName, args);
  }

  /**
   * Parse B_GiveTradeInv function call
   */
  static parseGiveTradeInventoryCall(node: TreeSitterNode): GiveTradeInventoryAction | null {
    return ActionParsers.parseActionWithArgs(node, 1, (args) =>
      new GiveTradeInventoryAction(args[0].raw)
    );
  }

  /**
   * Parse Npc_RemoveInvItems / Npc_RemoveInvItem function call
   */
  static parseRemoveInventoryItemsCall(
    node: TreeSitterNode,
    functionName: string,
    arity: number
  ): RemoveInventoryItemsAction | null {
    return ActionParsers.parseActionWithArgs(node, arity, (args) =>
      new RemoveInventoryItemsAction(
        functionName as 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem',
        args[0].raw,
        args[1].raw,
        args[2] ? args[2].raw : undefined
      )
    );
  }

  /**
   * Parse Wld_InsertNpc function call
   */
  static parseInsertNpcCall(node: TreeSitterNode): InsertNpcAction | null {
    return ActionParsers.parseActionWithArgs(node, 2, (args) =>
      new InsertNpcAction(args[0].value, args[1].value, !args[1].isString)
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
   * Find a same-line comment that appears immediately after a statement in the
   * AST (an AI_Output subtitle). Returns the comment node so callers can both
   * read its text and track that the comment was consumed (so it is not also
   * re-emitted as a standalone CommentAction). A comment on the *next* line is
   * a standalone comment, not a subtitle, and is not returned here.
   */
  static findCommentAfterStatement(callNode: TreeSitterNode): TreeSitterNode | null {
    // Get the parent statement node (expression_statement)
    const parent = callNode.parent;
    if (!parent) {
      return null;
    }

    let nextSibling = parent.nextSibling;
    const MAX_SEARCH_DISTANCE = 5;

    // Limit search distance to prevent O(N^2) complexity in large blocks
    for (let distance = 0; nextSibling && distance < MAX_SEARCH_DISTANCE; distance++) {
      if (nextSibling.type === 'comment') {
        // Only a comment on the same row as the call is the subtitle.
        if (nextSibling.startPosition.row === callNode.endPosition.row) {
          return nextSibling;
        }
        return null;
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
    }

    return null;
  }
}
