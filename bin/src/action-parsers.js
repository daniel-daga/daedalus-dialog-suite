"use strict";
// Action parsing logic for Daedalus dialog semantic analysis
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionParsers = void 0;
const semantic_model_1 = require("./semantic-model");
class ActionParsers {
    /**
     * Parse a semantic action based on function name
     */
    static parseSemanticAction(node, functionName) {
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
    static parseActionWithArgs(node, minArgs, factory) {
        const argsNode = node.childForFieldName('arguments');
        if (!argsNode)
            return null;
        const args = ActionParsers.parseArguments(argsNode);
        if (args.length < minArgs)
            return null;
        return factory(args);
    }
    /**
     * Parse AI_Output function call
     * Special handling: looks for comment after call to use as dialog text
     */
    static parseAIOutputCall(node) {
        const argsNode = node.childForFieldName('arguments');
        if (!argsNode)
            return null;
        const args = ActionParsers.parseArguments(argsNode);
        if (args.length < 3)
            return null;
        const speaker = args[0];
        const dialogId = args[2]; // This is typically a dialog ID
        // Look for comment after this AI_Output call to use as readable text
        const comment = ActionParsers.findCommentAfterStatement(node);
        const text = comment || dialogId; // Use comment as text if available, fallback to dialogId
        return new semantic_model_1.DialogLine(speaker, text, dialogId);
    }
    /**
     * Parse Info_AddChoice function call
     */
    static parseInfoAddChoiceCall(node) {
        return ActionParsers.parseActionWithArgs(node, 3, (args) => new semantic_model_1.Choice(args[0], args[1], args[2]));
    }
    /**
     * Parse Log_CreateTopic function call
     */
    static parseCreateTopicCall(node) {
        return ActionParsers.parseActionWithArgs(node, 1, (args) => new semantic_model_1.CreateTopic(args[0], args[1] || null));
    }
    /**
     * Parse B_LogEntry function call
     */
    static parseLogEntryCall(node) {
        return ActionParsers.parseActionWithArgs(node, 2, (args) => new semantic_model_1.LogEntry(args[0], args[1]));
    }
    /**
     * Parse Log_SetTopicStatus function call
     */
    static parseLogSetTopicStatusCall(node) {
        return ActionParsers.parseActionWithArgs(node, 2, (args) => new semantic_model_1.LogSetTopicStatus(args[0], args[1]));
    }
    /**
     * Parse CreateInvItems function call
     */
    static parseCreateInventoryItemsCall(node) {
        return ActionParsers.parseActionWithArgs(node, 3, (args) => new semantic_model_1.CreateInventoryItems(args[0], args[1], parseInt(args[2]) || 1));
    }
    /**
     * Parse B_GiveInvItems function call
     */
    static parseGiveInventoryItemsCall(node) {
        return ActionParsers.parseActionWithArgs(node, 4, (args) => new semantic_model_1.GiveInventoryItems(args[0], args[1], args[2], parseInt(args[3]) || 1));
    }
    /**
     * Parse B_Attack function call
     */
    static parseAttackCall(node) {
        return ActionParsers.parseActionWithArgs(node, 4, (args) => new semantic_model_1.AttackAction(args[0], args[1], args[2], parseInt(args[3]) || 1));
    }
    /**
     * Parse B_SetAttitude function call
     */
    static parseSetAttitudeCall(node) {
        return ActionParsers.parseActionWithArgs(node, 2, (args) => new semantic_model_1.SetAttitudeAction(args[0], args[1]));
    }
    /**
     * Parse Npc_ExchangeRoutine function call
     */
    static parseExchangeRoutineCall(node) {
        return ActionParsers.parseActionWithArgs(node, 2, (args) => new semantic_model_1.ExchangeRoutineAction(args[0], args[1]));
    }
    /**
     * Parse B_Kapitelwechsel function call
     */
    static parseChapterTransitionCall(node) {
        return ActionParsers.parseActionWithArgs(node, 2, (args) => new semantic_model_1.ChapterTransitionAction(parseInt(args[0]) || 1, args[1]));
    }
    /**
     * Parse generic function call as Action
     */
    static parseGenericAction(node) {
        const actionText = node.text.trim();
        return new semantic_model_1.Action(actionText);
    }
    /**
     * Parse arguments from argument list node
     */
    static parseArguments(argsNode) {
        const args = [];
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
    static findCommentAfterStatement(callNode) {
        // Get the parent statement node (expression_statement)
        const parent = callNode.parent;
        if (!parent) {
            return null;
        }
        let nextSibling = parent.nextSibling;
        while (nextSibling && nextSibling.type !== 'comment') {
            nextSibling = nextSibling.nextSibling;
        }
        if (!nextSibling) {
            return null;
        }
        return nextSibling.text.replace(/^\/\/\s*/, '').trim();
    }
}
exports.ActionParsers = ActionParsers;
