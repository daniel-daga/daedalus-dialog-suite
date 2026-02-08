import type { SemanticModel, DialogAction, DialogCondition } from '../../types/global';
import { getActionType } from '../actionTypes';

export interface QuestAnalysis {
    status: 'implemented' | 'wip' | 'broken' | 'not_started';
    misVariableExists: boolean;
    misVariableName: string;
    hasStart: boolean;
    hasSuccess: boolean;
    hasFailed: boolean;
    description: string;
    filePaths: { topic: string | null; variable: string | null };
}

export interface QuestReference {
    type: 'create' | 'status' | 'entry';
    dialogName?: string;
    functionName: string;
    npcName?: string;
    details: string;
}

export const analyzeQuest = (semanticModel: SemanticModel, questName: string): QuestAnalysis => {
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const topicConstant = semanticModel.constants?.[questName];
    const misVariable = semanticModel.variables?.[misVarName];

    let hasStart = false;
    let hasSuccess = false;
    let hasFailed = false;

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
    });

    let status: QuestAnalysis['status'] = 'not_started';
    if (!misVariable) {
        status = 'broken';
    } else if (hasSuccess || hasFailed) {
        status = 'implemented';
    } else if (hasStart) {
        status = 'wip';
    }

    return {
        status,
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

export const getQuestReferences = (semanticModel: SemanticModel, questName: string): QuestReference[] => {
    if (!questName) return [];
    const lowerQuestName = questName.toLowerCase();
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const lowerMisVarName = misVarName.toLowerCase();

    const refs: QuestReference[] = [];

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
                    type: 'status',
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
