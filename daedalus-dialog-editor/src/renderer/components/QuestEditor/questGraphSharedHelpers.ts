/**
 * Pure helper functions shared across the quest-graph build pipeline.
 *
 * All functions here are free of side effects and do not import from the
 * pipeline modules (nodeIdentification / edgeBuilding / layout), ensuring
 * there are no circular dependencies.
 */

import type { DialogCondition, SemanticModel } from '../../types/global';
import type { QuestGraphConditionType, QuestGraphSourceKind } from '../../types/questGraph';
import type { EffectiveConditionEntry } from './questGraphInternalTypes';

export const isStateNode = (type: string, description?: string): boolean => {
  const desc = description || '';
  return (
    type === 'start' ||
    type === 'success' ||
    type === 'failed' ||
    desc.includes('Status') ||
    desc === 'Set Running' ||
    desc.startsWith('Set LOG_')
  );
};

export const normalizeQuestStateValue = (value: string): string => {
  if (value === 'LOG_RUNNING') return '1';
  if (value === 'LOG_SUCCESS') return '2';
  if (value === 'LOG_FAILED') return '3';
  return value;
};

export const toNodeToken = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return 'expr';
  return normalized.slice(0, 72);
};

export const shortenExpression = (expression: string, maxLength = 56): string => {
  if (expression.length <= maxLength) return expression;
  return `${expression.slice(0, maxLength - 1)}...`;
};

export const buildGeneratedConditionNodeId = (
  consumerId: string,
  ownerFunctionName: string,
  ownerConditionIndex: number,
  expression: string,
  conditionType: QuestGraphConditionType
): string => {
  const ownerToken = toNodeToken(ownerFunctionName);
  const conditionToken = toNodeToken(expression || conditionType || `condition_${ownerConditionIndex}`);
  return `condition-${consumerId}-${ownerToken}-${ownerConditionIndex}-${conditionToken}`;
};

export const buildGeneratedExternalEntryNodeId = (
  consumerId: string,
  entryReason: string
): string => {
  return `external-entry-${consumerId}-${toNodeToken(entryReason)}`;
};

export const isNegatedCondition = (cond: DialogCondition): boolean => {
  if ('negated' in cond) {
    return Boolean((cond as { negated?: boolean }).negated);
  }
  return false;
};

/**
 * WeakMap cache so that repeated calls with the same condition object (e.g. the
 * same condition appearing in both identifyQuestNodes and buildQuestEdges within
 * one graph-build pass) skip the property-check walk entirely.
 */
const _conditionTypeCache = new WeakMap<object, QuestGraphConditionType | undefined>();

export const inferConditionType = (cond?: DialogCondition): QuestGraphConditionType | undefined => {
  if (!cond) return undefined;
  if (_conditionTypeCache.has(cond)) return _conditionTypeCache.get(cond);

  const explicitType = typeof cond.type === 'string' ? cond.type : undefined;
  let result: QuestGraphConditionType | undefined;
  if (explicitType && explicitType !== 'GenericCondition') {
    result = explicitType as QuestGraphConditionType;
  } else if ('variableName' in cond) {
    result = 'VariableCondition';
  } else if ('npc' in cond && 'dialogRef' in cond) {
    result = 'NpcKnowsInfoCondition';
  } else if ('npc' in cond && 'item' in cond) {
    result = 'NpcHasItemsCondition';
  } else if ('npc' in cond && 'state' in cond) {
    result = 'NpcIsInStateCondition';
  } else if ('npc' in cond && 'waypoint' in cond) {
    result = 'NpcGetDistToWpCondition';
  } else if ('npc' in cond && 'talent' in cond) {
    result = 'NpcGetTalentSkillCondition';
  } else if ('npc' in cond) {
    result = 'NpcIsDeadCondition';
  } else {
    result = 'Condition';
  }

  _conditionTypeCache.set(cond, result);
  return result;
};

export const getConditionLabel = (conditionType?: QuestGraphConditionType): string => {
  if (!conditionType) return 'Condition';
  if (conditionType === 'LogicalCondition') return 'Logical';
  if (conditionType === 'ExternalTriggerCondition') return 'External Trigger';
  return conditionType.replace(/Condition$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
};

export const getConditionNodeLabel = (
  conditionType: QuestGraphConditionType | undefined,
  expression: string
): string => {
  const baseLabel = getConditionLabel(conditionType);
  if (conditionType === 'Condition' && expression) {
    return shortenExpression(expression, 36);
  }
  return baseLabel;
};

export const getConditionExpression = (cond: DialogCondition): string => {
  const conditionType = inferConditionType(cond);
  if (conditionType === 'NpcKnowsInfoCondition' && 'npc' in cond && 'dialogRef' in cond) {
    return `Npc_KnowsInfo(${cond.npc}, ${cond.dialogRef})`;
  }
  if (conditionType === 'VariableCondition' && 'variableName' in cond) {
    const operator = cond.operator || (cond.negated ? '!=' : '==');
    return `${cond.variableName} ${operator} ${String(cond.value ?? '')}`.trim();
  }
  if (conditionType === 'NpcHasItemsCondition' && 'npc' in cond && 'item' in cond) {
    return `${cond.npc} has ${cond.item}`;
  }
  if (conditionType === 'NpcIsInStateCondition' && 'npc' in cond && 'state' in cond) {
    const negated = Boolean((cond as { negated?: boolean }).negated);
    return `${cond.npc} ${negated ? 'NOT in state' : 'in state'} ${cond.state}`;
  }
  if (conditionType === 'NpcIsDeadCondition' && 'npc' in cond) {
    const negated = Boolean((cond as { negated?: boolean }).negated);
    return `${cond.npc} ${negated ? 'is alive' : 'is dead'}`;
  }
  if (conditionType === 'NpcGetDistToWpCondition' && 'npc' in cond && 'waypoint' in cond) {
    const operator = cond.operator || '<=';
    return `Npc_GetDistToWP(${cond.npc}, ${cond.waypoint}) ${operator} ${String(cond.value ?? '')}`.trim();
  }
  if (conditionType === 'NpcGetTalentSkillCondition' && 'npc' in cond && 'talent' in cond) {
    const operator = cond.operator || '>=';
    return `Npc_GetTalentSkill(${cond.npc}, ${cond.talent}) ${operator} ${String(cond.value ?? '')}`.trim();
  }
  if ('condition' in cond && typeof cond.condition === 'string') {
    return cond.condition;
  }
  return conditionType || 'Condition';
};

export const getFunctionRefName = (candidate: unknown): string | undefined => {
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object') {
    const maybeName = (candidate as { name?: unknown }).name;
    if (typeof maybeName === 'string') return maybeName;
  }
  return undefined;
};

