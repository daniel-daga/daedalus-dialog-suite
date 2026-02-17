import type { SemanticModel, DialogAction, DialogCondition } from '../../types/global';
import { getActionType } from '../actionTypes';
import {
    getCanonicalQuestKey,
    getQuestMisVariableName,
    isCaseInsensitiveMatch,
    normalizeQuestLifecycleState
} from '../../utils/questIdentity';

export interface QuestAnalysis {
    status: 'implemented' | 'wip' | 'not_started';
    logicMethod: 'implicit' | 'explicit' | 'unknown';
    misVariableExists: boolean;
    misVariableName: string;
    hasStart: boolean;
    hasSuccess: boolean;
    hasFailed: boolean;
    hasObsolete: boolean;
    lifecycleSource: 'none' | 'topic' | 'mis' | 'mixed';
    hasLifecycleConflict: boolean;
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

const findCaseInsensitiveSymbol = <T,>(symbols: Record<string, T> | undefined, name: string): T | undefined => {
    if (!symbols) return undefined;
    if (symbols[name]) return symbols[name];
    const lowered = name.toLowerCase();
    for (const [key, value] of Object.entries(symbols)) {
        if (key.toLowerCase() === lowered) {
            return value;
        }
    }
    return undefined;
};

export const analyzeQuest = (semanticModel: SemanticModel, questName: string): QuestAnalysis => {
    const misVarName = getQuestMisVariableName(questName);
    const topicConstant = findCaseInsensitiveSymbol(semanticModel.constants, questName);
    const misVariable = findCaseInsensitiveSymbol(semanticModel.variables, misVarName);

    let hasStart = false;
    let hasSuccess = false;
    let hasFailed = false;
    let hasObsolete = false;
    let hasExplicitChecks = !!misVariable;
    let hasTopicLifecycleSignal = false;
    let hasMisLifecycleSignal = false;
    const topicTerminalStates = new Set<'success' | 'failed' | 'obsolete'>();
    const misTerminalStates = new Set<'success' | 'failed' | 'obsolete'>();

    const applyLifecycleSignal = (rawValue: unknown, source: 'topic' | 'mis') => {
        const state = normalizeQuestLifecycleState(rawValue);
        if (source === 'topic') {
            hasTopicLifecycleSignal = true;
        } else {
            hasMisLifecycleSignal = true;
        }

        if (state === 'unknown') {
            hasStart = true;
            return;
        }

        hasStart = true;
        if (state === 'success') {
            hasSuccess = true;
            if (source === 'topic') topicTerminalStates.add('success');
            else misTerminalStates.add('success');
        } else if (state === 'failed') {
            hasFailed = true;
            if (source === 'topic') topicTerminalStates.add('failed');
            else misTerminalStates.add('failed');
        } else if (state === 'obsolete') {
            hasObsolete = true;
            hasFailed = true;
            if (source === 'topic') topicTerminalStates.add('obsolete');
            else misTerminalStates.add('obsolete');
        }
    };

    // Scan functions for actions
    Object.values(semanticModel.functions || {}).forEach(func => {
        func.actions?.forEach((action: DialogAction) => {
            if ('topic' in action && isCaseInsensitiveMatch(action.topic, questName)) {
                if (action.type === 'CreateTopic') {
                    hasStart = true;
                } else if (action.type === 'LogSetTopicStatus') {
                    applyLifecycleSignal(action.status, 'topic');
                }
            }

            if (
                action.type === 'SetVariableAction' &&
                action.operator === '=' &&
                isCaseInsensitiveMatch(action.variableName, misVarName)
            ) {
                applyLifecycleSignal(action.value, 'mis');
                hasExplicitChecks = true;
            }
        });

        // Also check if this function is used as a condition for quest progress
        func.conditions?.forEach((cond: DialogCondition) => {
            if (cond.type === 'NpcKnowsInfoCondition') {
                // If someone checks if we know a dialog that is part of this quest
                // We'll need a better way to link dialogs to quests, 
                // but for now we look at references in getQuestReferences
            }
            if (cond.type === 'VariableCondition' && isCaseInsensitiveMatch(cond.variableName, misVarName)) {
                hasExplicitChecks = true;
            }
        });
    });

    let lifecycleSource: QuestAnalysis['lifecycleSource'] = 'none';
    if (hasTopicLifecycleSignal && hasMisLifecycleSignal) {
        lifecycleSource = 'mixed';
    } else if (hasMisLifecycleSignal) {
        lifecycleSource = 'mis';
    } else if (hasTopicLifecycleSignal) {
        lifecycleSource = 'topic';
    }

    const hasLifecycleConflict =
        topicTerminalStates.size > 0 &&
        misTerminalStates.size > 0 &&
        !Array.from(topicTerminalStates).some(state => misTerminalStates.has(state));

    // Determine logic method
    let logicMethod: QuestAnalysis['logicMethod'] = 'unknown';
    if (hasExplicitChecks) {
        logicMethod = 'explicit';
    } else {
        // If we have references that are conditions but not variable conditions, it might be implicit
        const refs = getQuestReferences(semanticModel, questName);
        if (refs.some(r => r.type === 'condition' && !r.details.includes(misVarName))) {
            logicMethod = 'implicit';
        }
    }

    let status: QuestAnalysis['status'] = 'not_started';
    if (hasSuccess || hasFailed || hasObsolete) {
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
        hasObsolete,
        lifecycleSource,
        hasLifecycleConflict,
        description: topicConstant ? String(topicConstant.value).replace(/^"|"$/g, '') : '',
        filePaths: {
            topic: topicConstant?.filePath || null,
            variable: misVariable?.filePath || null
        }
    };
};

export const getQuestReferences = (semanticModel: SemanticModel, questName: string): QuestReference[] => {
    if (!questName) return [];
    const misVarName = getQuestMisVariableName(questName);

    const refs: QuestReference[] = [];

    // Map functions to dialogs for better context
    const funcToDialog = new Map<string, { dialogName: string, npcName?: string }>();
    Object.values(semanticModel.dialogs || {}).forEach(dialog => {
        const info = dialog.properties.information;
        if (typeof info === 'string') {
            funcToDialog.set(getCanonicalQuestKey(info), { dialogName: dialog.name, npcName: dialog.properties.npc });
        } else if (info && typeof info === 'object' && info.name) {
             funcToDialog.set(getCanonicalQuestKey(info.name), { dialogName: dialog.name, npcName: dialog.properties.npc });
        }
    });

    Object.values(semanticModel.functions || {}).forEach(func => {
        func.actions?.forEach(action => {
            if ('topic' in action && isCaseInsensitiveMatch(action.topic, questName)) {
                const context = funcToDialog.get(getCanonicalQuestKey(func.name));
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
             if ('variableName' in cond && cond.variableName && isCaseInsensitiveMatch((cond as any).variableName, misVarName)) {
                 const context = funcToDialog.get(getCanonicalQuestKey(func.name));
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

    return refs;
};

export const getUsedQuestTopics = (semanticModel: SemanticModel): Set<string> => {
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
