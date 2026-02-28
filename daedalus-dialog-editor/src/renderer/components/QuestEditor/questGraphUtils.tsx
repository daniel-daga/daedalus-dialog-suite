import dagre from 'dagre';
import { MarkerType } from 'reactflow';
import type { DialogAction, DialogCondition, SemanticModel } from '../../types/global';
import type {
  QuestGraphBuildOptions,
  QuestGraphData,
  QuestGraphEdge,
  QuestGraphNode,
  QuestGraphNodeKind,
  QuestGraphProvenance,
  QuestGraphSourceKind
} from '../../types/questGraph';

const CHOICE_EDGE_COLOR = '#ff9800';

interface InternalNodeData {
  id: string;
  type: 'start' | 'update' | 'success' | 'failed' | 'check';
  label: string;
  npc: string;
  description?: string;
  nodeKind: 'function' | 'external-condition';
  expression?: string;
  operator?: 'AND' | 'OR';
  negated?: boolean;
  kind: QuestGraphNodeKind;
  condition?: DialogCondition;
  conditionIndex?: number;
  sourceKind: QuestGraphSourceKind;
  entrySurface?: boolean;
  latentEntry?: boolean;
  entryReason?: string;
  inferred: boolean;
  touchesSelectedQuest: boolean;
  provenance?: QuestGraphProvenance;
}

type ProducerMap = Map<string, Map<string, Set<string>>>;

interface IdentifyResult {
  nodeDataMap: Map<string, InternalNodeData>;
  producersByVariableAndValue: ProducerMap;
}

interface EdgeBuildResult {
  edges: QuestGraphEdge[];
  adjacency: Map<string, string[]>;
}

const isStateNode = (type: string, description?: string): boolean => {
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

const normalizeQuestStateValue = (value: string): string => {
  if (value === 'LOG_RUNNING') return '1';
  if (value === 'LOG_SUCCESS') return '2';
  if (value === 'LOG_FAILED') return '3';
  return value;
};

const toNodeToken = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return 'expr';
  return normalized.slice(0, 72);
};

const shortenExpression = (expression: string, maxLength = 56): string => {
  if (expression.length <= maxLength) return expression;
  return `${expression.slice(0, maxLength - 1)}...`;
};

const isNegatedCondition = (cond: DialogCondition): boolean => {
  if ('negated' in cond) {
    return Boolean((cond as { negated?: boolean }).negated);
  }
  return false;
};

const getConditionExpression = (cond: DialogCondition): string => {
  if (cond.type === 'NpcKnowsInfoCondition') {
    return `Npc_KnowsInfo(${cond.npc}, ${cond.dialogRef})`;
  }
  if (cond.type === 'VariableCondition') {
    const operator = cond.operator || (cond.negated ? '!=' : '==');
    return `${cond.variableName} ${operator} ${String(cond.value ?? '')}`.trim();
  }
  if (cond.type === 'NpcHasItemsCondition') {
    return `${cond.npc} has ${cond.item}`;
  }
  if (cond.type === 'NpcIsInStateCondition') {
    return `${cond.npc} ${cond.negated ? 'NOT in state' : 'in state'} ${cond.state}`;
  }
  if (cond.type === 'NpcIsDeadCondition') {
    return `${cond.npc} ${cond.negated ? 'is alive' : 'is dead'}`;
  }
  if (cond.type === 'NpcGetDistToWpCondition') {
    const operator = cond.operator || '<=';
    return `Npc_GetDistToWP(${cond.npc}, ${cond.waypoint}) ${operator} ${String(cond.value ?? '')}`.trim();
  }
  if (cond.type === 'NpcGetTalentSkillCondition') {
    const operator = cond.operator || '>=';
    return `Npc_GetTalentSkill(${cond.npc}, ${cond.talent}) ${operator} ${String(cond.value ?? '')}`.trim();
  }
  if ('condition' in cond && typeof cond.condition === 'string') {
    return cond.condition;
  }
  return cond.type || 'Condition';
};

const isTrivialConditionExpression = (expression: string): boolean => {
  const compact = expression.trim().replace(/\s+/g, ' ').toUpperCase();
  return (
    compact === 'RETURN TRUE;' ||
    compact === 'RETURN 1;' ||
    compact === 'RETURN FALSE;' ||
    compact === 'RETURN 0;' ||
    compact === 'TRUE' ||
    compact === '1' ||
    compact === 'FALSE' ||
    compact === '0'
  );
};

const stripOuterParens = (value: string): string => {
  let text = value.trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (depth === 0 && i < text.length - 1) {
        balanced = false;
        break;
      }
      if (depth < 0) {
        balanced = false;
        break;
      }
    }
    if (!balanced || depth !== 0) break;
    text = text.slice(1, -1).trim();
  }
  return text;
};