export const getDialogContextForFunction = (
  funcName: string,
  semanticModel: SemanticModel
): { npc: string; dialogName?: string; conditionFunctionName?: string } => {
  for (const [dialogName, dialog] of Object.entries(semanticModel.dialogs || {})) {
    const infoName = getFunctionRefName(dialog.properties.information);
    if (
      typeof infoName === 'string' &&
      infoName.toLowerCase() === funcName.toLowerCase()
    ) {
      return {
        npc: (dialog.properties.npc as string) || 'Unknown',
        dialogName,
        conditionFunctionName: getFunctionRefName(dialog.properties.condition)
      };
    }
  }

  return { npc: 'Global/Other' };
};

export const getEffectiveConditionEntriesForFunction = (
  funcName: string,
  semanticModel: SemanticModel
): EffectiveConditionEntry[] => {
  const func = semanticModel.functions?.[funcName];
  if (!func) return [];

  const mergedConditions: EffectiveConditionEntry[] = (func.conditions || []).map((condition, index) => ({
    condition,
    ownerFunctionName: funcName,
    ownerConditionIndex: index
  }));
  const context = getDialogContextForFunction(funcName, semanticModel);
  if (!context.conditionFunctionName || context.conditionFunctionName === funcName) {
    return mergedConditions;
  }

  const conditionFunc = semanticModel.functions?.[context.conditionFunctionName];
  if (!conditionFunc?.conditions?.length) {
    return mergedConditions;
  }

  conditionFunc.conditions.forEach((condition, index) => {
    mergedConditions.push({
      condition,
      ownerFunctionName: context.conditionFunctionName!,
      ownerConditionIndex: index
    });
  });
  return mergedConditions;
};

export const getConditionSummaryForFunction = (
  funcName: string,
  semanticModel: SemanticModel
): {
  conditionExpression?: string;
  conditionCount: number;
  conditionMode?: 'structured' | 'generic-expression';
} => {
  const effectiveConditions = getEffectiveConditionEntriesForFunction(funcName, semanticModel);
  if (effectiveConditions.length === 0) {
    return { conditionCount: 0 };
  }

  const expressions = effectiveConditions
    .map(({ condition }) => getConditionExpression(condition).trim())
    .filter(Boolean);

  const conditionMode: 'structured' | 'generic-expression' = effectiveConditions.some(({ condition }) => inferConditionType(condition) === 'Condition')
    ? 'generic-expression'
    : 'structured';

  const conditionExpression = conditionMode === 'generic-expression'
    ? (effectiveConditions.length === 1 && 'condition' in effectiveConditions[0].condition
      ? String((effectiveConditions[0].condition as { condition?: unknown }).condition || '').trim()
      : expressions.join(' && '))
    : expressions.join(' && ');

  return {
    conditionExpression,
    conditionCount: effectiveConditions.length,
    conditionMode
  };
};

export const getFunctionFilePath = (func: unknown): string | undefined => {
  const candidate = (func as { filePath?: unknown })?.filePath;
  return typeof candidate === 'string' ? candidate : undefined;
};

export const inferFunctionSourceKind = (
  funcName: string,
  hasDialogContext: boolean,
  filePath?: string
): QuestGraphSourceKind => {
  if (hasDialogContext) return 'dialog';

  const lowerPath = filePath?.toLowerCase();
  if (lowerPath) {
    if (lowerPath.includes('\\content\\items\\')) return 'item';
    if (lowerPath.includes('\\content\\story\\events\\')) return 'event';
    if (lowerPath.includes('\\startup.d') || lowerPath.includes('\\content\\story\\startup')) return 'startup';
    if (lowerPath.includes('\\content\\story\\dialoge\\')) return 'dialog';
    return 'script';
  }

  if (/^use_/i.test(funcName)) return 'item';
  if (/^evt_/i.test(funcName) || /_trigger/i.test(funcName)) return 'event';
  if (/startup/i.test(funcName)) return 'startup';
  return 'script';
};
