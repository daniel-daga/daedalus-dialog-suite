import type { SemanticModel, DialogAction, DialogCondition } from '../../types/global';
import { getActionType } from '../actionTypes';

export interface QuestAnalysis {
    status: 'implemented' | 'wip' | 'not_started';
    logicMethod: 'implicit' | 'explicit' | 'unknown';
    misVariableExists: boolean;
    misVariableName: string;
    hasStart: boolean;
    hasSuccess: boolean;
    hasFailed: boolean;
    description: string;
    filePaths: { topic: string | null; variable: string | null };
}

export interface QuestReference {
    type: 'create' | 'status' | 'entry' | 'condition';
    dialogName?: string;
    functionName: string;
    npcName?: string;
    details: string;
}

export interface FunctionContext {
    functionName: string;
    dialogName?: string;
    npcName?: string;
}

export interface QuestUsageIndex {
    // Map from exact topic string to list of usages
    topicActions: Map<string, Array<{ action: DialogAction, context: FunctionContext }>>;
    // Map from variable name (exact?) to list of conditions
    variableConditions: Map<string, Array<{ condition: DialogCondition, context: FunctionContext }>>;
}

export const buildQuestUsageIndex = (semanticModel: SemanticModel): QuestUsageIndex => {
    const topicActions = new Map<string, Array<{ action: DialogAction, context: FunctionContext }>>();
    const variableConditions = new Map<string, Array<{ condition: DialogCondition, context: FunctionContext }>>();

    // 1. Build function context map (funcName -> {dialogName, npcName})
    const funcToDialog = new Map<string, { dialogName: string, npcName?: string }>();
    Object.values(semanticModel.dialogs || {}).forEach(dialog => {
        const info = dialog.properties.information;
        if (typeof info === 'string') {
            funcToDialog.set(info.toLowerCase(), { dialogName: dialog.name, npcName: dialog.properties.npc });
        } else if (info && typeof info === 'object' && info.name) {
             funcToDialog.set(info.name.toLowerCase(), { dialogName: dialog.name, npcName: dialog.properties.npc });
        }
    });

    // 2. Iterate functions
    Object.values(semanticModel.functions || {}).forEach(func => {
        const lowerFuncName = func.name.toLowerCase();
        const dialogInfo = funcToDialog.get(lowerFuncName);
        const context: FunctionContext = {
            functionName: func.name,
            dialogName: dialogInfo?.dialogName,
            npcName: dialogInfo?.npcName
        };

        // Actions
        func.actions?.forEach(action => {
            if ('topic' in action && action.topic) {
                const topic = action.topic; // Keep original case for map key
                if (!topicActions.has(topic)) {
                    topicActions.set(topic, []);
                }
                topicActions.get(topic)!.push({ action, context });
            }
        });

        // Conditions
        func.conditions?.forEach(cond => {
             if ('variableName' in cond && cond.variableName) {
                 const variableName = (cond as any).variableName; // Keep original case
                 if (!variableConditions.has(variableName)) {
                     variableConditions.set(variableName, []);
                 }
                 variableConditions.get(variableName)!.push({ condition: cond, context });
             }
        });
    });

    return { topicActions, variableConditions };
};

export const analyzeQuest = (semanticModel: SemanticModel, questName: string, index?: QuestUsageIndex): QuestAnalysis => {
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const topicConstant = semanticModel.constants?.[questName];
    const misVariable = semanticModel.variables?.[misVarName];

    let hasStart = false;
    let hasSuccess = false;
    let hasFailed = false;
    let hasImplicitChecks = false;
    let hasExplicitChecks = !!misVariable;

    if (index) {
        // FAST PATH using index
        const actions = index.topicActions.get(questName) || [];
        actions.forEach(({ action }) => {
            if (action.type === 'CreateTopic') {
                hasStart = true;
            } else if (action.type === 'LogSetTopicStatus') {
                const status = String(action.status);
                if (status.includes('SUCCESS') || status === '2') {
                    hasSuccess = true;
                } else if (status.includes('FAILED') || status === '3') {
                    hasFailed = true;
                }
            }
        });

        const conditions = index.variableConditions.get(misVarName) || [];
        if (conditions.length > 0) {
            hasExplicitChecks = true;
        }

    } else {
        // SLOW PATH iterating functions
        // Scan functions for actions
        Object.values(semanticModel.functions || {}).forEach(func => {
            func.actions?.forEach((action: DialogAction) => {
                if ('topic' in action && action.topic === questName) {
                    if (action.type === 'CreateTopic') {
                        hasStart = true;
                    } else if (action.type === 'LogSetTopicStatus') {
                        const status = String(action.status);
                        if (status.includes('SUCCESS') || status === '2') {
                            hasSuccess = true;
                        } else if (status.includes('FAILED') || status === '3') {
                            hasFailed = true;
                        }
                    }
                }
            });

            // Also check if this function is used as a condition for quest progress
            func.conditions?.forEach((cond: DialogCondition) => {
                if (cond.type === 'NpcKnowsInfoCondition') {
                    // If someone checks if we know a dialog that is part of this quest
                    // We'll need a better way to link dialogs to quests,
                    // but for now we look at references in getQuestReferences
                }
                if (cond.type === 'VariableCondition' && cond.variableName === misVarName) {
                    hasExplicitChecks = true;
                }
            });
        });
    }

    // Determine logic method
    let logicMethod: QuestAnalysis['logicMethod'] = 'unknown';
    if (hasExplicitChecks) {
        logicMethod = 'explicit';
    } else {
        // If we have references that are conditions but not variable conditions, it might be implicit
        const refs = getQuestReferences(semanticModel, questName, index);
        if (refs.some(r => r.type === 'condition' && !r.details.includes(misVarName))) {
            logicMethod = 'implicit';
        }
    }

    let status: QuestAnalysis['status'] = 'not_started';
    if (hasSuccess || hasFailed) {
        status = 'implemented';
    } else if (hasStart) {
        status = 'wip';
    }

    return {
        status,
        logicMethod,
        misVariableExists: !!misVariable,
        misVariableName: misVarName,
        hasStart,
        hasSuccess,
        hasFailed,
        description: topicConstant ? String(topicConstant.value).replace(/^"|"$/g, '') : '',
        filePaths: {
            topic: topicConstant?.filePath || null,
            variable: misVariable?.filePath || null
        }
    };
};

