"use strict";
// Condition parsing logic for Daedalus dialog semantic analysis
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConditionParsers = void 0;
const semantic_model_1 = require("./semantic-model");
class ConditionParsers {
    /**
     * Parse a semantic condition based on function name
     */
    static parseSemanticCondition(node, functionName) {
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
    static parseNpcKnowsInfoCall(node) {
        const argsNode = node.childForFieldName('arguments');
        if (!argsNode)
            return null;
        const args = ConditionParsers.parseArguments(argsNode);
        if (args.length < 2)
            return null;
        return new semantic_model_1.NpcKnowsInfoCondition(args[0], args[1]);
    }
    /**
     * Parse generic condition expression as Condition
     */
    static parseGenericCondition(node) {
        const conditionText = node.text.trim();
        return new semantic_model_1.Condition(conditionText);
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
}
exports.ConditionParsers = ConditionParsers;
