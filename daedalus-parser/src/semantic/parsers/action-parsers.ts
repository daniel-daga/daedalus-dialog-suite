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
  UseItemAction,
  InsertNpcAction
} from '../semantic-model';
import { parseArgumentsDetailed, parseNumericArg, ParsedArg } from './argument-parsing';
import { captureCallIdentity } from './call-identity';
import { hasComment } from './ast-constants';
import { captureActionSource, getCallStatementSuffix } from '../action-source';
import type { CodeGeneratable } from '../semanticModelInterfaces';

export class ActionParsers {

  /**
   * Parse a semantic action based on function name.
   *
   * A recognized call whose argument count does not match the expected arity
   * (or that a specific parser otherwise declines) never gets dropped: it falls
   * back to a verbatim generic `Action`, preserving the source text.
   *
   * `args` is the call's argument list when the caller has already parsed it —
   * the linking pass records every call site and would otherwise parse the same
   * arguments a second time (#541).
   */
  static parseSemanticAction(node: TreeSitterNode, functionName: string, args?: ParsedArg[]): DialogAction {
    const callArgs = args ?? ActionParsers.parseCallArguments(node);
    const specific = ActionParsers.parseSpecificAction(node, functionName, callArgs);
    const action = (specific ?? ActionParsers.parseGenericAction(node)) as DialogAction & CodeGeneratable;
    captureCallIdentity(action, node);
    // Typed action models normalize arguments, so comments embedded in the
    // call would otherwise disappear on generation. Keep the semantic type,
    // but attach the complete call for the comment-aware generator path.
    // The enclosing statement also owns comments between `)` and `;`, which
    // are outside the call node. Capture them for typed and generic calls alike.
    const hasNumericSpelling = callArgs.some(arg =>
      /^-?\d+$/.test(arg.raw) && String(Number(arg.raw)) !== arg.raw
    );
    if ((specific && (hasComment(node) || hasNumericSpelling)) || getCallStatementSuffix(node) !== undefined) {
      action.sourceText = node.text;
      action.sourceCall = captureActionSource(node, action);
    }
    return action;
  }

  private static parseCallArguments(node: TreeSitterNode): ParsedArg[] {
    const argsNode = node.childForFieldName('arguments');
    return argsNode ? parseArgumentsDetailed(argsNode) : [];
  }

  /**
   * Dispatch to a specific action parser by (case-insensitive) function name.
   * Returns null when the name is unrecognized or the specific parser declines
   * (e.g. arity mismatch); callers fall back to a generic verbatim action.
   */
  private static parseSpecificAction(
    node: TreeSitterNode,
    functionName: string,
    args: ParsedArg[]
  ): DialogAction | null {
    // Daedalus identifiers are case-insensitive, so dispatch on a normalized
    // key while passing the original `functionName` to sub-parsers that need to
    // preserve the source casing in the model.
    const dispatchKey = functionName.toLowerCase();

    if (dispatchKey.startsWith('b_teach')) {
      return ActionParsers.parseTeachCall(args, functionName);
    }

    switch (dispatchKey) {
      case 'ai_output':
        return ActionParsers.parseAIOutputCall(node, args);
      case 'info_addchoice':
        return ActionParsers.parseInfoAddChoiceCall(args);
      case 'info_clearchoices':
        return ActionParsers.parseClearChoicesCall(args);
      case 'log_createtopic':
        return ActionParsers.parseCreateTopicCall(args);
      case 'b_logentry':
      case 'log_addentry':
        return ActionParsers.parseLogEntryCall(args);
      case 'log_settopicstatus':
        return ActionParsers.parseLogSetTopicStatusCall(args);
      case 'createinvitems':
        return ActionParsers.parseCreateInventoryItemsCall(args);
      case 'b_giveinvitems':
        return ActionParsers.parseGiveInventoryItemsCall(args);
      case 'b_attack':
        return ActionParsers.parseAttackCall(args);
      case 'b_setattitude':
        return ActionParsers.parseSetAttitudeCall(args);
      case 'npc_exchangeroutine':
        return ActionParsers.parseExchangeRoutineCall(args);
      case 'b_kapitelwechsel':
        return ActionParsers.parseChapterTransitionCall(args);
      case 'ai_stopprocessinfos':
        return ActionParsers.parseStopProcessInfosCall(args);
      case 'npc_setrefusetalk':
        return ActionParsers.parseSetRefuseTalkCall(args);
      case 'ai_playani':
        return ActionParsers.parsePlayAniCall(args);
      case 'b_giveplayerxp':
        return ActionParsers.parseGivePlayerXPCall(args);
      case 'c_beklauen':
      case 'b_beklauen':
        return ActionParsers.parsePickpocketCall(args, functionName);
      case 'b_startotherroutine':
        return ActionParsers.parseStartOtherRoutineCall(args, functionName);
      case 'b_givetradeinv':
        return ActionParsers.parseGiveTradeInventoryCall(args);
      case 'npc_removeinvitems':
        return ActionParsers.parseRemoveInventoryItemsCall(args, functionName, 3);
      case 'npc_removeinvitem':
        return ActionParsers.parseRemoveInventoryItemsCall(args, functionName, 2);
      case 'b_useitem':
        return ActionParsers.parseUseItemCall(args);
      case 'wld_insertnpc':
        return ActionParsers.parseInsertNpcCall(args);
      default:
        return null;
    }
  }