export const getQuestReferences = (semanticModel: SemanticModel, questName: string, index?: QuestUsageIndex): QuestReference[] => {
    if (!questName) return [];
    const lowerQuestName = questName.toLowerCase();
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const lowerMisVarName = misVarName.toLowerCase();

    const refs: QuestReference[] = [];

    if (index) {
        // FAST PATH using index
        for (const [topic, usages] of index.topicActions.entries()) {
            if (topic.toLowerCase() === lowerQuestName) {
                usages.forEach(({ action, context }) => {
                    const type = getActionType(action);
                    if (type === 'createTopic') {
                        refs.push({
                            type: 'create',
                            functionName: context.functionName,
                            dialogName: context.dialogName,
                            npcName: context.npcName,
                            details: `Created${(action as any).topicType ? ` in ${(action as any).topicType}` : ''}`
                        });
                    } else if (type === 'logSetTopicStatus') {
                        refs.push({
                            type: 'status',
                            functionName: context.functionName,
                            dialogName: context.dialogName,
                            npcName: context.npcName,
                            details: `Set status to ${(action as any).status}`
                        });
                    } else if (type === 'logEntry') {
                        refs.push({
                            type: 'entry',
                            functionName: context.functionName,
                            dialogName: context.dialogName,
                            npcName: context.npcName,
                            details: `Entry: "${(action as any).text}"`
                        });
                    }
                });
            }
        }

        for (const [variable, usages] of index.variableConditions.entries()) {
             if (variable.toLowerCase() === lowerMisVarName) {
                 usages.forEach(({ condition, context }) => {
                     refs.push({
                        type: 'condition',
                        functionName: context.functionName,
                        dialogName: context.dialogName,
                        npcName: context.npcName,
                        details: `Condition: ${(condition as any).negated ? '!' : ''}${misVarName}`
                     });
                 });
             }
        }

    } else {
        // SLOW PATH
        // Map functions to dialogs for better context
        const funcToDialog = new Map<string, { dialogName: string, npcName?: string }>();
        Object.values(semanticModel.dialogs || {}).forEach(dialog => {
            const info = dialog.properties.information;
            if (typeof info === 'string') {
                funcToDialog.set(info.toLowerCase(), { dialogName: dialog.name, npcName: dialog.properties.npc });
            } else if (info && typeof info === 'object' && info.name) {
                funcToDialog.set(info.name.toLowerCase(), { dialogName: dialog.name, npcName: dialog.properties.npc });
            }
        });

        Object.values(semanticModel.functions || {}).forEach(func => {
            func.actions?.forEach(action => {
                if ('topic' in action && action.topic && action.topic.toLowerCase() === lowerQuestName) {
                    const context = funcToDialog.get(func.name.toLowerCase());
                    const type = getActionType(action);

                    if (type === 'createTopic') {
                        refs.push({
                            type: 'create',
                            functionName: func.name,
                            dialogName: context?.dialogName,
                            npcName: context?.npcName,
                            details: `Created${(action as any).topicType ? ` in ${(action as any).topicType}` : ''}`
                        });
                    } else if (type === 'logSetTopicStatus') {
                        refs.push({
                            type: 'status',
                            functionName: func.name,
                            dialogName: context?.dialogName,
                            npcName: context?.npcName,
                            details: `Set status to ${(action as any).status}`
                        });
                    } else if (type === 'logEntry') {
                        refs.push({
                            type: 'entry',
                            functionName: func.name,
                            dialogName: context?.dialogName,
                            npcName: context?.npcName,
                            details: `Entry: "${(action as any).text}"`
                        });
                    }
                }
            });

            // Check conditions for MIS_ var
            func.conditions?.forEach(cond => {
                // Basic check for variable condition structure as serialized
                if ('variableName' in cond && cond.variableName && (cond as any).variableName.toLowerCase() === lowerMisVarName) {
                    const context = funcToDialog.get(func.name.toLowerCase());
                    refs.push({
                        type: 'condition',
                        functionName: func.name,
                        dialogName: context?.dialogName,
                        npcName: context?.npcName,
                        details: `Condition: ${(cond as any).negated ? '!' : ''}${misVarName}`
                    });
                }
            });
        });
    }

    return refs;
};

export const getUsedQuestTopics = (semanticModel: SemanticModel, index?: QuestUsageIndex): Set<string> => {
    if (index) {
        return new Set(index.topicActions.keys());
    }

    const used = new Set<string>();

    // Check all functions for Log_* calls
    Object.values(semanticModel.functions || {}).forEach(func => {
      func.actions?.forEach(action => {
        if ('topic' in action && action.topic) {
           used.add(action.topic);
        }
      });
    });

    return used;
};

export const findDialogNameForFunction = (semanticModel: SemanticModel, funcName: string): string | null => {
    for (const [dName, d] of Object.entries(semanticModel.dialogs || {})) {
        const info = d.properties.information;
        if ((typeof info === 'string' && info.toLowerCase() === funcName.toLowerCase()) ||
            (typeof info === 'object' && info.name.toLowerCase() === funcName.toLowerCase())) {
            return dName;
        }
    }
    return null;
};
