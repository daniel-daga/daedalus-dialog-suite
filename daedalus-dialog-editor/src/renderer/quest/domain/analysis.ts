import type { SemanticModel, DialogAction, DialogCondition } from '../../types/global';
import { getActionType } from '../../components/actionTypes';
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

// Lazily-built lowercased index per symbols-object identity so repeated
// case-insensitive misses don't re-enumerate the (potentially huge) table.
// First-match semantics for case-insensitive duplicates follow Object.entries
// order, matching the previous linear scan.
const loweredSymbolIndexCache = new WeakMap<object, Map<string, unknown>>();

const getLoweredSymbolIndex = <T,>(symbols: Record<string, T>): Map<string, T> => {
    let index = loweredSymbolIndexCache.get(symbols) as Map<string, T> | undefined;
    if (!index) {
        index = new Map<string, T>();
        for (const [key, value] of Object.entries(symbols)) {
            const lowered = key.toLowerCase();
            if (!index.has(lowered)) {
                index.set(lowered, value);
            }
        }
        loweredSymbolIndexCache.set(symbols, index);
    }
    return index;
};

const findCaseInsensitiveSymbol = <T,>(symbols: Record<string, T> | undefined, name: string): T | undefined => {
    if (!symbols) return undefined;
    if (symbols[name]) return symbols[name];
    return getLoweredSymbolIndex(symbols).get(name.toLowerCase());
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

interface QuestLifecycleSignals {
    hasStart: boolean;
    hasSuccess: boolean;
    hasFailed: boolean;
    hasObsolete: boolean;
    hasLifecycleSignal: boolean;
    terminalStates: Set<'success' | 'failed' | 'obsolete'>;
    /** MIS-side only: `=` assignments or VariableCondition checks were seen. */
    hasExplicitChecks: boolean;
}

const createLifecycleSignals = (): QuestLifecycleSignals => ({
    hasStart: false,
    hasSuccess: false,
    hasFailed: false,
    hasObsolete: false,
    hasLifecycleSignal: false,
    terminalStates: new Set(),
    hasExplicitChecks: false
});

const applyLifecycleSignal = (signals: QuestLifecycleSignals, rawValue: unknown) => {
    const state = normalizeQuestLifecycleState(rawValue);
    signals.hasLifecycleSignal = true;
    signals.hasStart = true;

    if (state === 'success') {
        signals.hasSuccess = true;
        signals.terminalStates.add('success');
    } else if (state === 'failed') {
        signals.hasFailed = true;
        signals.terminalStates.add('failed');
    } else if (state === 'obsolete') {
        signals.hasObsolete = true;
        signals.hasFailed = true;
        signals.terminalStates.add('obsolete');
    }
};

/**
 * Batch variant of `analyzeQuest`: analyzes all quests in a SINGLE pass over
 * `semanticModel.functions`, accumulating per-quest signals keyed by canonical
 * topic/MIS-variable keys. Produces results identical to calling
 * `analyzeQuest` once per quest.
 *
 * Note on `logicMethod`: per-quest `analyzeQuest` has an 'implicit' branch
 * driven by `getQuestReferences`, but its predicate (a condition ref whose
 * details do not include the MIS variable name) can never be true — condition
 * refs are only pushed for the MIS variable and always embed its name in
 * details. So without explicit checks the method is always 'unknown', which
 * this batch path returns directly, avoiding the O(functions + dialogs)
 * `getQuestReferences` walk per quest.
 */
export const analyzeQuests = (
    semanticModel: Pick<SemanticModel, 'functions' | 'constants' | 'variables'>,
    questNames: string[]
): Map<string, QuestAnalysis> => {
    const topicSignalsByKey = new Map<string, QuestLifecycleSignals>();
    const misSignalsByKey = new Map<string, QuestLifecycleSignals>();

    const questInfos = questNames.map((questName) => {
        const misVarName = getQuestMisVariableName(questName);
        // Falsy names never match in isCaseInsensitiveMatch — don't index them.
        const questKey = questName ? getCanonicalQuestKey(questName) : null;
        const misKey = misVarName ? getCanonicalQuestKey(misVarName) : null;
        if (questKey && !topicSignalsByKey.has(questKey)) {
            topicSignalsByKey.set(questKey, createLifecycleSignals());
        }
        if (misKey && !misSignalsByKey.has(misKey)) {
            misSignalsByKey.set(misKey, createLifecycleSignals());
        }
        return { questName, misVarName, questKey, misKey };
    });

    // Single pass over all functions, accumulating signals for every quest.
    Object.values(semanticModel.functions || {}).forEach(func => {
        func.actions?.forEach((action: DialogAction) => {
            if ('topic' in action && action.topic) {
                const signals = topicSignalsByKey.get(getCanonicalQuestKey(action.topic));
                if (signals) {
                    if (action.type === 'CreateTopic') {
                        signals.hasStart = true;
                    } else if (action.type === 'LogSetTopicStatus') {
                        applyLifecycleSignal(signals, action.status);
                    }
                }
            }

            if (action.type === 'SetVariableAction' && action.operator === '=' && action.variableName) {
                const signals = misSignalsByKey.get(getCanonicalQuestKey(action.variableName));
                if (signals) {
                    applyLifecycleSignal(signals, action.value);
                    signals.hasExplicitChecks = true;
                }
            }
        });

        func.conditions?.forEach((cond: DialogCondition) => {
            if (cond.type === 'VariableCondition' && cond.variableName) {
                const signals = misSignalsByKey.get(getCanonicalQuestKey(cond.variableName));
                if (signals) {
                    signals.hasExplicitChecks = true;
                }
            }
        });
    });

    const result = new Map<string, QuestAnalysis>();
    questInfos.forEach(({ questName, misVarName, questKey, misKey }) => {
        const topicConstant = findCaseInsensitiveSymbol(semanticModel.constants, questName);
        const misVariable = findCaseInsensitiveSymbol(semanticModel.variables, misVarName);
        const topic = (questKey && topicSignalsByKey.get(questKey)) || createLifecycleSignals();
        const mis = (misKey && misSignalsByKey.get(misKey)) || createLifecycleSignals();

        const hasStart = topic.hasStart || mis.hasStart;
        const hasSuccess = topic.hasSuccess || mis.hasSuccess;
        const hasFailed = topic.hasFailed || mis.hasFailed;
        const hasObsolete = topic.hasObsolete || mis.hasObsolete;
        const hasExplicitChecks = !!misVariable || mis.hasExplicitChecks;

        let lifecycleSource: QuestAnalysis['lifecycleSource'] = 'none';
        if (topic.hasLifecycleSignal && mis.hasLifecycleSignal) {
            lifecycleSource = 'mixed';
        } else if (mis.hasLifecycleSignal) {
            lifecycleSource = 'mis';
        } else if (topic.hasLifecycleSignal) {
            lifecycleSource = 'topic';
        }

        const hasLifecycleConflict =
            topic.terminalStates.size > 0 &&
            mis.terminalStates.size > 0 &&
            !Array.from(topic.terminalStates).some(state => mis.terminalStates.has(state));

        let status: QuestAnalysis['status'] = 'not_started';
        if (hasSuccess || hasFailed || hasObsolete) {
            status = 'implemented';
        } else if (hasStart) {
            status = 'wip';
        }

        result.set(questName, {
            status,
            logicMethod: hasExplicitChecks ? 'explicit' : 'unknown',
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
        });
    });

    return result;
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

export const getUsedQuestTopics = (semanticModel: Pick<SemanticModel, 'functions'>): Set<string> => {
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