  /**
   * Generic helper to parse function arguments and create action
   * Reduces duplication across simple action parsers
   */
  private static parseActionWithArgs<T>(
    arity: number | { min: number; max: number },
    factory: (args: ParsedArg[]) => T | null,
    args: ParsedArg[]
  ): T | null {
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
  static parseAIOutputCall(node: TreeSitterNode, args: ParsedArg[]): DialogLine | null {
    if (args.length !== 3) return null;

    const speaker = args[0].raw;
    const listener = args[1].raw;
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
  static parseInfoAddChoiceCall(args: ParsedArg[]): Choice | null {
    if (args.length !== 3) return null;

    // Reference fields own complete expressions; quoted values must not turn
    // into identifiers when reference analysis reads the current model.
    const choice = new Choice(args[0].raw, args[1].value, args[2].raw);
    choice.textIsExpression = !args[1].isString;
    return choice;
  }

  /**
   * Parse Info_ClearChoices function call
   */
  static parseClearChoicesCall(args: ParsedArg[]): ClearChoicesAction | null {
    return ActionParsers.parseActionWithArgs(1, (parsed) =>
      new ClearChoicesAction(parsed[0].raw), args
    );
  }

  /**
   * Parse Log_CreateTopic function call
   */
  static parseCreateTopicCall(args: ParsedArg[]): CreateTopic | null {
    return ActionParsers.parseActionWithArgs({ min: 1, max: 2 }, (parsed) =>
      new CreateTopic(parsed[0].raw, parsed[1] ? parsed[1].raw : null), args
    );
  }

  /**
   * Parse B_LogEntry function call
   */
  static parseLogEntryCall(args: ParsedArg[]): LogEntry | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new LogEntry(parsed[0].raw, parsed[1].value, !parsed[1].isString), args
    );
  }