const splitTopLevelBooleanExpression = (value: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const next = value[i + 1];
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (depth === 0 && ((ch === '&' && next === '&') || (ch === '|' && next === '|'))) {
      const candidate = stripOuterParens(current);
      if (candidate) parts.push(candidate);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
  }

  const tail = stripOuterParens(current);
  if (tail) parts.push(tail);
  return parts;
};

const extractRawConditionCandidates = (raw: string): string[] => {
  const text = raw.trim();
  if (!text) return [];

  const ifCandidates: string[] = [];
  const ifRegex = /\bif\s*\(([\s\S]*?)\)/gi;
  let ifMatch: RegExpExecArray | null = null;
  while ((ifMatch = ifRegex.exec(text)) !== null) {
    const inside = (ifMatch[1] || '').trim();
    if (!inside) continue;
    splitTopLevelBooleanExpression(inside).forEach((part) => {
      const normalized = stripOuterParens(part);
      if (normalized) ifCandidates.push(normalized);
    });
  }
  if (ifCandidates.length > 0) {
    return ifCandidates;
  }

  const returnMatch = text.match(/^return\s+(.+?);?$/i);
  if (returnMatch?.[1]) {
    return splitTopLevelBooleanExpression(returnMatch[1].trim());
  }

  return splitTopLevelBooleanExpression(text);
};

const getRawConditionExpressionsForFunction = (
  funcName: string,
  semanticModel: SemanticModel
): string[] => {
  const context = getDialogContextForFunction(funcName, semanticModel);
  const expressions: string[] = [];
  const seen = new Set<string>();

  const pushExpr = (value: string | undefined) => {
    if (!value) return;
    const candidates = extractRawConditionCandidates(value);
    candidates.forEach((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed || isTrivialConditionExpression(trimmed)) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      expressions.push(trimmed);
    });
  };

  const conditionFuncName = context.conditionFunctionName;
  if (conditionFuncName) {
    const conditionFunc = semanticModel.functions?.[conditionFuncName];
    const initialCount = expressions.length;
    conditionFunc?.actions?.forEach((action: DialogAction) => {
      if ('action' in action && typeof action.action === 'string') {
        pushExpr(action.action);
      }
    });
    const hasParsedConditions = Boolean(conditionFunc?.conditions?.length);
    if (!hasParsedConditions && expressions.length === initialCount) {
      pushExpr(`${conditionFuncName}()`);
    }
  }

  if (context.dialogName) {
    const dialog = semanticModel.dialogs?.[context.dialogName];
    const conditionProp = dialog?.properties?.condition;
    if (typeof conditionProp === 'string') {
      const normalizedCondRef = conditionFuncName?.toLowerCase();
      if (!normalizedCondRef || normalizedCondRef !== conditionProp.toLowerCase()) {
        pushExpr(conditionProp);
      }
    }
  }

  return expressions;
};

const getFunctionRefName = (candidate: unknown): string | undefined => {
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object') {
    const maybeName = (candidate as { name?: unknown }).name;
    if (typeof maybeName === 'string') return maybeName;
  }
  return undefined;
};