  /**
   * Parse Log_SetTopicStatus function call
   */
  static parseLogSetTopicStatusCall(args: ParsedArg[]): LogSetTopicStatus | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new LogSetTopicStatus(parsed[0].raw, parsed[1].raw), args
    );
  }

  /**
   * Parse CreateInvItems function call
   */
  static parseCreateInventoryItemsCall(args: ParsedArg[]): CreateInventoryItems | null {
    return ActionParsers.parseActionWithArgs(3, (parsed) =>
      new CreateInventoryItems(parsed[0].raw, parsed[1].raw, parseNumericArg(parsed[2].raw)), args
    );
  }

  /**
   * Parse B_GiveInvItems function call
   */
  static parseGiveInventoryItemsCall(args: ParsedArg[]): GiveInventoryItems | null {
    return ActionParsers.parseActionWithArgs(4, (parsed) =>
      new GiveInventoryItems(parsed[0].raw, parsed[1].raw, parsed[2].raw, parseNumericArg(parsed[3].raw)), args
    );
  }

  /**
   * Parse B_Attack function call
   */
  static parseAttackCall(args: ParsedArg[]): AttackAction | null {
    return ActionParsers.parseActionWithArgs(4, (parsed) =>
      new AttackAction(parsed[0].raw, parsed[1].raw, parsed[2].raw, parseNumericArg(parsed[3].raw)), args
    );
  }

  /**
   * Parse B_SetAttitude function call
   */
  static parseSetAttitudeCall(args: ParsedArg[]): SetAttitudeAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new SetAttitudeAction(parsed[0].raw, parsed[1].raw), args
    );
  }

  /**
   * Parse Npc_ExchangeRoutine function call
   */
  static parseExchangeRoutineCall(args: ParsedArg[]): ExchangeRoutineAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new ExchangeRoutineAction(parsed[0].raw, parsed[1].value, !parsed[1].isString), args
    );
  }

  /**
   * Parse B_Kapitelwechsel function call
   */
  static parseChapterTransitionCall(args: ParsedArg[]): ChapterTransitionAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new ChapterTransitionAction(parseNumericArg(parsed[0].raw), parsed[1].raw), args
    );
  }

  /**
   * Parse AI_StopProcessInfos function call
   */
  static parseStopProcessInfosCall(args: ParsedArg[]): StopProcessInfosAction | null {
    return ActionParsers.parseActionWithArgs(1, (parsed) =>
      new StopProcessInfosAction(parsed[0].raw), args
    );
  }

  /**
   * Parse Npc_SetRefuseTalk function call
   */
  static parseSetRefuseTalkCall(args: ParsedArg[]): SetRefuseTalkAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new SetRefuseTalkAction(parsed[0].raw, parseNumericArg(parsed[1].raw)), args
    );
  }

  /**
   * Parse AI_PlayAni function call
   */
  static parsePlayAniCall(args: ParsedArg[]): PlayAniAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new PlayAniAction(parsed[0].raw, parsed[1].value, !parsed[1].isString), args
    );
  }

  /**
   * Parse B_GivePlayerXP function call
   */
  static parseGivePlayerXPCall(args: ParsedArg[]): GivePlayerXPAction | null {
    return ActionParsers.parseActionWithArgs(1, (parsed) =>
      new GivePlayerXPAction(parsed[0].raw), args
    );
  }

  /**
   * Parse B_Beklauen / C_Beklauen function calls
   */
  static parsePickpocketCall(args: ParsedArg[], functionName: string): PickpocketAction | null {
    const raw = args.map((parsed) => parsed.raw);
    // Decide the mode by the (case-insensitive) dispatch key, not the source
    // casing, so `b_beklauen` maps to the B_Beklauen behavior (M5).
    const mode: 'B_Beklauen' | 'C_Beklauen' =
      functionName.toLowerCase() === 'b_beklauen' ? 'B_Beklauen' : 'C_Beklauen';
    return new PickpocketAction(mode, raw[0], raw[1], functionName, raw);
  }

  /**
   * Parse B_StartOtherRoutine / B_StartotherRoutine function call
   */
  static parseStartOtherRoutineCall(args: ParsedArg[], functionName: string): StartOtherRoutineAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new StartOtherRoutineAction(functionName, parsed[0].raw, parsed[1].value, !parsed[1].isString), args
    );
  }

  /**
   * Parse B_Teach* function calls
   */
  static parseTeachCall(args: ParsedArg[], functionName: string): TeachAction {
    return new TeachAction(functionName, args.map((parsed) => parsed.raw));
  }

  /**
   * Parse B_GiveTradeInv function call
   */
  static parseGiveTradeInventoryCall(args: ParsedArg[]): GiveTradeInventoryAction | null {
    return ActionParsers.parseActionWithArgs(1, (parsed) =>
      new GiveTradeInventoryAction(parsed[0].raw), args
    );
  }

  /**
   * Parse B_UseItem function call
   */
  static parseUseItemCall(args: ParsedArg[]): UseItemAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new UseItemAction(parsed[0].raw, parsed[1].raw), args
    );
  }

  /**
   * Parse Npc_RemoveInvItems / Npc_RemoveInvItem function call
   */
  static parseRemoveInventoryItemsCall(
    args: ParsedArg[],
    functionName: string,
    arity: number
  ): RemoveInventoryItemsAction | null {
    return ActionParsers.parseActionWithArgs(arity, (parsed) =>
      new RemoveInventoryItemsAction(
        functionName,
        parsed[0].raw,
        parsed[1].raw,
        parsed[2] ? parsed[2].raw : undefined
      ), args
    );
  }

  /**
   * Parse Wld_InsertNpc function call
   */
  static parseInsertNpcCall(args: ParsedArg[]): InsertNpcAction | null {
    return ActionParsers.parseActionWithArgs(2, (parsed) =>
      new InsertNpcAction(parsed[0].raw, parsed[1].value, !parsed[1].isString), args
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
        // Only a same-line `//` comment is a subtitle. A block comment can span
        // lines of source code, so keep it as a standalone comment action.
        if (
          nextSibling.text.startsWith('//') &&
          nextSibling.startPosition.row === parent.endPosition.row
        ) {
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