const getDialogContextForFunction = (
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

const getEffectiveConditionsForFunction = (
  funcName: string,
  semanticModel: SemanticModel
): DialogCondition[] => {
  const func = semanticModel.functions?.[funcName];
  if (!func) return [];

  const mergedConditions: DialogCondition[] = [...(func.conditions || [])];
  const context = getDialogContextForFunction(funcName, semanticModel);
  if (!context.conditionFunctionName || context.conditionFunctionName === funcName) {
    return mergedConditions;
  }

  const conditionFunc = semanticModel.functions?.[context.conditionFunctionName];
  if (!conditionFunc?.conditions?.length) {
    return mergedConditions;
  }

  mergedConditions.push(...conditionFunc.conditions);
  return mergedConditions;
};

export const getNpcForFunction = (funcName: string, semanticModel: SemanticModel): string | null => {
  return getDialogContextForFunction(funcName, semanticModel).npc || null;
};

const getFunctionFilePath = (func: unknown): string | undefined => {
  const candidate = (func as { filePath?: unknown })?.filePath;
  return typeof candidate === 'string' ? candidate : undefined;
};

const inferFunctionSourceKind = (
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

const identifyQuestNodes = (
  semanticModel: SemanticModel,
  questName: string,
  misVarName: string
): IdentifyResult => {
  const nodeDataMap = new Map<string, InternalNodeData>();
  const producersByVariableAndValue: ProducerMap = new Map();

  const addProducer = (variable: string, value: string, funcName: string) => {
    if (!producersByVariableAndValue.has(variable)) {
      producersByVariableAndValue.set(variable, new Map());
    }
    const valueMap = producersByVariableAndValue.get(variable)!;
    if (!valueMap.has(value)) {
      valueMap.set(value, new Set());
    }
    valueMap.get(value)!.add(funcName);
  };

  Object.values(semanticModel.functions || {}).forEach((func) => {
    const context = getDialogContextForFunction(func.name, semanticModel);
    const effectiveConditions = getEffectiveConditionsForFunction(func.name, semanticModel);
    const rawConditionExpressions = getRawConditionExpressionsForFunction(func.name, semanticModel);
    let isRelevant = false;
    let type: InternalNodeData['type'] = 'check';
    let description = '';
    let kind: QuestGraphNodeKind = 'dialog';
    let touchesSelectedQuest = false;
    let writesSelectedQuest = false;
    let hasQuestPrecondition = false;
    let hasNonQuestPrecondition = false;
    const nonQuestConditionKinds = new Set<string>();

    func.actions?.forEach((action: DialogAction) => {
      if (action.type === 'SetVariableAction' && action.operator === '=') {
        const value = String(action.value);
        addProducer(action.variableName, value, func.name);
      }

      if ('topic' in action && action.topic === questName) {
        isRelevant = true;
        touchesSelectedQuest = true;
        writesSelectedQuest = true;

        if (action.type === 'CreateTopic') {
          type = 'start';
          description = 'Start Quest';
          kind = 'topic';
          addProducer(misVarName, '1', func.name);
        } else if (action.type === 'LogSetTopicStatus') {
          const status = String(action.status);
          kind = 'topicStatus';
          if (status.includes('SUCCESS') || status === '2') {
            type = 'success';
            description = 'Set LOG_SUCCESS';
            addProducer(misVarName, '2', func.name);
          } else if (status.includes('FAILED') || status === '3') {
            type = 'failed';
            description = 'Set LOG_FAILED';
            addProducer(misVarName, '3', func.name);
          } else if (status.includes('RUNNING') || status === '1') {
            type = 'update';
            description = 'Set LOG_RUNNING';
            addProducer(misVarName, '1', func.name);
          } else {
            type = 'update';
            description = `Set Status: ${status}`;
            addProducer(misVarName, status, func.name);
          }
        } else if (action.type === 'LogEntry') {
          if (type === 'check') type = 'update';
          if (!description) {
            description = `Log Entry: ${action.text || '(empty)'}`;
          }
          if (kind === 'dialog') {
            kind = 'logEntry';
          }
        }
      }

      if (action.type === 'SetVariableAction' && action.variableName === misVarName) {
        isRelevant = true;
        touchesSelectedQuest = true;
        writesSelectedQuest = true;
        kind = 'misState';
        if (action.operator === '=') {
          description = `Set ${misVarName} = ${String(action.value)}`;
        }
      }
    });

    effectiveConditions.forEach((cond: DialogCondition) => {
      if (cond.type === 'VariableCondition' && cond.variableName === misVarName) {
        isRelevant = true;
        touchesSelectedQuest = true;
        hasQuestPrecondition = true;
        return;
      }
      hasNonQuestPrecondition = true;
      nonQuestConditionKinds.add(cond.type || 'Condition');
    });
    if (rawConditionExpressions.length > 0) {
      hasNonQuestPrecondition = true;
      nonQuestConditionKinds.add('Condition');
    }

    if (isRelevant) {
      const sourceKind = inferFunctionSourceKind(
        func.name,
        Boolean(context.dialogName),
        getFunctionFilePath(func)
      );
      const entrySurface = writesSelectedQuest && !hasQuestPrecondition;
      const latentEntry = entrySurface && (sourceKind !== 'dialog' || hasNonQuestPrecondition);
      let entryReason: string | undefined;
      if (entrySurface) {
        const reasonParts: string[] = [];
        if (sourceKind !== 'dialog') {
          reasonParts.push(`source=${sourceKind}`);
        }
        if (hasNonQuestPrecondition) {
          const preconditionKinds = Array.from(nonQuestConditionKinds.values());
          if (preconditionKinds.length > 0) {
            reasonParts.push(`gated by ${preconditionKinds.join(', ')}`);
          } else {
            reasonParts.push('gated by non-quest condition(s)');
          }
        } else {
          reasonParts.push('no selected-quest precondition');
        }
        entryReason = reasonParts.join('; ');
      }

      nodeDataMap.set(func.name, {
        id: func.name,
        type,
        label: context.dialogName || func.name,
        npc: context.npc,
        description,
        nodeKind: 'function',
        kind,
        sourceKind,
        entrySurface,
        latentEntry,
        entryReason,
        inferred: false,
        touchesSelectedQuest,
        provenance: {
          filePath: getFunctionFilePath(func),
          functionName: func.name,
          dialogName: context.dialogName
        }
      });
    }
  });

  // Expand via knows-info references.
  let addedAny = true;
  while (addedAny) {
    addedAny = false;
    Object.values(semanticModel.functions || {}).forEach((func) => {
      if (nodeDataMap.has(func.name)) return;
      let isRelevantByKnows = false;

      func.conditions?.forEach((cond: DialogCondition) => {
        if (cond.type !== 'NpcKnowsInfoCondition') return;
        for (const relevantNode of nodeDataMap.values()) {
          if (relevantNode.label === cond.dialogRef) {
            isRelevantByKnows = true;
            break;
          }
        }
      });

      if (isRelevantByKnows) {
        const context = getDialogContextForFunction(func.name, semanticModel);
        nodeDataMap.set(func.name, {
          id: func.name,
          type: 'check',
          label: context.dialogName || func.name,
          npc: context.npc,
          description: 'Indirect prerequisite',
          nodeKind: 'function',
          kind: 'dialog',
          sourceKind: inferFunctionSourceKind(
            func.name,
            Boolean(context.dialogName),
            getFunctionFilePath(func)
          ),
          entrySurface: false,
          latentEntry: false,
          entryReason: undefined,
          inferred: true,
          touchesSelectedQuest: false,
          provenance: {
            filePath: getFunctionFilePath(func),
            functionName: func.name,
            dialogName: context.dialogName
          }
        });
        addedAny = true;
      }
    });
  }

  // Expand via variable producers that satisfy checks in relevant functions.
  addedAny = true;
  while (addedAny) {
    addedAny = false;

    nodeDataMap.forEach((_, consumerId) => {
      const consumerFunc = semanticModel.functions?.[consumerId];
      if (!consumerFunc) return;

      consumerFunc.conditions?.forEach((cond: DialogCondition) => {
        if (cond.type !== 'VariableCondition' || cond.operator !== '==') return;
        const valueMap = producersByVariableAndValue.get(cond.variableName);
        if (!valueMap) return;

        let checkValue = String(cond.value);
        if (cond.variableName === misVarName) {
          checkValue = normalizeQuestStateValue(checkValue);
        }

        const producers = valueMap.get(checkValue);
        if (!producers) return;

        producers.forEach((producerId) => {
          if (nodeDataMap.has(producerId)) return;
          const producerFunc = semanticModel.functions?.[producerId];
          if (!producerFunc) return;

          const context = getDialogContextForFunction(producerId, semanticModel);
          nodeDataMap.set(producerId, {
            id: producerId,
            type: 'check',
            label: context.dialogName || producerId,
            npc: context.npc,
            description: 'Indirect prerequisite',
            nodeKind: 'function',
            kind: 'dialog',
            sourceKind: inferFunctionSourceKind(
              producerId,
              Boolean(context.dialogName),
              getFunctionFilePath(producerFunc)
            ),
            entrySurface: false,
            latentEntry: false,
            entryReason: undefined,
            inferred: true,
            touchesSelectedQuest: false,
            provenance: {
              filePath: getFunctionFilePath(producerFunc),
              functionName: producerId,
              dialogName: context.dialogName
            }
          });
          addedAny = true;
        });
      });
    });
  }

  return { nodeDataMap, producersByVariableAndValue };
};

const buildQuestEdges = (
  semanticModel: SemanticModel,
  nodeDataMap: Map<string, InternalNodeData>,
  producersByVariableAndValue: ProducerMap,
  misVarName: string
): EdgeBuildResult => {
  const edges: QuestGraphEdge[] = [];
  const unresolvedConditionNodes = new Map<string, InternalNodeData>();
  const adjacency = new Map<string, string[]>();

  const addAdjacency = (sourceId: string, targetId: string) => {
    if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
    adjacency.get(sourceId)!.push(targetId);
  };

  nodeDataMap.forEach((_, funcName) => {
    if (!adjacency.has(funcName)) adjacency.set(funcName, []);
  });

  nodeDataMap.forEach((consumerData, consumerId) => {
    const func = semanticModel.functions[consumerId];
    if (!func) return;
    const effectiveConditions = getEffectiveConditionsForFunction(consumerId, semanticModel);
    const rawConditionExpressions = getRawConditionExpressionsForFunction(consumerId, semanticModel);
    const seenConditionExpressions = new Set<string>();
    let addedConditionEdge = false;

    func.actions?.forEach((action: DialogAction) => {
      if (action.type !== 'Choice') return;
      const targetFunc = action.targetFunction;
      if (!nodeDataMap.has(targetFunc)) return;
      const targetData = nodeDataMap.get(targetFunc)!;

      const sourceHandle = isStateNode(consumerData.type, consumerData.description)
        ? 'out-state'
        : 'out-finished';
      const targetHandle = isStateNode(targetData.type, targetData.description)
        ? 'in-trigger'
        : 'in-condition';

      edges.push({
        id: `choice-${consumerId}-${targetFunc}`,
        source: consumerId,
        target: targetFunc,
        sourceHandle,
        targetHandle,
        label: action.text,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: CHOICE_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '5,5' },
        labelStyle: { fill: CHOICE_EDGE_COLOR, fontSize: 10 },
        data: {
          kind: 'transitions',
          inferred: false,
          provenance: {
            functionName: consumerId,
            dialogName: consumerData.provenance?.dialogName
          }
        }
      });
      addAdjacency(consumerId, targetFunc);
    });

    effectiveConditions.forEach((cond: DialogCondition, condIndex: number) => {
      const expression = getConditionExpression(cond).trim();
      if (expression) {
        seenConditionExpressions.add(expression.toLowerCase());
      }
      const condToken = toNodeToken(expression || cond.type || `condition_${condIndex}`);
      const conditionNodeId = `condition-${consumerId}-${condIndex}-${condToken}`;
      const conditionLabel = cond.type
        ? cond.type.replace(/Condition$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
        : 'Condition';

      if (!unresolvedConditionNodes.has(conditionNodeId)) {
        unresolvedConditionNodes.set(conditionNodeId, {
          id: conditionNodeId,
          type: 'check',
          label: conditionLabel,
          npc: 'External/World',
          description: `${conditionLabel} prerequisite`,
          nodeKind: 'external-condition',
          expression,
          kind: 'condition',
          negated: isNegatedCondition(cond),
          sourceKind: 'external',
          entrySurface: false,
          latentEntry: false,
          entryReason: undefined,
          inferred: false,
          touchesSelectedQuest: false,
          condition: cond,
          conditionIndex: condIndex
        });
      }

      edges.push({
        id: `condition-edge-${conditionNodeId}-${consumerId}`,
        source: conditionNodeId,
        target: consumerId,
        sourceHandle: 'out-bool',
        targetHandle: 'in-condition',
        label: `requires ${shortenExpression(expression || conditionLabel, 40)}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#ffb74d', strokeWidth: 2 },
        labelStyle: { fill: '#ffb74d', fontSize: 10 },
        data: {
          kind: 'requires',
          inferred: false,
          expression,
          operator: cond.type === 'VariableCondition'
            ? (cond.operator as '==' | '!=' | '<' | '>' | '<=' | '>=' | undefined)
            : undefined,
          provenance: {
            functionName: consumerId,
            dialogName: consumerData.provenance?.dialogName
          }
        }
      });
      addedConditionEdge = true;
      addAdjacency(conditionNodeId, consumerId);

      if (cond.type === 'NpcKnowsInfoCondition') {
        const producerDialogName = cond.dialogRef;
        const producerDialog = semanticModel.dialogs[producerDialogName];
        let producerFunc: string | null = null;
        if (producerDialog) {
          const info = producerDialog.properties.information;
          if (typeof info === 'string') producerFunc = info;
          else if (typeof info === 'object' && info?.name) producerFunc = info.name;
        }

        if (producerFunc && nodeDataMap.has(producerFunc)) {
          edges.push({
            id: `knows-${producerFunc}-${consumerId}`,
            source: producerFunc,
            target: consumerId,
            sourceHandle: 'out-finished',
            targetHandle: 'in-condition',
            label: `requires knows ${producerDialogName}`,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#b1b1b7', strokeWidth: 2, strokeDasharray: '3,3' },
            labelStyle: { fill: '#b1b1b7', fontSize: 10 },
            data: {
              kind: 'requires',
              inferred: nodeDataMap.get(producerFunc)?.inferred || false,
              expression: `Npc_KnowsInfo(..., ${producerDialogName})`,
              provenance: {
                functionName: consumerId,
                dialogName: consumerData.provenance?.dialogName
              }
            }
          });
          addAdjacency(producerFunc, consumerId);
        }
        return;
      }

      if (cond.type === 'VariableCondition') {
        const variableName = cond.variableName;
        const operator = cond.operator || (cond.negated ? '!=' : '==');
        if (operator !== '==') return;

        const rawValue = String(cond.value);
        const normalizedValue =
          variableName === misVarName ? normalizeQuestStateValue(rawValue) : rawValue;
        const valueMap = producersByVariableAndValue.get(variableName);
        if (!valueMap) return;

        const producers = valueMap.get(normalizedValue) || new Set<string>();
        producers.forEach((producerId) => {
          if (producerId === consumerId || !nodeDataMap.has(producerId)) return;
          const producerNode = nodeDataMap.get(producerId)!;
          edges.push({
            id: `var-${variableName}-${producerId}-${consumerId}`,
            source: producerId,
            target: consumerId,
            sourceHandle: 'out-state',
            targetHandle: 'in-condition',
            label: `supports ${variableName} == ${rawValue}`,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#2196f3', strokeWidth: 2, strokeDasharray: '3,3' },
            labelStyle: { fill: '#2196f3', fontSize: 10 },
            data: {
              kind: 'requires',
              inferred: producerNode.inferred,
              expression: `${variableName} ${operator} ${rawValue}`,
              operator: operator as '==' | '!=' | '<' | '>' | '<=' | '>=' | undefined,
              provenance: {
                functionName: consumerId,
                dialogName: consumerData.provenance?.dialogName
              }
            }
          });
          addAdjacency(producerId, consumerId);
        });
      }
    });

    rawConditionExpressions.forEach((expression, rawIndex) => {
      const normalizedExpr = expression.trim();
      if (!normalizedExpr) return;
      const signature = normalizedExpr.toLowerCase();
      if (seenConditionExpressions.has(signature)) return;
      seenConditionExpressions.add(signature);

      const condToken = toNodeToken(normalizedExpr);
      const conditionNodeId = `condition-raw-${consumerId}-${rawIndex}-${condToken}`;
      if (!unresolvedConditionNodes.has(conditionNodeId)) {
        unresolvedConditionNodes.set(conditionNodeId, {
          id: conditionNodeId,
          type: 'check',
          label: 'Condition',
          npc: 'External/World',
          description: 'Condition function prerequisite',
          nodeKind: 'external-condition',
          expression: normalizedExpr,
          kind: 'condition',
          negated: false,
          sourceKind: 'external',
          entrySurface: false,
          latentEntry: false,
          entryReason: undefined,
          inferred: false,
          touchesSelectedQuest: false,
          condition: undefined,
          conditionIndex: undefined
        });
      }

      edges.push({
        id: `condition-raw-edge-${conditionNodeId}-${consumerId}`,
        source: conditionNodeId,
        target: consumerId,
        sourceHandle: 'out-bool',
        targetHandle: 'in-condition',
        label: `requires ${shortenExpression(normalizedExpr, 40)}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#ffa726', strokeWidth: 2 },
        labelStyle: { fill: '#ffa726', fontSize: 10 },
        data: {
          kind: 'requires',
          inferred: false,
          expression: normalizedExpr,
          provenance: {
            functionName: consumerId,
            dialogName: consumerData.provenance?.dialogName
          }
        }
      });
      addedConditionEdge = true;
      addAdjacency(conditionNodeId, consumerId);
    });


    const consumerConditionEdges = edges.filter((edge) =>
      edge.target === consumerId &&
      edge.data?.kind === 'requires' &&
      (edge.source.startsWith(`condition-${consumerId}-`) || edge.source.startsWith(`condition-raw-${consumerId}-`))
    );

    if (consumerConditionEdges.length > 1) {
      const obsoleteEdgeIds = new Set(consumerConditionEdges.map((edge) => edge.id));
      const keptEdges = edges.filter((edge) => !obsoleteEdgeIds.has(edge.id));
      edges.length = 0;
      edges.push(...keptEdges);

      let combinedSourceId = consumerConditionEdges[0].source;
      for (let idx = 1; idx < consumerConditionEdges.length; idx += 1) {
        const nextSourceId = consumerConditionEdges[idx].source;
        const logicalNodeId = `logical-${consumerId}-${idx - 1}`;
        if (!unresolvedConditionNodes.has(logicalNodeId)) {
          unresolvedConditionNodes.set(logicalNodeId, {
            id: logicalNodeId,
            type: 'check',
            label: 'AND',
            npc: 'External/World',
            description: 'Logical AND composition',
            nodeKind: 'external-condition',
            expression: 'AND',
            operator: 'AND',
            kind: 'logical',
            negated: false,
            sourceKind: 'external',
            entrySurface: false,
            latentEntry: false,
            entryReason: undefined,
            inferred: false,
            touchesSelectedQuest: false
          });
        }

        edges.push({
          id: `logical-left-${logicalNodeId}-${combinedSourceId}`,
          source: combinedSourceId,
          target: logicalNodeId,
          sourceHandle: 'out-bool',
          targetHandle: 'in-left',
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#ffb74d', strokeWidth: 2 },
          data: { kind: 'requires', inferred: false }
        });
        addAdjacency(combinedSourceId, logicalNodeId);

        edges.push({
          id: `logical-right-${logicalNodeId}-${nextSourceId}`,
          source: nextSourceId,
          target: logicalNodeId,
          sourceHandle: 'out-bool',
          targetHandle: 'in-right',
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#ffb74d', strokeWidth: 2 },
          data: { kind: 'requires', inferred: false }
        });
        addAdjacency(nextSourceId, logicalNodeId);

        combinedSourceId = logicalNodeId;
      }

      edges.push({
        id: `logical-out-${combinedSourceId}-${consumerId}`,
        source: combinedSourceId,
        target: consumerId,
        sourceHandle: 'out-bool',
        targetHandle: 'in-condition',
        label: 'requires all conditions',
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#ffb74d', strokeWidth: 2 },
        labelStyle: { fill: '#ffb74d', fontSize: 10 },
        data: {
          kind: 'requires',
          inferred: false,
          expression: 'AND',
          provenance: {
            functionName: consumerId,
            dialogName: consumerData.provenance?.dialogName
          }
        }
      });
      addAdjacency(combinedSourceId, consumerId);
    }

    if (consumerData.entrySurface && !addedConditionEdge) {
      const entryToken = toNodeToken(consumerData.entryReason || consumerData.sourceKind || 'world_trigger');
      const externalId = `external-entry-${consumerId}-${entryToken}`;
      if (!unresolvedConditionNodes.has(externalId)) {
        const triggerLabel = consumerData.sourceKind === 'item'
          ? 'Item Trigger'
          : consumerData.sourceKind === 'event'
            ? 'Event Trigger'
            : consumerData.sourceKind === 'startup'
              ? 'Startup Trigger'
              : 'World Trigger';
        unresolvedConditionNodes.set(externalId, {
          id: externalId,
          type: 'check',
          label: triggerLabel,
          npc: 'External/World',
          description: consumerData.entryReason || 'Implicit entry trigger',
          nodeKind: 'external-condition',
          expression: consumerData.entryReason || triggerLabel,
          kind: 'condition',
          negated: false,
          sourceKind: 'external',
          entrySurface: false,
          latentEntry: false,
          entryReason: undefined,
          inferred: true,
          touchesSelectedQuest: false
        });
      }

      edges.push({
        id: `external-entry-edge-${externalId}-${consumerId}`,
        source: externalId,
        target: consumerId,
        sourceHandle: 'out-bool',
        targetHandle: 'in-condition',
        label: 'entry trigger',
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#81c784', strokeWidth: 2, strokeDasharray: '3,3' },
        labelStyle: { fill: '#81c784', fontSize: 10 },
        data: {
          kind: 'requires',
          inferred: true,
          expression: consumerData.entryReason || 'entry trigger',
          provenance: {
            functionName: consumerId,
            dialogName: consumerData.provenance?.dialogName
          }
        }
      });
      addAdjacency(externalId, consumerId);
    }
  });

  unresolvedConditionNodes.forEach((nodeData, nodeId) => {
    if (!nodeDataMap.has(nodeId)) {
      nodeDataMap.set(nodeId, nodeData);
    }
    if (!adjacency.has(nodeId)) adjacency.set(nodeId, []);
  });

  return { edges, adjacency };
};

const filterGraph = (
  nodes: Map<string, InternalNodeData>,
  edges: QuestGraphEdge[],
  options?: QuestGraphBuildOptions
): { nodeDataMap: Map<string, InternalNodeData>; edges: QuestGraphEdge[] } => {
  const {
    onlySelectedQuest = false,
    hideInferredEdges = false,
    showConditions = true,
    showEntrySurfacesOnly = false
  } = options || {};

  const selectedNodeDataMap = new Map(nodes);
  let selectedEdges = [...edges];

  if (hideInferredEdges) {
    selectedEdges = selectedEdges.filter((edge) => !edge.data?.inferred);
  }

  if (!showConditions) {
    for (const [id, data] of selectedNodeDataMap.entries()) {
      if (data.kind === 'condition' || data.kind === 'logical') {
        selectedNodeDataMap.delete(id);
      }
    }
    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  if (onlySelectedQuest) {
    for (const [id, data] of selectedNodeDataMap.entries()) {
      if (!data.touchesSelectedQuest && data.kind !== 'condition' && data.kind !== 'logical') {
        selectedNodeDataMap.delete(id);
      }
    }
    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  if (showEntrySurfacesOnly) {
    const keepNodeIds = new Set<string>();
    for (const [nodeId, data] of selectedNodeDataMap.entries()) {
      if (data.entrySurface) {
        keepNodeIds.add(nodeId);
      }
    }

    selectedEdges.forEach((edge) => {
      if (keepNodeIds.has(edge.source) || keepNodeIds.has(edge.target)) {
        keepNodeIds.add(edge.source);
        keepNodeIds.add(edge.target);
      }
    });

    for (const nodeId of Array.from(selectedNodeDataMap.keys())) {
      if (!keepNodeIds.has(nodeId)) {
        selectedNodeDataMap.delete(nodeId);
      }
    }

    selectedEdges = selectedEdges.filter(
      (edge) => selectedNodeDataMap.has(edge.source) && selectedNodeDataMap.has(edge.target)
    );
  }

  return { nodeDataMap: selectedNodeDataMap, edges: selectedEdges };
};

const calculateDagreLayout = (
  semanticModel: SemanticModel,
  nodeDataMap: Map<string, InternalNodeData>,
  edges: QuestGraphEdge[],
  misVarName: string
): QuestGraphNode[] => {
  const NODE_WIDTH = 280;
  const NODE_HEIGHT = 132;

  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: 'LR', align: 'UL', ranksep: 180, nodesep: 120, edgesep: 60, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const npcNodes = new Map<string, string[]>();

  nodeDataMap.forEach((data, id) => {
    if (!npcNodes.has(data.npc)) {
      npcNodes.set(data.npc, []);
    }
    npcNodes.get(data.npc)!.push(id);
  });

  npcNodes.forEach((_, npc) => {
    const clusterId = `swimlane-${npc}`;
    g.setNode(clusterId, { label: npc, clusterLabelPos: 'top' });
  });

  nodeDataMap.forEach((data, id) => {
    const clusterId = `swimlane-${data.npc}`;
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    g.setParent(id, clusterId);
  });

  edges.forEach((edge) => {
    if (nodeDataMap.has(edge.source) && nodeDataMap.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  const nodes: QuestGraphNode[] = [];
  g.nodes().forEach((nodeId) => {
    const node = g.node(nodeId);
    if (nodeId.startsWith('swimlane-')) {
      nodes.push({
        id: nodeId,
        type: 'group',
        position: { x: node.x - node.width / 2, y: node.y - node.height / 2 },
        style: {
          width: node.width,
          height: node.height,
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px dashed #444',
          zIndex: -1,
          padding: 10,
          color: '#666'
        },
        data: {
          label: nodeId.replace('swimlane-', ''),
          npc: nodeId.replace('swimlane-', ''),
          kind: 'dialog'
        },
        selectable: false,
        draggable: false
      });
      return;
    }

    const data = nodeDataMap.get(nodeId);
    if (!data) return;

    let nodeType: 'dialog' | 'questState' | 'condition' | 'logical' = 'dialog';
    if (data.kind === 'condition') {
      nodeType = 'condition';
    } else if (data.kind === 'logical') {
      nodeType = 'logical';
    } else if (
      data.kind === 'topic' ||
      data.kind === 'topicStatus' ||
      data.kind === 'misState' ||
      data.kind === 'logEntry' ||
      isStateNode(data.type, data.description)
    ) {
      nodeType = 'questState';
    }

    nodes.push({
      id: nodeId,
      position: { x: node.x - node.width / 2, y: node.y - node.height / 2 },
      type: nodeType,
      data: {
        label: data.label,
        npc: data.npc,
        description: data.description,
        expression: data.expression,
        operator: data.operator,
        negated: data.negated,
        type: data.type,
        status: data.description,
        variableName: semanticModel.variables?.[misVarName] ? misVarName : undefined,
        condition: data.condition,
        conditionIndex: data.conditionIndex,
        kind: data.kind,
        sourceKind: data.sourceKind,
        entrySurface: data.entrySurface,
        latentEntry: data.latentEntry,
        entryReason: data.entryReason,
        inferred: data.inferred,
        touchesSelectedQuest: data.touchesSelectedQuest,
        provenance: data.provenance
      }
    });
  });

  return nodes;
};

export const buildQuestGraph = (
  semanticModel: SemanticModel,
  questName: string | null,
  options?: QuestGraphBuildOptions
): QuestGraphData => {
  if (!questName || !semanticModel) {
    return { nodes: [], edges: [] };
  }

  const misVarName = questName.replace('TOPIC_', 'MIS_');
  const { nodeDataMap, producersByVariableAndValue } = identifyQuestNodes(
    semanticModel,
    questName,
    misVarName
  );
  const { edges } = buildQuestEdges(semanticModel, nodeDataMap, producersByVariableAndValue, misVarName);
  const filtered = filterGraph(nodeDataMap, edges, options);
  const nodes = calculateDagreLayout(semanticModel, filtered.nodeDataMap, filtered.edges, misVarName);

  return {
    nodes,
    edges: filtered.edges.filter(
      (edge) => filtered.nodeDataMap.has(edge.source) && filtered.nodeDataMap.has(edge.target)
    )
  };
};
